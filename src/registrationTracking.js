import { FACE_FRESH_MS, HAND_FRESH_MS, getPlayerBoundary, isFreshDetection } from "./gameLogic.js";

export const FACE_LOCK_MS = 450;
export const HAND_LOCK_MS = 350;
const FACE_MOVE_LIMIT = 0.22;
const HAND_FACE_X_LIMIT = 0.38;
const HAND_FACE_Y_LIMIT = 0.36;
const AMBIGUOUS_FACE_MARGIN = 0.08;

export function selectRegistrationFaces(faces = [], playerCount = 1, now = performance.now(), preferredSlots = []) {
  const visible = faces.map((face, slot) => ({ face, slot }))
    .filter(({ face }) => isFreshDetection(face, now, FACE_FRESH_MS));
  // A larger face box is only a 2-D proximity estimate, not a depth reading.
  // Once menu players have been chosen, keep those slots instead of letting a
  // newcomer with a larger face take over the next setup step.
  const selected = preferredSlots.length === playerCount
    ? preferredSlots.map((slot) => visible.find((entry) => entry.slot === slot))
    : visible.sort((a, b) =>
      (b.face.proximity ?? (b.face.width ?? 0.16) * (b.face.height ?? 0.22))
      - (a.face.proximity ?? (a.face.width ?? 0.16) * (a.face.height ?? 0.22))).slice(0, playerCount);
  if (selected.length !== playerCount || selected.some((entry) => !entry)) return null;
  selected.sort((a, b) => (a.face.cameraX ?? a.face.x) - (b.face.cameraX ?? b.face.x));
  if (playerCount === 2 && getPlayerBoundary(selected.map(({ face }) => face)) === null) return null;
  return selected;
}

export function faceIdentity(face, slot, trackerKind) {
  return trackerKind === "hybrid" ? `pose:${face.personId}` : `slot:${slot}`;
}

export function sameFaceCandidates(previous = [], current = [], trackerKind) {
  return previous.length === current.length && current.every(({ face, slot }, index) => {
    const earlier = previous[index];
    return (trackerKind === "hybrid"
      ? Math.abs((face.cameraX ?? face.x) - earlier.bodyX) <= FACE_MOVE_LIMIT
      : faceIdentity(face, slot, trackerKind) === earlier.identity)
      && Math.hypot(face.x - earlier.x, face.y - earlier.y) <= FACE_MOVE_LIMIT;
  });
}

export function snapshotFaces(selected = [], trackerKind) {
  return selected.map(({ face, slot }) => ({
    identity: faceIdentity(face, slot, trackerKind),
    x: face.x,
    y: face.y,
    bodyX: face.cameraX ?? face.x,
    slot,
  }));
}

function handFaceDistance(hand, face) {
  return Math.hypot(hand.x - face.x, hand.y - face.y);
}

export function associateHandsToFaces(hands = [], selectedFaces = [], trackerKind = "hand", now = performance.now(), allFaces = []) {
  if (!selectedFaces.length) return [];
  const faces = selectedFaces.map(({ face }) => face);
  const selectedSlots = new Set(selectedFaces.map(({ slot }) => slot));
  const ignoredFaces = allFaces.map((face, slot) => ({ face, slot }))
    .filter(({ face, slot }) => !selectedSlots.has(slot) && isFreshDetection(face, now, FACE_FRESH_MS));
  const boundary = faces.length === 2 ? getPlayerBoundary(faces) : null;
  const matches = Array(selectedFaces.length).fill(null);
  const candidates = [];

  hands.forEach((hand, slot) => {
    if (!isFreshDetection(hand, now, trackerKind === "hybrid" ? 350 : HAND_FRESH_MS)
      || hand.y > 0.82) return;
    if (trackerKind === "hybrid"
      && ((hand.confidence ?? 0) < 0.38
        || !Number.isFinite(hand.shoulderY)
      || hand.y > hand.shoulderY + 0.15)) return;
    const distances = faces.map((face) => handFaceDistance(hand, face));
    selectedFaces.forEach(({ face }, ownerIndex) => {
      if (trackerKind === "hybrid" && hand.personId !== face.personId) return;
      if (trackerKind !== "hybrid" && boundary !== null
        && (ownerIndex === 0 ? hand.x >= boundary : hand.x < boundary)) return;
      const dx = Math.abs(hand.x - face.x);
      const dy = hand.y - face.y;
      if (dx > (trackerKind === "hybrid" ? 0.52 : HAND_FACE_X_LIMIT)
        || dy < (trackerKind === "hybrid" ? -0.55 : -0.22)
        || dy > (trackerKind === "hybrid" ? 0.58 : HAND_FACE_Y_LIMIT)) return;
      if (dx <= (face.width ?? 0.18) / 2 + 0.015
        && Math.abs(dy) <= (face.height ?? 0.24) / 2 + 0.015) return;
      if (trackerKind !== "hybrid" && distances.some((distance, index) =>
        index !== ownerIndex && distance <= distances[ownerIndex] + AMBIGUOUS_FACE_MARGIN)) return;
      if (trackerKind === "hybrid" && ignoredFaces.some(({ face: ignored }) =>
        ignored.personId === hand.personId)) return;
      if (trackerKind !== "hybrid" && ignoredFaces.some(({ face: ignored }) =>
        handFaceDistance(hand, ignored) <= distances[ownerIndex] + AMBIGUOUS_FACE_MARGIN)) return;
      candidates.push({ hand, ownerIndex, slot, distance: distances[ownerIndex] });
    });
  });

  candidates.sort((a, b) => a.distance - b.distance);
  const usedHands = new Set();
  for (const candidate of candidates) {
    if (matches[candidate.ownerIndex] || usedHands.has(candidate.slot)) continue;
    matches[candidate.ownerIndex] = {
      ...candidate.hand,
      registrationSlot: candidate.hand.handSlot ?? candidate.slot,
    };
    usedHands.add(candidate.slot);
  }
  return matches;
}

export function handIdentity(hand, trackerKind) {
  if (!hand) return null;
  return trackerKind === "hybrid"
    ? `wrist:${hand.side}`
    : `slot:${hand.registrationSlot}`;
}

export function areHandCandidatesStable(candidates = [], playerCount, now, holdMs = HAND_LOCK_MS) {
  return candidates.length >= playerCount && candidates.slice(0, playerCount).every((candidate) =>
    candidate && Number.isFinite(candidate.since) && now - candidate.since >= holdMs);
}

export function getLockedHand(hands = [], slot, ownerIndex = null, boundary = 0.5) {
  const hand = slot == null ? null : hands[slot];
  if (!hand || hand.interactive === false) return null;
  if (ownerIndex === 0 && hand.x >= boundary) return null;
  if (ownerIndex === 1 && hand.x < boundary) return null;
  return hand;
}
