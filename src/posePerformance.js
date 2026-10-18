// Run more often when the GPU has headroom, but leave time for video and game rendering.
export const FASTEST_POSE_INTERVAL_MS = 1000 / 12;
export const SLOWEST_POSE_INTERVAL_MS = 350;

export function nextPoseIntervalMs(inferenceMs) {
  if (!Number.isFinite(inferenceMs) || inferenceMs <= 0) return FASTEST_POSE_INTERVAL_MS;
  return Math.min(SLOWEST_POSE_INTERVAL_MS,
    Math.max(FASTEST_POSE_INTERVAL_MS, inferenceMs * 1.5));
}
