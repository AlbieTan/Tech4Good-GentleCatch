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
  if (!width || !height) return { hands: [], faces: [], wrists: [] };
  const hands = [];
  const faces = [];
  const trackedWrists = [];

  poses.filter((pose) => (pose.score ?? 0) >= MIN_POSE_SCORE).forEach((pose, index) => {
    const shoulders = [keypoint(pose, "left_shoulder"), keypoint(pose, "right_shoulder")].filter(usable);
    const nose = keypoint(pose, "nose");
    const headPoints = [nose, keypoint(pose, "left_eye"), keypoint(pose, "right_eye")].filter(usable);
    const facePoint = usable(nose) ? nose : headPoints.length >= 2
      ? { x: headPoints.reduce((sum, point) => sum + point.x, 0) / headPoints.length,
        y: headPoints.reduce((sum, point) => sum + point.y, 0) / headPoints.length,
        score: Math.min(...headPoints.map((point) => point.score)) }
      : null;
    const wrists = [keypoint(pose, "left_wrist"), keypoint(pose, "right_wrist")].filter(usable);
    const bodyPoint = shoulders.length
      ? { x: shoulders.reduce((sum, point) => sum + point.x, 0) / shoulders.length,
        y: shoulders.reduce((sum, point) => sum + point.y, 0) / shoulders.length }
      : facePoint;
    if (!usable(bodyPoint) && !shoulders.length) return;

    const personId = pose.id ?? `untracked-${index}`;
    const body = mirrored(bodyPoint, width, height);
    for (const side of ["left", "right"]) {
      const wrist = keypoint(pose, `${side}_wrist`);
      if (usable(wrist)) {
        const shoulder = keypoint(pose, `${side}_shoulder`);
        trackedWrists.push({
          ...mirrored(wrist, width, height),
          personId,
          side,
          bodyX: body.x,
          bodyY: body.y,
          shoulderY: usable(shoulder) ? mirrored(shoulder, width, height).y : null,
          confidence: wrist.score,
          lastSeen: timestamp,
          interactive: true,
        });
      }
    }
    if (usable(facePoint)) {
      const position = mirrored(facePoint, width, height);
      faces.push({
        ...position,
        cameraX: body.x,
        width: 0.16,
        height: 0.22,
        // Apparent shoulder span is a rough proximity cue for pose-first mode.
        proximity: shoulders.length === 2
          ? Math.abs(shoulders[0].x - shoulders[1].x) / width : 0,
        confidence: facePoint.score,
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

  return { hands, faces, wrists: trackedWrists };
}

// A detected face confirms presence; MoveNet supplies the corresponding
// body's temporary person ID and shoulder-centred camera position.
export function matchDetectedFacesToPoses(detectedFaces = [], poseFaces = [], now = performance.now()) {
  const freshFaces = detectedFaces.filter((face) => face?.interactive !== false
    && Number.isFinite(face?.lastSeen) && now - face.lastSeen <= 350);
  const freshPoses = poseFaces.filter((face) => face?.interactive !== false
    && Number.isFinite(face?.lastSeen) && now - face.lastSeen <= 350);
  const candidates = [];
  freshFaces.forEach((face, faceIndex) => {
    const distances = freshPoses.map((pose) => Math.hypot(face.x - pose.x, face.y - pose.y));
    const ordered = [...distances].sort((a, b) => a - b);
    if (ordered[0] == null || ordered[0] > 0.22
      || (ordered[1] != null && ordered[1] - ordered[0] < 0.05)) return;
    freshPoses.forEach((pose, poseIndex) => {
      if (distances[poseIndex] <= 0.22) candidates.push({ face, pose, faceIndex, poseIndex, distance: distances[poseIndex] });
    });
  });
  candidates.sort((a, b) => a.distance - b.distance);
  const usedFaces = new Set();
  const usedPoses = new Set();
  const matched = [];
  for (const candidate of candidates) {
    if (usedFaces.has(candidate.faceIndex) || usedPoses.has(candidate.poseIndex)) continue;
    usedFaces.add(candidate.faceIndex);
    usedPoses.add(candidate.poseIndex);
    matched.push({
      ...candidate.face,
      personId: candidate.pose.personId,
      cameraX: candidate.pose.cameraX,
      lastSeen: Math.min(candidate.face.lastSeen, candidate.pose.lastSeen),
    });
  }
  return matched;
}
