import { normalizePosePlayers } from "./poseTrackingMath.js";

const TARGET_INTERVAL_MS = 1000 / 12;

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
    this.lastVideoTime = -1;
    this.generation = 0;
    this.lastResultAt = 0;
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
        multiPoseMaxDimension: 320,
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
    if (this.running) this.scheduleFrame();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    this.lastVideoTime = -1;
    this.lastCaptureAt = -Infinity;
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
      this.frameCallbackId = this.video.requestVideoFrameCallback((now) => this.captureFrame(now));
    } else {
      this.animationId = requestAnimationFrame((now) => this.captureFrame(now));
    }
  }

  async captureFrame(now) {
    this.frameCallbackId = null;
    this.animationId = null;
    if (!this.running || !this.detector || this.inFlight || this.video.readyState < 2
      || this.video.currentTime === this.lastVideoTime || now - this.lastCaptureAt < TARGET_INTERVAL_MS) {
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
      const resultAt = performance.now();
      const fps = this.lastResultAt ? Math.round(1000 / Math.max(1, resultAt - this.lastResultAt)) : 0;
      this.lastResultAt = resultAt;
      this.onHands(result.hands, result.faces);
      this.onStatus({
        type: "tracking",
        count: result.hands.length,
        faceCount: result.faces.length,
        personIds: result.faces.map((face) => face.personId),
        fps,
        inferenceMs: performance.now() - startedAt,
        backend: "MoveNet WebGL",
      });
    } catch (error) {
      if (generation === this.generation) {
        this.onStatus({ type: "error", message: error?.message || "Pose detection failed." });
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
