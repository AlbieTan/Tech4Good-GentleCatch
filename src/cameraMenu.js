import { FACE_FRESH_MS } from "./gameLogic.js";
import { associateHandsToFaces, selectRegistrationFaces } from "./registrationTracking.js";

export const CAMERA_MENU_HOLD_MS = 1200;
export const CAMERA_MENU_RELEASE_MS = 450;

// One raised hand chooses Solo; two separate people with a hand each choose
// Together. No face images or persistent identities are involved.
export function getCameraMenuChoice(hands = [], faces = [], now = performance.now(), trackerKind = "hybrid") {
  const visible = faces.filter((face) => face?.interactive !== false
    && Number.isFinite(face?.lastSeen) && now - face.lastSeen <= FACE_FRESH_MS);
  if (visible.length !== 1 && visible.length !== 2) return null;
  const selected = selectRegistrationFaces(visible, visible.length, now);
  if (!selected) return null;
  const matches = associateHandsToFaces(hands, selected, trackerKind, now);
  return matches.length === visible.length && matches.every(Boolean)
    ? visible.length === 2 ? "pvp" : "solo"
    : null;
}

export function advanceCameraMenu(candidate, choice, now, holdMs = CAMERA_MENU_HOLD_MS) {
  if (!choice) return { candidate: null, progress: 0, selected: null };
  const next = candidate?.choice === choice ? candidate : { choice, since: now };
  const progress = Math.min(1, Math.max(0, now - next.since) / holdMs);
  return { candidate: next, progress, selected: progress >= 1 ? choice : null };
}

// Either player can choose a setting with one raised hand. Its position
// relative to that person's face selects the left, middle or right card.
export function getCameraSettingChoice(hands = [], faces = [], playerCount = 1,
  now = performance.now(), trackerKind = "hybrid") {
  const selected = selectRegistrationFaces(faces, playerCount, now);
  if (!selected) return null;
  const matches = associateHandsToFaces(hands, selected, trackerKind, now);
  if (matches.filter(Boolean).length !== 1) return null;
  const ownerIndex = matches.findIndex(Boolean);
  const offset = matches[ownerIndex].x - selected[ownerIndex].face.x;
  return offset < -0.18 ? "left" : offset > 0.18 ? "right" : "middle";
}

export function hasRaisedMenuWrist(hands = [], now = performance.now(), trackerKind = "hybrid") {
  return hands.some((hand) => hand?.interactive !== false
    && Number.isFinite(hand?.lastSeen) && now - hand.lastSeen <= FACE_FRESH_MS
    && (trackerKind === "hand" || ((hand.confidence ?? 0) >= 0.38
      && Number.isFinite(hand.shoulderY) && hand.y <= hand.shoulderY + 0.15)));
}

export function advanceCameraMenuRelease(since, raised, now, releaseMs = CAMERA_MENU_RELEASE_MS) {
  if (raised) return { since: null, armed: false };
  const nextSince = since ?? now;
  return { since: nextSince, armed: now - nextSince >= releaseMs };
}
