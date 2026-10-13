# Third-party notices

Gentle Catch includes the following MediaPipe components for local hand and face-position tracking:

- `@mediapipe/tasks-vision` 1.0.1, licensed under the Apache License 2.0.
- MediaPipe Hand Landmarker model (`hand_landmarker.task`), downloaded from the official [MediaPipe model repository](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task).
- MediaPipe BlazeFace short-range model (`blaze_face_short_range.tflite`), downloaded from the official [MediaPipe model repository](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite).

MediaPipe source and license information are available from the [Google AI Edge MediaPipe repository](https://github.com/google-ai-edge/mediapipe).

The optional two-player body-tracking prototype uses TensorFlow.js (`@tensorflow-models/pose-detection`, `@tensorflow/tfjs-core`, `@tensorflow/tfjs-converter`, and `@tensorflow/tfjs-backend-webgl`) and the Google MoveNet MultiPose Lightning v1 TensorFlow.js model. The model archive was downloaded from the official [Kaggle model page](https://www.kaggle.com/models/google/movenet/tfJs/multipose-lightning/1) and is bundled in `public/models/movenet-multipose/`. TensorFlow.js and this model are distributed under Apache License 2.0; see the [TensorFlow.js repository](https://github.com/tensorflow/tfjs) and the model page for details.

The Precious Active Ageing Centre and Nanyang Technological University Singapore logos are unmodified brand assets sourced from their official websites for this student/community project. They remain the property of their respective owners; confirm institutional approval before public deployment or promotional use.
