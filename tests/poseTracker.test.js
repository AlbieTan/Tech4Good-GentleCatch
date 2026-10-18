import { describe, expect, it } from "vitest";
import { PoseTracker } from "../src/poseTracker.js";

describe("pose tracker recovery", () => {
  it("reports presented camera frames separately from pose inferences", async () => {
    const statuses = [];
    const video = { readyState: 2, currentTime: 1, videoWidth: 480, videoHeight: 270,
      requestVideoFrameCallback: () => 1 };
    const tracker = new PoseTracker(video, () => {}, (status) => statuses.push(status));
    tracker.detector = { estimatePoses: async () => [] };
    tracker.running = true;
    await tracker.captureFrame(1000, { presentedFrames: 1 });
    video.currentTime = 2;
    await tracker.captureFrame(2000, { presentedFrames: 25 });
    expect(statuses.at(-1).cameraFps).toBe(24);
  });

  it("stops retrying a failed inference loop and reports a restartable failure", async () => {
    const statuses = [];
    const video = { readyState: 2, currentTime: 1, videoWidth: 480, videoHeight: 270,
      requestVideoFrameCallback: () => 1 };
    const tracker = new PoseTracker(video, () => {}, (status) => statuses.push(status));
    tracker.detector = { estimatePoses: async () => { throw new Error("WebGL context lost"); } };
    tracker.running = true;
    await tracker.captureFrame(1000);
    video.currentTime = 2;
    await tracker.captureFrame(1200);
    video.currentTime = 3;
    await tracker.captureFrame(1400);
    expect(statuses.map((status) => status.type)).toEqual(["error", "error", "fatal-error"]);
    expect(statuses.at(-1).message).toBe("WebGL context lost");
    expect(tracker.running).toBe(false);
  });
});
