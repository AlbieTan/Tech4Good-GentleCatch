import { describe, expect, it } from "vitest";
import {
  advanceCameraMenu,
  advanceCameraMenuRelease,
  getCameraMenuChoice,
  getCameraSettingChoice,
  hasRaisedMenuWrist,
} from "../src/cameraMenu.js";

const face = (x, id, now) => ({ x, y: 0.27, cameraX: x, width: 0.16, height: 0.22,
  personId: id, interactive: true, lastSeen: now });
const wrist = (x, id, now) => ({ x, y: 0.3, shoulderY: 0.4, confidence: 0.8,
  personId: id, side: "left", interactive: true, lastSeen: now });

describe("camera-only menu", () => {
  it("requires a visible raised wrist linked to the sole player", () => {
    const now = 1000;
    expect(getCameraMenuChoice([], [face(0.3, 1, now)], now)).toBeNull();
    expect(getCameraMenuChoice([wrist(0.47, 1, now)], [face(0.3, 1, now)], now)).toBe("solo");
  });

  it("requires both players and refuses a third person", () => {
    const now = 1000;
    const faces = [face(0.25, 1, now), face(0.75, 2, now)];
    const wrists = [wrist(0.4, 1, now), wrist(0.6, 2, now)];
    expect(getCameraMenuChoice(wrists.slice(0, 1), faces, now)).toBeNull();
    expect(getCameraMenuChoice(wrists, faces, now)).toBe("pvp");
    expect(getCameraMenuChoice(wrists, [...faces, face(0.95, 3, now)], now)).toBeNull();
  });

  it("resets the dwell when the gesture changes or disappears", () => {
    const first = advanceCameraMenu(null, "solo", 100);
    expect(advanceCameraMenu(first.candidate, "solo", 1000).selected).toBeNull();
    expect(advanceCameraMenu(first.candidate, null, 1100).candidate).toBeNull();
    expect(advanceCameraMenu(first.candidate, "pvp", 1400).selected).toBeNull();
    expect(advanceCameraMenu(first.candidate, "solo", 1300).selected).toBe("solo");
  });

  it("uses one player's wrist position to choose a setting", () => {
    const now = 1000;
    const player = face(0.5, 1, now);
    expect(getCameraSettingChoice([wrist(0.28, 1, now)], [player], 1, now)).toBe("left");
    expect(getCameraSettingChoice([wrist(0.63, 1, now)], [player], 1, now)).toBe("middle");
    expect(getCameraSettingChoice([wrist(0.75, 1, now)], [player], 1, now)).toBe("right");
  });

  it("rejects ambiguous two-player setting gestures and extra people", () => {
    const now = 1000;
    const faces = [face(0.25, 1, now), face(0.75, 2, now)];
    expect(getCameraSettingChoice([wrist(0.4, 1, now)], faces, 2, now)).toBe("middle");
    expect(getCameraSettingChoice([wrist(0.4, 1, now), wrist(0.6, 2, now)], faces, 2, now)).toBeNull();
    expect(getCameraSettingChoice([wrist(0.4, 1, now)], [...faces, face(0.95, 3, now)], 2, now)).toBeNull();
  });

  it("waits for hands to lower before arming the next step", () => {
    const now = 1000;
    expect(hasRaisedMenuWrist([wrist(0.4, 1, now)], now)).toBe(true);
    const release = advanceCameraMenuRelease(null, false, now);
    expect(advanceCameraMenuRelease(release.since, false, 1400).armed).toBe(false);
    expect(advanceCameraMenuRelease(release.since, false, 1450).armed).toBe(true);
    expect(advanceCameraMenuRelease(release.since, true, 1500).armed).toBe(false);
  });

  it("supports the palm tracker without pose-only shoulder or person IDs", () => {
    const now = 1000;
    const palm = (x) => ({ x, y: 0.43, confidence: 0.9, interactive: true, lastSeen: now });
    const faces = [face(0.28, 1, now), face(0.72, 2, now)];
    expect(getCameraMenuChoice([palm(0.17), palm(0.84)], faces, now, "hand")).toBe("pvp");
    expect(getCameraSettingChoice([palm(0.42)], faces, 2, now, "hand")).toBe("middle");
    expect(hasRaisedMenuWrist([palm(0.42)], now, "hand")).toBe(true);
  });
});
