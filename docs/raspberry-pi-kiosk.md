# Deploy GentleCatch on Raspberry Pi 5

This guide uses Raspberry Pi OS **64-bit with Desktop**, a Pi 5, a USB webcam and a display. It serves the production build at `http://127.0.0.1:8000/`; the camera feed and model inference stay in that browser. The repository contains the source, model assets, systemd service and kiosk launcher.

The camera and kiosk launch were checked on a Pi 5 with a Logitech C920. A full solo/PvP performance run, cold boot and unplug/replug recovery have not yet been validated. Keep a mouse/keyboard or SSH available for maintenance.

## 1. Get the source and build

Clone this branch on the Pi. Use Node.js **20.19+ or 22.12+** if building on the Pi:

```bash
sudo apt update
sudo apt install -y chromium python3 curl git
git clone --branch v9-final-debugging-edits https://github.com/AlbieTan/Tech4Good-GentleCatch.git "$HOME/gentle-catch"
cd "$HOME/gentle-catch"
npm ci
npm run build
```

If Node.js is unavailable on the Pi, build on another computer using `npm ci` and `npm run build`, then transfer both this repository's source and its `dist/` directory by SCP or USB. The Pi only needs Chromium and Python to serve a completed `dist/`. Verify the required files on the Pi:

```bash
test -f "$HOME/gentle-catch/dist/index.html"
test -f "$HOME/gentle-catch/dist/models/hand_landmarker.task"
test -f "$HOME/gentle-catch/dist/wasm/vision_wasm_module_internal.wasm"
```

Do not open `dist/index.html` as a `file://` URL; use the localhost address below so the web worker and assets load reliably. Keep the checkout at `~/gentle-catch` unless you also update the service path.

## 2. Start the local server

Install the included user service and start it:

```bash
mkdir -p "$HOME/.config/systemd/user"
cp "$HOME/gentle-catch/pi/gentlecatch-web.service" "$HOME/.config/systemd/user/gentlecatch-web.service"
systemctl --user daemon-reload
systemctl --user enable --now gentlecatch-web.service
systemctl --user status gentlecatch-web.service --no-pager
curl -I http://127.0.0.1:8000/
```

The `curl` check should return HTTP 200. The service binds only to loopback, restarts if it fails, and starts when the kiosk user logs in. For logs, run `journalctl --user -u gentlecatch-web.service -n 50 --no-pager`.

## 3. Allow the local camera and use the working capture path

Connect the USB webcam before launching the browser. On this Pi 5 with a Logitech C920, Chromium's PipeWire camera path left camera enumeration pending. The direct V4L2 path passed a browser test at the game's 640×360 settings. The included `pi/start-kiosk.sh` therefore launches Chromium with `--disable-features=WebRtcPipeWireCamera` and a dedicated persistent profile. This is a device-specific workaround, not a requirement for other boards or browser versions.

Grant camera access only to the local game origin through Chromium's managed policy:

```bash
sudo install -d -m 755 /etc/chromium/policies/managed
printf '%s\n' '{"VideoCaptureAllowedUrls":["http://127.0.0.1:8000/"]}' | sudo tee /etc/chromium/policies/managed/gentlecatch-camera.json >/dev/null
python3 -m json.tool /etc/chromium/policies/managed/gentlecatch-camera.json
```

The default page is the camera-only menu. Its first screen stays up for at least eight seconds. Confirm that a face and raised hand are detected before enabling auto-start. The kiosk launcher does **not** use `--use-fake-ui-for-media-stream`, which would silently grant camera access to every site in that browser process.

Test the launcher from a Pi desktop terminal, or from SSH while the same user is logged in to the Pi desktop:

```bash
chmod +x "$HOME/gentle-catch/pi/start-kiosk.sh"
"$HOME/gentle-catch/pi/start-kiosk.sh"
```

It opens the game full-screen. If launching Chromium manually from SSH instead, the shell needs the desktop's Wayland socket and session bus; the included script supplies these when `wayland-0` is present. A shell with no active desktop cannot open a graphical browser.

## 4. Start Chromium automatically at desktop login

