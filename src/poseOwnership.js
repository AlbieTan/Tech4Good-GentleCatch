// A pose ID is only a short-lived continuity hint. Keep each control attached
// to a torso in its registered zone; never claim a wrist just because it is
// the nearest hand on screen.
const WRIST_FRESH_MS = 350;
const ID_CHANGE_GRACE_MS = 450;
const REBIND_HOLD_MS = 170;
const MAX_BODY_STEP = 0.2;
const MAX_WRIST_STEP = 0.38;
const CENTRE_GAP = 0.025;

function inZone(bodyX, ownerIndex, boundary) {
  return ownerIndex === 0 ? bodyX < boundary - CENTRE_GAP : bodyX > boundary + CENTRE_GAP;
}

function validWrist(wrist, now) {
  return wrist?.interactive !== false && Number.isFinite(wrist?.bodyX)
    && Number.isFinite(wrist?.x) && Number.isFinite(wrist?.y)
    && Number.isFinite(wrist?.lastSeen) && now - wrist.lastSeen >= 0
    && now - wrist.lastSeen <= WRIST_FRESH_MS && (wrist.confidence ?? 0) >= 0.3;
}

function nearLock(wrist, lock, now) {
  if (Math.abs(wrist.bodyX - lock.bodyX) > MAX_BODY_STEP) return false;
  if (!Number.isFinite(lock.wristX) || !Number.isFinite(lock.wristY)) return true;
  const elapsed = Math.max(0, now - lock.lastSeen) / 1000;
  return Math.hypot(wrist.x - lock.wristX, wrist.y - lock.wristY)
    <= MAX_WRIST_STEP + elapsed * 1.2;
}

export function reconcilePoseLocks(locks = [], wrists = [], now, boundary = 0.5) {
  const fresh = wrists.filter((wrist) => validWrist(wrist, now));
  const assigned = Array(locks.length).fill(null);
  const rebound = [];
  const nextLocks = locks.map((original, ownerIndex) => {
    const lock = { ...original };
    const eligible = fresh.filter((wrist) => wrist.side === lock.side
      && (locks.length === 1 || inZone(wrist.bodyX, ownerIndex, boundary))
      && nearLock(wrist, lock, now));
    const exact = eligible.filter((wrist) => wrist.personId === lock.personId);
    if (exact.length === 1) {
      assigned[ownerIndex] = { ...exact[0], ownerIndex };
      return { ...lock, bodyX: exact[0].bodyX, wristX: exact[0].x,
        wristY: exact[0].y, lastSeen: now, candidateId: null, candidateSince: null };
    }

    // A new ID can be accepted only after consecutive, unambiguous frames
    // while the same torso remains in the registered zone. A long absence
    // always goes through the explicit recovery check instead.
    const candidates = eligible.filter((wrist) =>
      wrist.personId !== lock.personId && !locks.some((other, index) =>
        index !== ownerIndex && other.personId === wrist.personId));
    if (now - lock.lastSeen > ID_CHANGE_GRACE_MS || candidates.length !== 1) {
      return { ...lock, candidateId: null, candidateSince: null };
    }
    const candidate = candidates[0];
    if (lock.candidateId !== candidate.personId) {
      return { ...lock, candidateId: candidate.personId, candidateSince: now };
    }
    if (now - lock.candidateSince < REBIND_HOLD_MS) return lock;
    assigned[ownerIndex] = { ...candidate, ownerIndex };
    rebound.push({ ownerIndex, personId: candidate.personId });
    return { ...lock, personId: candidate.personId, bodyX: candidate.bodyX,
      wristX: candidate.x, wristY: candidate.y, lastSeen: now,
      candidateId: null, candidateSince: null };
  });
  return { locks: nextLocks, assigned, rebound };
}

export function sameRegisteredPosePlayers(selected = [], matches = [], personIds = [], sides = []) {
  return selected.length === personIds.length && matches.length === personIds.length
    && selected.every(({ face }, index) => face?.personId === personIds[index]
      && matches[index]?.personId === personIds[index]
      && matches[index]?.side === sides[index]);
}
