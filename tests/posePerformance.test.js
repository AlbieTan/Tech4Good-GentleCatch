import { describe, expect, it } from "vitest";
import { FASTEST_POSE_INTERVAL_MS, nextPoseIntervalMs } from "../src/posePerformance.js";

describe("adaptive pose cadence", () => {
  it("allows up to 12 inferences per second when the GPU is quick", () => {
    expect(nextPoseIntervalMs(40)).toBe(FASTEST_POSE_INTERVAL_MS);
  });

  it("backs off as inference gets slower, leaving rendering headroom", () => {
    expect(nextPoseIntervalMs(100)).toBe(150);
    expect(nextPoseIntervalMs(300)).toBe(350);
  });

  it("recovers from invalid timing without stopping tracking", () => {
    expect(nextPoseIntervalMs(NaN)).toBe(FASTEST_POSE_INTERVAL_MS);
  });
});
