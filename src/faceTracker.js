import { presentFaceSlots, updateFaceSlots } from "./handTrackingMath.js";

const FACE_WIDTH = 640;
const FACE_HEIGHT = 360;
const FRAME_INTERVAL_MS = 1000 / 8;

export class FaceTracker {
  constructor(video, onFaces, onStatus) {
    this.video = video;
    this.onFaces = onFaces;
    this.onStatus = onStatus;
    this.worker = null;
    this.initialization = null;
    this.running = false;
    this.inFlight = false;
    this.generation = 0;
    this.lastCaptureAt = -Infinity;
    this.lastVideoTime = -1;
    this.frameCallbackId = null;
    this.animationId = null;
    this.slots = [null, null];
  }

  initialize() {
    if (this.initialization) return this.initialization;
    this.worker = new Worker(new URL("./faceTracker.worker.js", import.meta.url), { type: "module" });
    this.initialization = new Promise((resolve, reject) => {
      this.worker.addEventListener("message", ({ data }) => {
        if (data.type === "READY") {
          this.onStatus({ type: "face-ready" });
          resolve();
        } else if (data.type === "INIT_ERROR") {
          this.onStatus({ type: "face-error", message: data.error });
          reject(new Error(data.error));
        } else if (data.type === "RESULT" && data.generation === this.generation) {
          this.inFlight = false;
          const now = performance.now();
          this.slots = updateFaceSlots(this.slots, data.faces, now);
          const faces = presentFaceSlots(this.slots, now);
          this.onFaces(faces);
          this.onStatus({
            type: "tracking", faceCount: faces.filter((face) => face?.interactive).length,
            faceInferenceMs: data.inferenceMs,
          });
        } else if (data.type === "DETECT_ERROR" && data.generation === this.generation) {
          this.inFlight = false;
          this.onStatus({ type: "error", message: data.error });
        }
      });
      this.worker.addEventListener("error", (error) => {
        const message = error.message || "Face detector worker stopped.";
        this.onStatus({ type: "face-error", message });
        reject(new Error(message));
      });
    });
    const baseUrl = new URL(import.meta.env.BASE_URL, document.baseURI);
    this.worker.postMessage({
      type: "INIT",
      wasmBaseUrl: new URL("wasm", baseUrl).href,
      modelUrl: new URL("models/blaze_face_short_range.tflite", baseUrl).href,
    });
    return this.initialization;
  }

  setVideo(video) {
    if (this.video === video) return;
    const wasRunning = this.running;
    this.stop();
    this.video = video;
    if (wasRunning) this.start();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    this.slots = [null, null];
    this.inFlight = false;
    this.lastCaptureAt = -Infinity;
    this.lastVideoTime = -1;
    this.scheduleFrame();
  }

  stop() {
    this.running = false;
    this.generation += 1;
    if (this.frameCallbackId !== null && this.video?.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.frameCallbackId);
    }
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    this.frameCallbackId = null;
    this.animationId = null;
    this.slots = [null, null];
    this.inFlight = false;
    this.onFaces([]);
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
    if (!this.running || this.inFlight || this.video.readyState < 2
      || this.video.currentTime === this.lastVideoTime || now - this.lastCaptureAt < FRAME_INTERVAL_MS) {
      this.scheduleFrame();
      return;
    }
    this.inFlight = true;
    this.lastCaptureAt = now;
    this.lastVideoTime = this.video.currentTime;
    const generation = this.generation;
    try {
      const bitmap = await createImageBitmap(this.video, {
        resizeWidth: FACE_WIDTH, resizeHeight: FACE_HEIGHT, resizeQuality: "medium",
      });
      if (!this.running || generation !== this.generation) {
        bitmap.close();
        return;
      }
      this.worker.postMessage({ type: "DETECT", bitmap, generation, timestampMs: now }, [bitmap]);
    } catch (error) {
      this.inFlight = false;
      this.onStatus({ type: "error", message: error?.message || "Could not read a face frame." });
    } finally {
      this.scheduleFrame();
    }
  }

  dispose() {
    this.stop();
    this.worker?.postMessage({ type: "CLOSE" });
    this.worker = null;
    this.initialization = null;
  }
}
