import { PoseTracker } from "./poseTracker.js";
import { reconcilePoseLocks } from "./poseOwnership.js";

// Keep registration and play on one inference clock. Running a second face
// worker alongside MoveNet made the two results too sparse to pair on Pi-class
// hardware, so the pose's nose keypoint is the face-presence check here.
export class HybridTracker {
  constructor(video, onHands, onStatus) {
    this.onHands = onHands;
    this.onStatus = onStatus;
    this.poseFaces = [];
    this.wrists = [];
    this.assignedWrists = [];
    this.locks = [];
    this.boundary = 0.5;
    this.poseStatus = null;
    this.running = false;
    this.faceTrackingEnabled = false;
    this.faceReady = false;
    this.pose = new PoseTracker(video, (_hands, faces, wrists) => {
      this.poseFaces = faces;
      this.wrists = wrists ?? [];
      if (this.locks.length) {
        const result = reconcilePoseLocks(this.locks, this.wrists, performance.now(), this.boundary);
        this.locks = result.locks;
        this.assignedWrists = result.assigned.filter(Boolean);
        if (result.rebound.length) this.onStatus({ type: "pose-rebound", changes: result.rebound });
      }
      this.emit();
    }, (status) => this.handleStatus("pose", status));
  }

  get faceTrackingReady() {
    return this.faceReady;
  }

  async initialize() {
    await this.pose.initialize();
  }

  handleStatus(_source, status) {
    if (status.type === "face-ready") this.faceReady = true;
    if (status.type === "tracking") {
      this.poseStatus = status;
      const now = performance.now();
      const wrists = this.activeWrists(now);
      const faces = this.activeFaces(now);
      this.onStatus({
        type: "tracking",
        faceCount: faces.length,
        rawFaceCount: this.poseFaces.length,
        bodyCount: this.poseStatus?.faceCount ?? 0,
        count: wrists.length,
        fps: this.poseStatus?.fps ?? 0,
        cameraFps: this.poseStatus?.cameraFps ?? 0,
        inferenceMs: this.poseStatus?.inferenceMs ?? 0,
        frameAgeMs: this.poseStatus?.frameAgeMs ?? 0,
        cameraWidth: this.poseStatus?.cameraWidth ?? 0,
        cameraHeight: this.poseStatus?.cameraHeight ?? 0,
        faceInferenceMs: 0,
        personIds: this.poseStatus?.personIds ?? [],
        matchedCount: faces.filter((face) => wrists.some((wrist) => wrist.personId === face.personId)).length,
      });
    } else {
      this.onStatus(status);
    }
  }

  activeWrists(now = performance.now()) {
    const source = this.locks.length ? this.assignedWrists : this.wrists;
    return source.filter((wrist) => now - wrist.lastSeen <= 350);
  }

  activeFaces(now = performance.now()) {
    return this.faceTrackingEnabled
      ? this.poseFaces.filter((face) => now - face.lastSeen <= 350)
      : [];
  }

  emit() {
    this.onHands(this.activeWrists(), this.activeFaces());
  }

  lockPlayers(locks, boundary = 0.5) {
    this.boundary = boundary;
    this.locks = locks.map((lock) => ({ ...lock, lastSeen: performance.now(),
      candidateId: null, candidateSince: null }));
    const result = reconcilePoseLocks(this.locks, this.wrists, performance.now(), this.boundary);
    this.locks = result.locks;
    this.assignedWrists = result.assigned.filter(Boolean);
  }

  unlockPlayers() {
    this.locks = [];
    this.assignedWrists = [];
  }

  setFaceTrackingEnabled(enabled) {
    this.faceTrackingEnabled = Boolean(enabled);
  }

  setVideo(video) {
    this.pose.setVideo(video);
  }

  start() {
    this.running = true;
    this.pose.start();
  }

  stop() {
    this.running = false;
    this.pose.stop();
    this.poseFaces = [];
    this.wrists = [];
    this.assignedWrists = [];
  }

  dispose() {
    this.stop();
    this.locks = [];
    this.pose.dispose();
    this.faceReady = false;
  }
}