Raspberry Pi's kiosk tutorial uses labwc's per-user autostart file. Confirm the Pi is using a labwc desktop before following this step:

```bash
mkdir -p "$HOME/.config/labwc"
nano "$HOME/.config/labwc/autostart"
```

Add this one line, without deleting any existing lines:

```sh
$HOME/gentle-catch/pi/start-kiosk.sh &
```

The launcher waits for the local server, then opens the same localhost URL in Chromium kiosk mode. It uses a dedicated persistent profile at `~/.config/gentlecatch-kiosk` and the V4L2 camera workaround above. Ensure Raspberry Pi OS is set to boot to the desktop with **automatic login for this user**. On a different desktop session, use that session's autostart mechanism instead of the labwc file.

Reboot once with staff present. The game should open without a mouse. If Chromium also restores an earlier window, close Chromium before reboot and check that no other Chromium autostart entry exists; do not add multiple kiosk launchers.

## 5. Acceptance test on the actual Pi

1. Cold reboot. The eight-second notice and camera menu should appear without staff interaction. Verify camera permission persists.
2. Use only hand gestures to choose Solo, difficulty and duration; complete registration, countdown, round, results and return to menu.
3. Repeat with two players side by side. Keep each person and their own hand on their respective camera side; no bystanders in the frame. Test a complete 60-second PvP round.
4. Watch the on-screen tracker FPS and delay for the entire round, not just startup. Pi 5 performance has **not** been validated for this release. Even lighting, a USB webcam capable of stable 640×360 video, adequate power and active cooling help; they do not guarantee 30 FPS.
5. Test a player leaving frame, webcam unplug/replug, and a reboot after a power interruption. Keep a staff-accessible way to exit kiosk mode or stop the Pi.

If a test fails, use `http://127.0.0.1:8000/?mode=manual` to inspect the classic menu, check `journalctl --user -u gentlecatch-web.service`, and confirm `curl -I http://127.0.0.1:8000/models/hand_landmarker.task` returns 200. Browser developer tools can reveal a missing model/WASM file or worker error.

If the game remains at **“Waiting for the camera”**, check the webcam separately:

```bash
sudo apt install -y v4l-utils
for device in /sys/class/video4linux/video*; do printf '%s: ' "${device##*/}"; cat "$device/name"; done
timeout 15s v4l2-ctl -d /dev/video0 --stream-mmap --stream-count=30 --stream-to=/dev/null
```

On the tested Pi, `/dev/video0` was the C920 and the 30-frame test succeeded, but Chromium still hung while enumerating devices through PipeWire. The direct V4L2 Chromium launch resolved that browser-side hang. Use the actual webcam node shown by the first command if yours differs. Check that the running Chromium command contains `--disable-features=WebRtcPipeWireCamera`. Do not leave the fake-camera debugging flags in the kiosk launcher.

## Updating or removing the kiosk setup

To update, pull the desired branch and run `npm ci` and `npm run build` on the Pi, or transfer a newly tested `dist/` from another computer. Then restart the browser. Keep the previous working build for rollback. The Chromium profile and camera policy live outside the repository and should persist across app updates. To stop the local server, run `systemctl --user stop gentlecatch-web.service`; to prevent it starting at login, run `systemctl --user disable gentlecatch-web.service`. Remove the added line from `~/.config/labwc/autostart` to stop browser auto-launch. These commands do not delete the game files.

## Limits and safety

- Solo chooses the nearest-looking face; PvP chooses the two nearest-looking separated faces during setup. This is based on apparent image size, not depth sensing or biometric identity verification.
- During normal palm-tracked gameplay, face detection is off for performance. Keep bystanders out of camera view; the software cannot guarantee that an extra person never interferes.
- The game is recreational, not a medical or fall-detection device. A facilitator should remain available, especially for older adults trying a new camera-controlled activity.

Sources: [Raspberry Pi kiosk tutorial](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/), [browser camera secure-context requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [Chromium's Linux camera feature](https://chromium.googlesource.com/chromium/src/+/refs/tags/129.0.6644.0/media/capture/capture_switches.cc), and [Chromium policy setup on Linux](https://www.chromium.org/administrators/linux-quick-start/).
