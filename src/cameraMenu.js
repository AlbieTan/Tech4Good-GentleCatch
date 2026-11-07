import { FACE_FRESH_MS } from "./gameLogic.js";
import { associateHandsToFaces, selectRegistrationFaces } from "./registrationTracking.js";

export const CAMERA_MENU_HOLD_MS = 1200;
export const CAMERA_MENU_RELEASE_MS = 450;
export const CAMERA_MENU_DROPOUT_MS = 450;

// One raised hand chooses Solo; two separate people with a hand each choose
// Together. No face images or persistent identities are involved.
export function getCameraMenuChoice(hands = [], faces = [], now = performance.now(), trackerKind = "hybrid") {
  const pair = selectRegistrationFaces(faces, 2, now);
  if (pair) {
    const matches = associateHandsToFaces(hands, pair, trackerKind, now, faces);
    if (matches.every(Boolean)) return "pvp";
  }
  const solo = selectRegistrationFaces(faces, 1, now);
  return solo && associateHandsToFaces(hands, solo, trackerKind, now, faces)[0]
    ? "solo" : null;
}

export function stabilizeCameraMenuChoice(candidate, choice) {
  // Wait through a brief second-hand dropout instead of replacing a pending
  // Together choice with Solo. The dropout timer handles a sustained absence.
  return candidate?.choice === "pvp" && choice === "solo" ? null : choice;
}

export function advanceCameraMenu(candidate, choice, now, holdMs = CAMERA_MENU_HOLD_MS, identity = "") {
  const expired = candidate?.choice === "pvp" && now - candidate.lastSeen > CAMERA_MENU_DROPOUT_MS;
  if (!choice) {
    if (candidate?.choice !== "pvp" || expired) {
      return { candidate: null, progress: 0, selected: null };
    }
    const paused = { ...candidate, missingSince: candidate.missingSince ?? now };
    return { candidate: paused,
      progress: Math.min(1, (candidate.lastSeen - candidate.since) / holdMs),
      selected: null };
  }
  const next = !expired && candidate?.choice === choice && candidate.identity === identity
    ? { ...candidate, since: candidate.since + (candidate.missingSince == null ? 0 : now - candidate.lastSeen),
        lastSeen: now, missingSince: null }
    : { choice, identity, since: now, lastSeen: now, missingSince: null };
  const progress = Math.min(1, Math.max(0, now - next.since) / holdMs);
  return { candidate: next, progress, selected: progress >= 1 ? choice : null };
}

// Either player can choose a setting with one raised hand. Its position
// relative to that person's face selects the left, middle or right card.
export function getCameraSettingChoice(hands = [], faces = [], playerCount = 1,
  now = performance.now(), trackerKind = "hybrid", preferredSlots = []) {
  const selected = selectRegistrationFaces(faces, playerCount, now, preferredSlots);
  if (!selected) return null;
  const matches = associateHandsToFaces(hands, selected, trackerKind, now, faces);
  if (matches.filter(Boolean).length !== 1) return null;
  const ownerIndex = matches.findIndex(Boolean);
  const offset = matches[ownerIndex].x - selected[ownerIndex].face.x;
  return offset < -0.18 ? "left" : offset > 0.18 ? "right" : "middle";
}

export function hasRaisedMenuWrist(hands = [], now = performance.now(), trackerKind = "hybrid",
  faces = [], playerCount = 0, preferredSlots = []) {
  const selected = playerCount ? selectRegistrationFaces(faces, playerCount, now, preferredSlots) : null;
  const relevantHands = selected ? associateHandsToFaces(hands, selected, trackerKind, now, faces).filter(Boolean)
    : playerCount ? [] : hands;
  return relevantHands.some((hand) => hand?.interactive !== false
    && Number.isFinite(hand?.lastSeen) && now - hand.lastSeen <= FACE_FRESH_MS
    && (trackerKind === "hand" || ((hand.confidence ?? 0) >= 0.38
      && Number.isFinite(hand.shoulderY) && hand.y <= hand.shoulderY + 0.15)));
}

export function advanceCameraMenuRelease(since, raised, now, releaseMs = CAMERA_MENU_RELEASE_MS) {
  if (raised) return { since: null, armed: false };
  const nextSince = since ?? now;
  return { since: nextSince, armed: now - nextSince >= releaseMs };
}
