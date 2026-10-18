import { describe, expect, it } from "vitest";
import { reconcilePoseLocks, sameRegisteredPosePlayers } from "../src/poseOwnership.js";

const locks = [
  { personId: 1, side: "left", bodyX: 0.25, wristX: 0.3, wristY: 0.45, lastSeen: 1000 },
  { personId: 2, side: "right", bodyX: 0.75, wristX: 0.7, wristY: 0.45, lastSeen: 1000 },
];
const wrist = (personId, bodyX, x, lastSeen = 1080, side = "left") => ({
  personId, bodyX, x, y: 0.46, lastSeen, side, confidence: 0.9, interactive: true,
});

describe("pose ownership", () => {
  it("keeps crossed wrists with their original torso and lane", () => {
    const result = reconcilePoseLocks(locks, [
      wrist(1, 0.26, 0.58), wrist(2, 0.74, 0.42, 1080, "right"),
    ], 1080);
    expect(result.assigned.map((hand) => hand?.personId)).toEqual([1, 2]);
    expect(result.assigned.map((hand) => hand?.ownerIndex)).toEqual([0, 1]);
  });

  it("allows a solo player to use either side of the camera", () => {
    const solo = [{ personId: 3, side: "left", bodyX: 0.72,
      wristX: 0.76, wristY: 0.45, lastSeen: 1000 }];
    expect(reconcilePoseLocks(solo, [wrist(3, 0.73, 0.77)], 1080).assigned[0])
      .toMatchObject({ personId: 3, ownerIndex: 0 });
  });

  it("ignores a temporary ID change until the same torso is stable", () => {
    const first = reconcilePoseLocks(locks, [wrist(7, 0.26, 0.31)], 1080);
    expect(first.assigned[0]).toBeNull();
    const second = reconcilePoseLocks(first.locks, [wrist(7, 0.27, 0.32, 1180)], 1180);
    expect(second.assigned[0]).toBeNull();
    const third = reconcilePoseLocks(second.locks, [wrist(7, 0.28, 0.33, 1270)], 1270);
    expect(third.assigned[0]).toMatchObject({ personId: 7, ownerIndex: 0 });
    expect(third.rebound).toEqual([{ ownerIndex: 0, personId: 7 }]);
  });

  it("does not rebind after an absence or when two bodies are ambiguous", () => {
    const absent = reconcilePoseLocks(locks, [wrist(7, 0.26, 0.31, 1510)], 1510);
    expect(absent.assigned[0]).toBeNull();
    expect(absent.locks[0].candidateId).toBeNull();
    const ambiguous = reconcilePoseLocks(locks, [
      wrist(7, 0.26, 0.31), wrist(8, 0.28, 0.33),
    ], 1080);
    expect(ambiguous.assigned[0]).toBeNull();
    expect(ambiguous.locks[0].candidateId).toBeNull();
  });

  it("does not switch players across sides or accept a wrist teleport", () => {
    const sides = reconcilePoseLocks(locks, [
      wrist(1, 0.75, 0.7), wrist(2, 0.25, 0.3, 1080, "right"),
    ], 1080);
    expect(sides.assigned).toEqual([null, null]);
    const jump = reconcilePoseLocks(locks, [wrist(1, 0.26, 0.95)], 1080);
    expect(jump.assigned[0]).toBeNull();
  });

  it("permits automatic recovery only with the original IDs and wrist sides", () => {
    const selected = [{ face: { personId: 1 } }, { face: { personId: 2 } }];
    const matches = [{ personId: 1, side: "left" }, { personId: 2, side: "right" }];
    expect(sameRegisteredPosePlayers(selected, matches, [1, 2], ["left", "right"]))
      .toBe(true);
    expect(sameRegisteredPosePlayers(selected, [{ ...matches[0], personId: 9 }, matches[1]],
      [1, 2], ["left", "right"])).toBe(false);
    expect(sameRegisteredPosePlayers(selected, matches, [2, 1], ["left", "right"]))
      .toBe(false);
  });
});
