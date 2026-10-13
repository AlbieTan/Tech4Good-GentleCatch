import { clamp } from "./gameLogic.js";

const MIN_POSE_SCORE = 0.35;
const MIN_KEYPOINT_SCORE = 0.3;

function keypoint(pose, name) {
  return pose.keypoints?.find((point) => point.name === name);
}

function usable(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && (point.score ?? 0) >= MIN_KEYPOINT_SCORE;
}

function mirrored(point, width, height) {
  return {
    x: clamp(1 - point.x / width, 0.02, 0.98),
    y: clamp(point.y / height, 0.02, 0.98),
  };
}

export function normalizePosePlayers(poses = [], width, height, timestamp) {
  if (!width || !height) return { hands: [], faces: [] };
  const hands = [];
  const faces = [];

  poses.filter((pose) => (pose.score ?? 0) >= MIN_POSE_SCORE).forEach((pose, index) => {
    const shoulders = [keypoint(pose, "left_shoulder"), keypoint(pose, "right_shoulder")].filter(usable);
    const nose = keypoint(pose, "nose");
    const wrists = [keypoint(pose, "left_wrist"), keypoint(pose, "right_wrist")].filter(usable);
    const bodyPoint = shoulders.length
      ? { x: shoulders.reduce((sum, point) => sum + point.x, 0) / shoulders.length,
        y: shoulders.reduce((sum, point) => sum + point.y, 0) / shoulders.length }
      : nose;
    if (!usable(bodyPoint) && !shoulders.length) return;

    const personId = pose.id ?? `untracked-${index}`;
    const body = mirrored(bodyPoint, width, height);
    if (usable(nose)) {
      const position = mirrored(nose, width, height);
      faces.push({
        ...position,
        cameraX: body.x,
        width: 0.16,
        height: 0.22,
        confidence: nose.score,
        personId,
        lastSeen: timestamp,
        interactive: true,
      });
    }
    if (wrists.length) {
      const wrist = wrists.reduce((best, point) => point.score > best.score ? point : best);
      hands.push({
        ...mirrored(wrist, width, height),
        confidence: wrist.score,
        personId,
        lastSeen: timestamp,
        interactive: true,
      });
    }
  });

  return { hands, faces };
}
