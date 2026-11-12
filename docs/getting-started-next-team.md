# GentleCatch — getting started for the next team

The current team's Tech4Good project ended on **12 November 2026**. This guide explains how to run, edit and continue the prototype. The handover includes the source, local tracking models, tests and Raspberry Pi kiosk configuration.

## Repositories and testing links

| Resource | Purpose |
| --- | --- |
| [Hakrrrm/tech4good](https://github.com/Hakrrrm/tech4good) | Original v1 foundation. Retain attribution when building on this work. |
| [AlbieTan/Tech4Good-GentleCatch](https://github.com/AlbieTan/Tech4Good-GentleCatch) | Developed UI, branding, solo/PvP gameplay, kiosk flow and tracking changes. Start here for the handover. |
| [Camera-only kiosk](https://tech4good-gentlecatch.vercel.app/) | Existing deployed browser prototype. |
| [Classic menu](https://tech4good-gentlecatch.vercel.app/?mode=manual) | Staff-operated setup, keyboard practice and optional tracking beta. |
| [Tracking diagnostics](https://tech4good-gentlecatch.vercel.app/?debug=1) | Displays palm tracking FPS, capture time, inference time and frame age during camera play. |

The developed repo's default branch at handover is `v9-final-debugging-edits`. The last application change before this documentation handover is commit [`50f554b`](https://github.com/AlbieTan/Tech4Good-GentleCatch/commit/50f554b40fa3e01cf833af84bd314dfe3ff15d97). Older version branches remain available for comparison.

## 1. Get your own working copy

Fork the developed repository into the next team's GitHub account if you need your own writable repository. Use its clone URL in place of the one below. With collaborator access to the existing repository, you can clone it directly.

```bash
git clone --branch v9-final-debugging-edits https://github.com/AlbieTan/Tech4Good-GentleCatch.git
cd Tech4Good-GentleCatch
git switch -c next-team/first-change
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Use Node.js **20.19+ or 22.12+** and a current browser. Open `http://127.0.0.1:5173/` and allow camera access. For keyboard practice, open `http://127.0.0.1:5173/?mode=manual` and choose **Try solo with keyboard**. Press `Ctrl+C` in the terminal to stop the server.

Localhost supports browser camera access. An HTTP address on another computer's LAN IP may fail the browser's secure-context requirement. The Vercel HTTPS site is useful for remote testing.

## 2. Know where to edit

| File or directory | Responsibility |
| --- | --- |
| `index.html` | Panels, labels, menus and page structure. |
| `src/styles.css` | Colours, spacing, typography and responsive layout. |
| `src/main.js` | Session flow, UI events, game rendering and integration with tracking. |
| `src/gameLogic.js` | Game rules and shared game logic. |
| `src/cameraMenu.js` | Gesture choices, hold timing, release checks and two-player dropout tolerance. |
| `src/handTracker.js` | Camera frame capture, worker messages, palm slot updates and timing readouts. |
| `src/handTracker.worker.js` | Default MediaPipe hand and face inference in a Web Worker. |
| `src/handTrackingMath.js` | Palm coordinates, smoothing, prediction and detection slots. |
| `src/registrationTracking.js` | Registration and association of hands with nearby faces. |
| `src/poseTracker.js`, `src/hybridTracker.js` and related math files | Optional pose-first beta and its tracking helpers. |
| `public/brand/` | Branding assets. |
| `public/models/`, `public/wasm/` | Bundled inference models and WebAssembly files. Preserve them when deploying. |
| `tests/` | Existing automated tests for game, menu and tracking logic. |
| `pi/` | Chromium kiosk launcher and user web-server service. |

Start with a small change, such as a menu label or CSS spacing. Keep tracking changes separate from visual changes so a regression is easier to identify. The default kiosk uses MediaPipe palm tracking. The classic-menu pose-first beta follows a separate path.

## 3. Understand the flow before changing it

The kiosk runs an eight-second startup notice, player selection, difficulty selection, round-time selection, registration, a three-second countdown, gameplay and results. It then returns to the gesture menu. Players lower their hands between menu choices to re-arm selection.

Setup uses nearby face and hand positions to associate controls with players. Apparent face size estimates which people are nearest. Face detection is turned off during normal palm gameplay to reduce processing. These controls depend on positions and visibility, so overlapping players and bystanders can still cause errors.

Camera frames and model inference stay in the browser. No cloud vision API key is required for the current app. The README describes the game rules, models and safeguards in more detail.

## 4. Verify and publish your change

```bash
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Open `http://127.0.0.1:4173/` to check the built app. Stop the preview with `Ctrl+C`. Test the complete camera flow with one person, then two people. Include a round ending, return to menu, player leaving frame and a brief hand dropout. Automated tests cannot establish webcam accuracy or Raspberry Pi responsiveness.

```bash
git diff
git add <files-you-changed>
git commit -m "Describe the change"
git push -u origin next-team/first-change
```

Replace `<files-you-changed>` with the actual file paths. Review the diff and open a pull request in the repository you intend to maintain. If you forked the project, confirm the pull request targets your team's fork when that is your intended destination. Keep the original credits and third-party notices.

For Vercel, the app uses the Vite framework, `npm run build` and the `dist` output directory. Link the next team's repository to a Vercel project under an account the team can maintain, or arrange collaborator access to the existing project. A GitHub fork does not transfer ownership of the current Vercel project. Record the production branch and public URL in your handover notes. Check a preview deployment before releasing changes to your production site.

The existing Vercel site is a testing reference. Local edits become visible there only after they reach a branch configured to deploy to that project.

## 5. Continue on Raspberry Pi

Follow the [Raspberry Pi kiosk guide](raspberry-pi-kiosk.md). The handover setup uses a Pi 5, Raspberry Pi OS 64-bit Desktop and a Logitech C920 USB camera. The local game is served at `http://127.0.0.1:8000/` from `~/gentle-catch/dist`.

Build on a development computer and transfer `dist/` to the Pi if you want to avoid building there. Back up the previous `dist/` before replacing it, restart `gentlecatch-web.service`, then reload Chromium. Preserve the kiosk launcher and camera policy from the tested setup. Its `--disable-features=WebRtcPipeWireCamera` flag resolved a browser camera-enumeration hang on this particular Pi.

Verify the exact build on the target Pi with real players. Browser testing on a laptop or Vercel cannot establish the Pi's tracking latency. Keep the previous working build available for rollback.

## Outstanding work at handover

- Pilot testing reported approximately **200 ms of visible hand delay** and sluggish two-player selection on the Pi. The latest changes add diagnostic timings and brief PvP menu dropout tolerance. A measured reduction in Pi gameplay delay has not been established.
- Two-player control ownership can become ambiguous when people overlap, cross hands or allow bystanders into view. The system does not verify personal identity.
- Collect tracking FPS, capture time, inference time and frame age during full rounds. Frame age starts at the browser video callback and excludes earlier webcam buffering and display delay.
- Validate sustained gameplay, cold boot, camera unplug/replug and end-to-end kiosk recovery on the actual hardware.
- Gather feedback from centre staff and older adults on instructions, comfort and willingness to replay. Keep technical performance results distinct from user feedback.

Preserve the deployed behaviour as a reference while investigating these issues. Record the hardware, browser, commit and conditions for each test so the next iteration can be compared fairly.
