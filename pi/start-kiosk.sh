#!/bin/sh
set -eu

KIOSK_URL='http://127.0.0.1:8000/'
KIOSK_PROFILE="$HOME/.config/gentlecatch-kiosk"

if command -v chromium >/dev/null 2>&1; then
  BROWSER=chromium
elif command -v chromium-browser >/dev/null 2>&1; then
  BROWSER=chromium-browser
else
  echo 'GentleCatch: Chromium is not installed.' >&2
  exit 1
fi

# The service starts at user login. Wait for its first response so Chromium
# does not open an error page when the desktop starts faster than the server.
until /usr/bin/python3 -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8000/", timeout=2).close()' >/dev/null 2>&1; do
  sleep 1
done

# The Pi 5's USB C920 works through Chromium's direct V4L2 camera path.
# In this setup, PipeWire camera enumeration leaves getUserMedia pending.
if [ -S "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/wayland-0" ]; then
  XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
  DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
  export XDG_RUNTIME_DIR WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS
  set -- --ozone-platform=wayland
else
  set --
fi

exec "$BROWSER" "$@" --user-data-dir="$KIOSK_PROFILE" \
  --disable-features=WebRtcPipeWireCamera \
  --kiosk --noerrdialogs --disable-infobars --no-first-run --start-maximized "$KIOSK_URL"
