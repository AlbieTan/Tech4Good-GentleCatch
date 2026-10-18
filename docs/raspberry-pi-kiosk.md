# Gentle Catch on a Raspberry Pi kiosk

This is a setup recipe, not a claim that the current Raspberry Pi has been configured or performance-tested. Use Raspberry Pi OS (64-bit) with a desktop, a display and a camera. A Pi 5 is strongly preferred for two-person play; measure its actual palm-tracking FPS before use at the centre.

## Camera-only operation

Open `http://127.0.0.1:8000/` in Chromium on the Pi. The camera gesture menu follows the eight-second warning. One person raises a hand for Solo; two people, side by side, each raise a hand for PvP. For difficulty and round time, either player raises one hand and holds it left, above or right of their face. Lower hands out of view briefly between steps. Registration then checks faces and nearby palms before a three-second countdown. After a round, results remain visible for eight seconds and the gesture menu returns without reloading a healthy camera or model. A prolonged missing player ends the current round rather than assigning its controls to a newcomer. This is positional continuity, **not biometric identity verification**; an extra person is not reliably detectable while face checks are off during play.

The camera gesture menu selects pace and duration each round. Staff can use the footer link or `?mode=manual` for mouse-driven setup and troubleshooting. During a round, stepping out of view ends the round after the absence grace period; a mouse is not needed to get back to the menu.

## Auto-start outline

1. On a development computer, run `npm run build` and copy the resulting `dist/` directory to the Pi, for example `/home/pi/gentle-catch/dist` (replace `pi` with the actual account name).
2. Serve that directory on the Pi's own loopback address. A simple test is `python3 -m http.server 8000 --bind 127.0.0.1 --directory /home/pi/gentle-catch/dist`. For unattended use, put the server behind a service manager so it starts before Chromium and restarts after failures.
3. Follow the [official Raspberry Pi kiosk guide](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/) for the installed OS. On the labwc desktop it uses `~/.config/labwc/autostart` to launch Chromium. Point Chromium at the kiosk URL above, with `--kiosk --noerrdialogs --disable-infobars --no-first-run --start-maximized`.
4. During installation, use a mouse or remote access once to allow camera access for the Pi's localhost site in the persistent Chromium profile. Do not rely on a browser flag that silently grants camera access to every site. After that, test a cold reboot without mouse or keyboard.

This is not an OS-level emergency stop. Keep a staff-accessible way to stop the Pi or exit kiosk mode, and do not leave the first deployment unattended until camera permission, auto-start, scoring, and two-person tracking have been tested on the actual hardware.
