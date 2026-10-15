# Gentle Catch

Gentle Catch is a calm, camera-controlled movement game designed with older adults in mind and branded for Precious Active Ageing Centre. Leaves, flowers, hearts, and stars drift down the screen; players collect them with one or both hands while avoiding bombs and germs. Consecutive catches build a score multiplier, while touching a hazard deducts points and resets the streak.

Built on Hakrrrm’s initial v1 prototype. AlbieTan developed v2 and v3, redesigning the UI and adding the two-player PvP and player-registration flows.

The startup flow supports solo play and a local split-screen battle. Camera sessions do not begin immediately: registration first holds each visible face steady, then looks for a nearby raised hand on that person's side. In beta hybrid mode, the hand must also match that body's pose wrist. An ambiguous hand is not assigned. Once registration succeeds, those player and hand slots stay frozen through the three-second countdown so brief tracking changes cannot restart it. Face-position tracking switches off during normal MediaPipe gameplay. If a registered hand stays out of frame, the round pauses, asks that player to return, and temporarily re-enables face-position tracking to reconnect faces and hands before continuing. This is positional tracking only—not facial recognition—and no image or identity data is stored. Each player controls one half of the arena and receives the same sequence of objects, making the score duel easy to follow and fair.

The two-player setup also offers **Try hybrid PvP tracking (beta)**. MoveNet MultiPose identifies each person's body and wrist, while MediaPipe Hand Landmarker supplies the actual palm cursor. Registration pairs a detected hand with the nearest body wrist and locks that person's chosen left or right hand for the round. A missing or ambiguous hand stops interacting instead of silently switching hands. Registration requires exactly two visible bodies and a detected, raised hand each; an extra person blocks registration. Diagnostics show body, hand, and matched counts, track IDs, and observed pose FPS. Pose IDs are temporary continuity aids, not biometric identity: after a person leaves and returns, their ID may change, and the app reassigns that side after a steady re-entry check. A different person could still take that side. The bundled pose model needs WebGL; if that fails, uncheck the beta option and use the previous tracker.

## Why it runs well on a Raspberry Pi

The browser requests an efficient 540p camera stream for a clear display. MediaPipe uses a worker to downsample frames to 384 × 216 at up to 24 hand-tracking frames per second and tracks up to four palms. In the original mode, BlazeFace checks a separate 640 × 360 frame at up to 8 FPS during registration and recovery only, improving the visibility of two smaller faces. Face inference is disabled during ordinary gameplay. Busy inference frames are skipped instead of queued, and the unused gameplay video remains paused during registration. A lightweight velocity-aware filter limits sudden landmark spikes, while bounded prediction updates the cursor at the display refresh rate between camera results. The beta hybrid path also runs MoveNet at up to 12 inference frames per second on WebGL for body ownership; its combined performance must be benchmarked on the target Raspberry Pi 5 before kiosk deployment. All models are bundled locally, so there is no model download during play.

No image or video leaves the device. Hand landmark inference happens locally in browser memory.

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
- In beta hybrid mode, each player's registered hand landmarks control their cursor; body wrists are used only to associate the hand with a player. Overlapping hands, occlusion, or leaving the frame can still end a track, so re-entry is a new positional assignment rather than identity verification.
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
