import { HandTracker } from "./handTracker.js";
import { matchPoseHands } from "./hybridTrackingMath.js";
import { PoseTracker } from "./poseTracker.js";

export class HybridTracker {
  constructor(video, onHands, onStatus) {
    this.onHands = onHands;
    this.onStatus = onStatus;
    this.hands = [];
    this.faces = [];
    this.wrists = [];
    this.locks = [];
    this.poseStatus = null;
    this.handStatus = null;
    this.pose = new PoseTracker(video, (_hands, faces, wrists) => {
      this.faces = faces;
      this.wrists = wrists ?? [];
      this.emit();
    }, (status) => this.handleStatus("pose", status));
    this.hand = new HandTracker(video, (hands) => {
      this.hands = hands;
      this.emit();
    }, (status) => this.handleStatus("hand", status));
  }

  get faceTrackingReady() {
    return this.pose.faceTrackingReady;
  }

  async initialize() {
    await Promise.all([this.pose.initialize(), this.hand.initialize()]);
  }

  handleStatus(source, status) {
    if (status.type === "tracking") {
      if (source === "pose") this.poseStatus = status;
      else this.handStatus = status;
      this.onStatus({
        type: "tracking",
        faceCount: this.poseStatus?.faceCount ?? 0,
        count: this.handStatus?.count ?? 0,
        fps: this.poseStatus?.fps ?? 0,
        personIds: this.poseStatus?.personIds ?? [],
        matchedCount: matchPoseHands(this.wrists, this.hands, this.locks).length,
      });
    } else if (source === "pose" || status.type === "error") {
      this.onStatus(status);
    }
  }

  emit() {
    this.onHands(matchPoseHands(this.wrists, this.hands, this.locks), this.faces);
  }

  lockPlayers(locks) {
    this.locks = locks.map((lock) => ({ ...lock }));
  }

  unlockPlayers() {
    this.locks = [];
  }

  setFaceTrackingEnabled() {
    // Body poses supply player positions; the separate face detector is not needed.
  }

  setVideo(video) {
    this.pose.setVideo(video);
    this.hand.setVideo(video);
  }

  start() {
    this.pose.start();
    this.hand.start();
  }

  stop() {
    this.pose.stop();
    this.hand.stop();
    this.hands = [];
    this.faces = [];
    this.wrists = [];
    this.locks = [];
  }

  dispose() {
    this.pose.dispose();
    this.hand.dispose();
  }
}
