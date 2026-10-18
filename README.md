# Gentle Catch

## Kiosk enhancements

The camera-only kiosk flow starts with an eight-second safety notice, then gesture-controlled choices for player count, difficulty and round length. Face-and-palm registration precedes a three-second countdown, gameplay and automatic return to the gesture menu after results. The classic mouse menu remains available for staff from the footer. Kiosk play now uses the MediaPipe palm tracker in a worker; the separate pose-first beta remains available only in the classic menu. Raspberry Pi performance is still under evaluation, not release-validated. See the [Pi kiosk guide](docs/raspberry-pi-kiosk.md) before installation.

Gentle Catch is a calm, camera-controlled movement game designed with older adults in mind and branded for Precious Active Ageing Centre. Leaves, flowers, hearts, and stars drift down the screen; players collect them with one or both hands while avoiding bombs and germs. Consecutive catches build a score multiplier, while touching a hazard deducts points and resets the streak.

Built on Hakrrrm’s initial v1 prototype. AlbieTan developed v2 and v3, redesigning the UI and adding the two-player PvP and player-registration flows.

The startup flow supports solo play and a local split-screen battle. Camera sessions do not begin immediately: registration first holds each visible face steady, then looks for a raised hand or wrist associated with that player. Once registration succeeds, those player controls stay frozen through the three-second countdown so brief tracking changes cannot restart it. Face detection switches off during normal gameplay. If a player stays out of frame, the round pauses, asks that player to return, and temporarily re-enables face detection to reconnect controls before continuing. This is positional tracking only—not facial recognition—and no image or identity data is stored. Each player controls one half of the arena and receives the same sequence of objects, making the score duel easy to follow and fair.

The two-player setup also offers **Pose-first PvP tracking (beta)**. MoveNet MultiPose supplies each person's face point (nose), torso and wrist in the same result, and the selected wrist drives their cursor. Registration requires two visible face points and raised wrists before locking temporary pose IDs, torso zones and left/right wrists. An extra visible person blocks registration. A brief ID change can reconnect only when one torso remains near its previous position on the original side; ambiguous hands do not score. After a longer absence, the round pauses and asks a caregiver or players to confirm the same people are in their original positions before continuing, even if temporary tracking IDs stayed the same. This is positional continuity, not biometric identity verification. The bundled pose model needs WebGL; if that fails, uncheck the beta option and use the previous hand tracker.

The camera-only kiosk is now the default landing page (for example, `http://127.0.0.1:8000/`). Its branded camera-space warning remains visible for at least eight seconds, even if the camera and model become ready sooner. The gesture menu then chooses players, difficulty and round time in three steps. One raised hand selects Solo; two people each raise a hand for PvP. For the next two steps, either player raises one hand and moves it left, above or right of their face to choose Gentle/Steady/Lively and 20/30/60 seconds. Lower hands briefly between choices so one gesture cannot select two steps. Registration and the three-second countdown follow. The same camera video element runs from registration into play, avoiding a second playback handoff. After each round it shows scores for eight seconds and returns directly to the camera menu, reusing a healthy camera and model. A prolonged missing player or sustained extra person ends the round instead of handing controls to a newcomer. The footer links to the classic mouse-driven page at `?mode=manual`. A helper must grant Chromium camera permission once during installation. See [Raspberry Pi kiosk setup](docs/raspberry-pi-kiosk.md).

## Tracking and performance design

The kiosk tracker requests a 640 × 360 camera stream and sends downsampled 384 × 216 frames to a MediaPipe palm detector in a Web Worker, with a 30 FPS ceiling. It never queues an inference frame while another is busy. Face checks run at most 8 times per second during the menu, registration and recovery, then switch off during normal play. Cursor presentation runs with the display refresh and uses bounded prediction to soften the effect of inference latency. The classic menu's optional pose-first beta requests about 480 × 270 at up to 24 camera frames per second and runs MoveNet MultiPose on WebGL. The game loop is capped at 30 updates per second. Diagnostics report palm or pose FPS, inference time and frame age. These are ceilings, not guaranteed rates: benchmark two-person play and menu reset on the actual Raspberry Pi 4/5 before deployment. Pi 4 PvP may still be too slow. All models are bundled locally, so there is no model download during play.

No image or video leaves the device. Model inference happens locally in browser memory.

## Laptop quick start

Requirements: Node.js 20.19+ or 22.12+ and a current Chrome, Edge, or Firefox browser.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, select solo or two-player play, choose a pace, and allow camera access. Camera access requires `localhost` or HTTPS. An evenly lit room and uncluttered background give the most stable tracking. Keyboard practice is available for solo play with the arrow keys or W, A, S, and D.

## Controls and accessibility

- **Gentle, Steady, Lively** adjust fall speed, spawn interval, object count, and missed-object allowance.
- Sessions can be 20 seconds, 30 seconds, or 1 minute.
- Pause or end a session at any time. Space or Escape also pauses when playing with the keyboard.
- The game supports keyboard navigation, large controls, semantic labels, reduced motion, high contrast preferences, and responsive layouts.
- One or both hands can be used simultaneously. Each palm gets its own cursor.
- In two-player mode, the two registered faces set a left/right boundary. Each player controls their lane with one hand on their side of the camera, so changes in the detector's hand order cannot switch players. If a player leaves the frame, play pauses and requires a fresh face and raised hand on each side, held steadily, before controls reconnect. Each lane has an independent score and streak HUD. Players should remain on their registered sides; the face detector checks positions, not personal identity.
- In beta pose-first mode, each player's registered pose wrist controls their cursor. Temporary pose-ID changes are accepted only when the same torso stays near its last position on its original side. A longer absence or uncertain reassignment requires explicit same-player confirmation; the software cannot prove personal identity. Fingers and palm opening are not tracked in this mode.
- Camera play requires each face and a raised hand beside it to remain visible briefly before the locked three-second ready countdown. A transient or stale detection cannot start registration.
- It can be played seated or standing. The player should stop if movement is uncomfortable.

## Raspberry Pi 5 kiosk deployment

Install Raspberry Pi OS 64-bit with Desktop, Node.js 22, and Chromium. Attach a UVC-compatible 1080p webcam, then:

```bash
npm ci
npm run build
npm run preview -- --port 4173
```

For a kiosk session, launch Chromium after the server starts:

```bash
chromium-browser --kiosk --autoplay-policy=no-user-gesture-required http://localhost:4173
```

The site is entirely static after `npm run build`; `vite preview` can be replaced by nginx, Caddy, or any local static server serving `dist/`. The first camera permission must be accepted by a caregiver. For automatic kiosk startup, save the server and Chromium commands in a systemd user service or the desktop autostart configuration.

## Privacy and limitations

Processing happens in browser memory. Frames are discarded immediately and are never stored or uploaded. The tracker estimates 21 landmarks on each visible hand and uses the palm center as the cursor. Occlusion, very low light, motion blur, or hands outside the camera view can briefly interrupt tracking. It is a recreational wellbeing game, not a medical device, fall detector, or rehabilitation assessment.

## Commands

```bash
npm run dev       # development server
npm test          # unit tests
npm run build     # production bundle
npm run preview   # serve production bundle locally
```
