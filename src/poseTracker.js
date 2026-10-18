import { normalizePosePlayers } from "./poseTrackingMath.js";
import { FASTEST_POSE_INTERVAL_MS, nextPoseIntervalMs } from "./posePerformance.js";

// The pose model shares the main thread with the game on Pi-class GPUs.

export class PoseTracker {
  constructor(video, onHands, onStatus) {
    this.video = video;
    this.onHands = onHands;
    this.onStatus = onStatus;
    this.detector = null;
    this.initialization = null;
    this.running = false;
    this.inFlight = false;
    this.frameCallbackId = null;
    this.animationId = null;
    this.lastCaptureAt = -Infinity;
    this.targetIntervalMs = FASTEST_POSE_INTERVAL_MS;
    this.lastVideoTime = -1;
    this.generation = 0;
    this.lastResultAt = 0;
    this.cameraFps = 0;
    this.cameraFrames = 0;
    this.cameraFpsWindowAt = 0;
    this.lastPresentedFrameCount = null;
    this.consecutiveErrors = 0;
    this.faceTrackingReady = false;
  }

  initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = this.loadModel();
    return this.initialization;
  }

  async loadModel() {
    try {
      const [poseDetection, tf] = await Promise.all([
        import("@tensorflow-models/pose-detection"),
        import("@tensorflow/tfjs-core"),
        import("@tensorflow/tfjs-converter"),
        import("@tensorflow/tfjs-backend-webgl"),
      ]);
      if (!await tf.setBackend("webgl")) throw new Error("WebGL is unavailable for pose tracking.");
      await tf.ready();
      const baseUrl = new URL(import.meta.env.BASE_URL, document.baseURI);
      const modelUrl = new URL("models/movenet-multipose/model.json", baseUrl).href;
      this.detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
        modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
        modelUrl,
        enableTracking: true,
        trackerType: poseDetection.TrackerType.Keypoint,
        multiPoseMaxDimension: 256,
        minPoseScore: 0.35,
      });
      this.faceTrackingReady = true;
      this.onStatus({ type: "ready", backend: "MoveNet WebGL" });
      this.onStatus({ type: "face-ready" });
    } catch (error) {
      this.initialization = null;
      this.onStatus({ type: "error", message: error?.message || "Pose tracker could not load." });
      throw error;
    }
  }

  setFaceTrackingEnabled() {
    // MoveNet always tracks each person's pose; nose and wrists come from the same result.
  }

  setVideo(video) {
    if (this.video === video) return;
    this.cancelFrame();
    this.video = video;
    this.generation += 1;
    this.lastVideoTime = -1;
    this.lastCaptureAt = -Infinity;
    this.targetIntervalMs = FASTEST_POSE_INTERVAL_MS;
    this.cameraFpsWindowAt = 0;
    this.cameraFrames = 0;
    this.cameraFps = 0;
    this.lastPresentedFrameCount = null;
    if (this.running) this.scheduleFrame();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    this.lastVideoTime = -1;
    this.lastCaptureAt = -Infinity;
    this.targetIntervalMs = FASTEST_POSE_INTERVAL_MS;
    this.cameraFpsWindowAt = 0;
    this.cameraFrames = 0;
    this.cameraFps = 0;
    this.lastPresentedFrameCount = null;
    this.lastResultAt = 0;
    this.consecutiveErrors = 0;
    this.scheduleFrame();
  }

  stop() {
    this.running = false;
    this.generation += 1;
    this.cancelFrame();
    this.onHands([], []);
  }

  cancelFrame() {
    if (this.frameCallbackId !== null && this.video?.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.frameCallbackId);
    }
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    this.frameCallbackId = null;
    this.animationId = null;
  }

  scheduleFrame() {
    if (!this.running) return;
    if (this.video.requestVideoFrameCallback) {
      this.frameCallbackId = this.video.requestVideoFrameCallback((now, metadata) => this.captureFrame(now, metadata));
    } else {
      this.animationId = requestAnimationFrame((now) => this.captureFrame(now));
    }
  }

  async captureFrame(now, metadata) {
    this.frameCallbackId = null;
    this.animationId = null;
    if (this.running && Number.isFinite(metadata?.presentedFrames)) {
      if (!this.cameraFpsWindowAt) this.cameraFpsWindowAt = now;
      if (this.lastPresentedFrameCount !== null) {
        this.cameraFrames += Math.max(0, metadata.presentedFrames - this.lastPresentedFrameCount);
      }
      this.lastPresentedFrameCount = metadata.presentedFrames;
      const elapsed = now - this.cameraFpsWindowAt;
      if (elapsed >= 1000) {
        this.cameraFps = Math.round(this.cameraFrames * 1000 / elapsed);
        this.cameraFrames = 0;
        this.cameraFpsWindowAt = now;
      }
    }
    if (!this.running || !this.detector || this.inFlight || this.video.readyState < 2
      || this.video.currentTime === this.lastVideoTime || now - this.lastCaptureAt < this.targetIntervalMs) {
      this.scheduleFrame();
      return;
    }

    this.inFlight = true;
    this.lastCaptureAt = now;
    this.lastVideoTime = this.video.currentTime;
    const generation = this.generation;
    const startedAt = performance.now();
    try {
      const poses = await this.detector.estimatePoses(this.video, null, now);
      if (!this.running || generation !== this.generation) return;
      const result = normalizePosePlayers(poses, this.video.videoWidth, this.video.videoHeight, performance.now());
      this.consecutiveErrors = 0;
      const resultAt = performance.now();
      this.targetIntervalMs = nextPoseIntervalMs(resultAt - startedAt);
      const fps = this.lastResultAt ? Math.round(1000 / Math.max(1, resultAt - this.lastResultAt)) : 0;
      this.lastResultAt = resultAt;
      this.onHands(result.hands, result.faces, result.wrists);
      this.onStatus({
        type: "tracking",
        count: result.hands.length,
        faceCount: result.faces.length,
        personIds: result.faces.map((face) => face.personId),
        fps,
        cameraFps: this.cameraFps,
        inferenceMs: performance.now() - startedAt,
        frameAgeMs: resultAt - now,
        cameraWidth: this.video.videoWidth,
        cameraHeight: this.video.videoHeight,
        backend: "MoveNet WebGL",
      });
    } catch (error) {
      if (generation === this.generation) {
        this.consecutiveErrors += 1;
        const message = error?.message || "Pose detection failed.";
        if (this.consecutiveErrors >= 3) {
          this.running = false;
          this.onStatus({ type: "fatal-error", message });
        } else {
          this.onStatus({ type: "error", message });
        }
      }
    } finally {
      this.inFlight = false;
      this.scheduleFrame();
    }
  }

  dispose() {
    this.stop();
    this.detector?.dispose();
    this.detector = null;
    this.initialization = null;
    this.faceTrackingReady = false;
  }
}
