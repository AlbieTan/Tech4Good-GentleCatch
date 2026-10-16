import { FaceTracker } from "./faceTracker.js";
import { PoseTracker } from "./poseTracker.js";
import { matchDetectedFacesToPoses } from "./poseTrackingMath.js";

// One continuous PvP inference model: MoveNet MultiPose. The face detector is
// only active during registration and re-entry, never during gameplay.
export class HybridTracker {
  constructor(video, onHands, onStatus) {
    this.onHands = onHands;
    this.onStatus = onStatus;
    this.poseFaces = [];
    this.detectedFaces = [];
    this.wrists = [];
    this.locks = [];
    this.poseStatus = null;
    this.faceStatus = null;
    this.running = false;
    this.faceTrackingEnabled = false;
    this.faceReady = false;
    this.pose = new PoseTracker(video, (_hands, faces, wrists) => {
      this.poseFaces = faces;
      this.wrists = wrists ?? [];
      this.emit();
    }, (status) => this.handleStatus("pose", status));
    this.face = new FaceTracker(video, (faces) => {
      this.detectedFaces = faces;
      this.emit();
    }, (status) => this.handleStatus("face", status));
  }

  get faceTrackingReady() {
    return this.faceReady;
  }

  async initialize() {
    await Promise.all([this.pose.initialize(), this.face.initialize()]);
  }

  handleStatus(source, status) {
    if (source === "pose" && status.type === "face-ready") return;
    if (source === "face" && status.type === "face-ready") this.faceReady = true;
    if (source === "face" && status.type === "face-error") this.faceReady = false;
    if (status.type === "tracking") {
      if (source === "pose") this.poseStatus = status;
      else this.faceStatus = status;
      const now = performance.now();
      const wrists = this.activeWrists(now);
      const faces = this.activeFaces(now);
      this.onStatus({
        type: "tracking",
        faceCount: faces.length,
        rawFaceCount: this.detectedFaces.filter((face) => face?.interactive).length,
        bodyCount: this.poseStatus?.faceCount ?? 0,
        count: wrists.length,
        fps: this.poseStatus?.fps ?? 0,
        inferenceMs: this.poseStatus?.inferenceMs ?? 0,
        faceInferenceMs: this.faceStatus?.faceInferenceMs ?? 0,
        personIds: this.poseStatus?.personIds ?? [],
        matchedCount: faces.filter((face) => wrists.some((wrist) => wrist.personId === face.personId)).length,
      });
    } else if (status.type !== "ready" || source === "pose") {
      this.onStatus(status);
    }
  }

  activeWrists(now = performance.now()) {
    const lockedSides = new Map(this.locks.map(({ personId, side }) => [personId, side]));
    return this.wrists.filter((wrist) => now - wrist.lastSeen <= 350
      && (!this.locks.length || lockedSides.get(wrist.personId) === wrist.side));
  }

  activeFaces(now = performance.now()) {
    return this.faceTrackingEnabled
      ? matchDetectedFacesToPoses(this.detectedFaces, this.poseFaces, now)
      : [];
  }

  emit() {
    this.onHands(this.activeWrists(), this.activeFaces());
  }

  lockPlayers(locks) {
    this.locks = locks.map((lock) => ({ ...lock }));
  }

  unlockPlayers() {
    this.locks = [];
  }

  setFaceTrackingEnabled(enabled) {
    this.faceTrackingEnabled = Boolean(enabled);
    if (this.running && this.faceTrackingEnabled) this.face.start();
    else if (!this.faceTrackingEnabled) {
      this.detectedFaces = [];
      this.face.stop();
    }
  }

  setVideo(video) {
    this.pose.setVideo(video);
    this.face.setVideo(video);
  }

  start() {
    this.running = true;
    this.pose.start();
    if (this.faceTrackingEnabled) this.face.start();
  }

  stop() {
    this.running = false;
    this.pose.stop();
    this.face.stop();
    this.poseFaces = [];
    this.detectedFaces = [];
    this.wrists = [];
  }

  dispose() {
    this.stop();
    this.locks = [];
    this.pose.dispose();
    this.face.dispose();
  }
}
