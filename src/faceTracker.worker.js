import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

let detector = null;

self.addEventListener("message", async ({ data }) => {
  if (data.type === "INIT") {
    try {
      const response = await fetch(data.modelUrl);
      if (!response.ok) throw new Error(`Face model failed to load (${response.status}).`);
      const vision = await FilesetResolver.forVisionTasks(data.wasmBaseUrl, true);
      detector = await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: new Uint8Array(await response.arrayBuffer()), delegate: "CPU" },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.4,
        minSuppressionThreshold: 0.3,
      });
      self.postMessage({ type: "READY" });
    } catch (error) {
      self.postMessage({ type: "INIT_ERROR", error: error?.message || "Face detector could not load." });
    }
    return;
  }

  if (data.type === "DETECT") {
    try {
      if (!detector) throw new Error("Face detector is not ready.");
      const startedAt = performance.now();
      const result = detector.detectForVideo(data.bitmap, data.timestampMs);
      const faces = result.detections.map(({ boundingBox, categories }) => boundingBox && ({
        x: (boundingBox.originX + boundingBox.width / 2) / data.bitmap.width,
        y: (boundingBox.originY + boundingBox.height / 2) / data.bitmap.height,
        width: boundingBox.width / data.bitmap.width,
        height: boundingBox.height / data.bitmap.height,
        confidence: categories?.[0]?.score ?? 1,
      })).filter(Boolean);
      self.postMessage({
        type: "RESULT", generation: data.generation, faces,
        inferenceMs: performance.now() - startedAt,
      });
    } catch (error) {
      self.postMessage({
        type: "DETECT_ERROR", generation: data.generation,
        error: error?.message || "Face detection failed.",
      });
    } finally {
      data.bitmap.close();
    }
    return;
  }

  if (data.type === "CLOSE") {
    detector?.close();
    detector = null;
    self.close();
  }
});
