const MAX_WRIST_DISTANCE = 0.22;
const AMBIGUITY_MARGIN = 0.035;
const POSE_FRESH_MS = 300;
const HAND_FRESH_MS = 220;

export function matchPoseHands(wrists = [], hands = [], locks = [], now = performance.now()) {
  const lockedSides = new Map(locks.filter((lock) => lock?.personId != null)
    .map((lock) => [lock.personId, lock.side]));
  const candidates = [];
  const freshWrists = wrists.filter((wrist) =>
    now - wrist.lastSeen <= POSE_FRESH_MS && wrist.interactive !== false);

  hands.forEach((hand, slotIndex) => {
    if (!hand || hand.interactive === false || now - hand.lastSeen > HAND_FRESH_MS) return;
    const nearby = freshWrists.map((wrist) => ({
      wrist,
      distance: Math.hypot((hand.wristX ?? hand.x) - wrist.x, (hand.wristY ?? hand.y) - wrist.y),
    })).sort((first, second) => first.distance - second.distance);
    const nearest = nearby[0];
    if (!nearest || nearest.distance > MAX_WRIST_DISTANCE) return;
    if (nearby[1] && nearby[1].distance - nearest.distance < AMBIGUITY_MARGIN) return;
    if (lockedSides.has(nearest.wrist.personId)
      && lockedSides.get(nearest.wrist.personId) !== nearest.wrist.side) return;
    candidates.push({ ...nearest, hand, slotIndex });
  });

  candidates.sort((first, second) => first.distance - second.distance);
  const usedPeople = new Set();
  const usedHands = new Set();
  const matched = [];
  for (const { wrist, hand, slotIndex, distance } of candidates) {
    if (usedPeople.has(wrist.personId) || usedHands.has(slotIndex)) continue;
    usedPeople.add(wrist.personId);
    usedHands.add(slotIndex);
    matched.push({
      ...hand,
      personId: wrist.personId,
      side: wrist.side,
      handSlot: slotIndex,
      matchDistance: distance,
      confidence: Math.min(hand.confidence ?? 1, wrist.confidence ?? 1),
      lastSeen: Math.min(hand.lastSeen, wrist.lastSeen),
      interactive: true,
    });
  }
  return matched;
}
