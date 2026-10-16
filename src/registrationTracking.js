import { FACE_FRESH_MS, HAND_FRESH_MS, getPlayerBoundary, isFreshDetection } from "./gameLogic.js";

export const FACE_LOCK_MS = 700;
export const HAND_LOCK_MS = 550;
const FACE_MOVE_LIMIT = 0.16;
const HAND_FACE_X_LIMIT = 0.38;
const HAND_FACE_Y_LIMIT = 0.36;
const AMBIGUOUS_FACE_MARGIN = 0.08;

export function selectRegistrationFaces(faces = [], playerCount = 1, now = performance.now()) {
  const selected = faces.map((face, slot) => ({ face, slot }))
    .filter(({ face }) => isFreshDetection(face, now, FACE_FRESH_MS))
    .sort((a, b) => (a.face.cameraX ?? a.face.x) - (b.face.cameraX ?? b.face.x));
  if (selected.length !== playerCount) return null;
  if (playerCount === 2 && getPlayerBoundary(selected.map(({ face }) => face)) === null) return null;
  return selected;
}

export function faceIdentity(face, slot, trackerKind) {
  return trackerKind === "hybrid" ? `pose:${face.personId}` : `slot:${slot}`;
}

export function sameFaceCandidates(previous = [], current = [], trackerKind) {
  return previous.length === current.length && current.every(({ face, slot }, index) => {
    const earlier = previous[index];
    return faceIdentity(face, slot, trackerKind) === earlier.identity
      && Math.hypot(face.x - earlier.x, face.y - earlier.y) <= FACE_MOVE_LIMIT;
  });
}

export function snapshotFaces(selected = [], trackerKind) {
  return selected.map(({ face, slot }) => ({
    identity: faceIdentity(face, slot, trackerKind),
    x: face.x,
    y: face.y,
    slot,
  }));
}

function handFaceDistance(hand, face) {
  return Math.hypot(hand.x - face.x, hand.y - face.y);
}

export function associateHandsToFaces(hands = [], selectedFaces = [], trackerKind = "hand", now = performance.now()) {
  if (!selectedFaces.length) return [];
  const faces = selectedFaces.map(({ face }) => face);
  const boundary = faces.length === 2 ? getPlayerBoundary(faces) : null;
  const matches = Array(selectedFaces.length).fill(null);
  const candidates = [];

  hands.forEach((hand, slot) => {
    if (!isFreshDetection(hand, now, trackerKind === "hybrid" ? 350 : HAND_FRESH_MS)
      || hand.y > 0.82) return;
    if (trackerKind === "hybrid"
      && ((hand.confidence ?? 0) < 0.55
        || !Number.isFinite(hand.shoulderY)
        || hand.y > hand.shoulderY + 0.12)) return;
    const distances = faces.map((face) => handFaceDistance(hand, face));
    selectedFaces.forEach(({ face }, ownerIndex) => {
      if (trackerKind === "hybrid" && hand.personId !== face.personId) return;
      if (trackerKind !== "hybrid" && boundary !== null
        && (ownerIndex === 0 ? hand.x >= boundary : hand.x < boundary)) return;
      const dx = Math.abs(hand.x - face.x);
      const dy = hand.y - face.y;
      if (dx > (trackerKind === "hybrid" ? 0.46 : HAND_FACE_X_LIMIT)
        || dy < -0.22 || dy > (trackerKind === "hybrid" ? 0.52 : HAND_FACE_Y_LIMIT)) return;
      if (dx <= (face.width ?? 0.18) / 2 + 0.015
        && Math.abs(dy) <= (face.height ?? 0.24) / 2 + 0.015) return;
      if (trackerKind !== "hybrid" && distances.some((distance, index) =>
        index !== ownerIndex && distance <= distances[ownerIndex] + AMBIGUOUS_FACE_MARGIN)) return;
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
    ? `pose:${hand.personId}:${hand.side}`
    : `slot:${hand.registrationSlot}`;
}

export function getLockedHand(hands = [], slot, ownerIndex = null, boundary = 0.5) {
  const hand = slot == null ? null : hands[slot];
  if (!hand || hand.interactive === false) return null;
  if (ownerIndex === 0 && hand.x >= boundary) return null;
  if (ownerIndex === 1 && hand.x < boundary) return null;
  return hand;
}
