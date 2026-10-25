import "./styles.css";
import {
  applyObjectScore,
  circlesOverlap,
  clamp,
  FACE_FRESH_MS,
  formatTime,
  getMatchResult,
  getMissingPlayerIndices,
  getPlayerBoundary,
  getPaceConfig,
  getPvpSpawnX,
  getRequiredHandCount,
  getStableRecoveryStart,
  isRegistrationLocked,
  mapHandToPvpLane,
  PVP_LANES,
  PLAYER_MISSING_GRACE_MS,
  randomObjectType,
  RECOVERY_STABLE_MS,
  REGISTRATION_COUNTDOWN_MS,
} from "./gameLogic.js";
import { HandTracker } from "./handTracker.js";
import { HybridTracker } from "./hybridTracker.js";
import {
  advanceCameraMenu,
  advanceCameraMenuRelease,
  getCameraMenuChoice,
  getCameraSettingChoice,
  hasRaisedMenuWrist,
} from "./cameraMenu.js";
import { sameRegisteredPosePlayers } from "./poseOwnership.js";
import {
  FACE_LOCK_MS,
  HAND_LOCK_MS,
  areHandCandidatesStable,
  associateHandsToFaces,
  getLockedHand,
  handIdentity,
  sameFaceCandidates,
  selectRegistrationFaces,
  snapshotFaces,
} from "./registrationTracking.js";

const $ = (selector) => document.querySelector(selector);
const pageParams = new URLSearchParams(window.location.search);
const kioskMode = pageParams.get("mode") !== "manual"
  && pageParams.get("kiosk") !== "0" && !pageParams.has("preview");
const MIN_LOADING_READ_MS = 8000;
// A small margin avoids accidentally dropping to 20 FPS on 60 Hz displays.
const CAMERA_GAME_FRAME_MS = 1000 / 30 - 2;
const STATS_REFRESH_MS = 250;
const DIAGNOSTICS_REFRESH_MS = 500;
const panels = [$("#landingPanel"), $("#setupPanel"), $("#loadingPanel"), $("#registrationPanel"), $("#playPanel"), $("#resultsPanel")];
const elements = {
  landing: $("#landingPanel"),
  setup: $("#setupPanel"),
  loading: $("#loadingPanel"),
  loadingStatus: $("#loadingStatus"),
  loadingCountdown: $("#loadingCountdown"),
  registration: $("#registrationPanel"),
  play: $("#playPanel"),
  results: $("#resultsPanel"),
  enterGame: $("#enterGame"),
  backToWelcome: $("#backToWelcome"),
  cameraStart: $("#cameraStart"),
  poseTrackerOption: $("#poseTrackerOption"),
  poseTrackerToggle: $("#poseTrackerToggle"),
  keyboardStart: $("#keyboardStart"),
  cameraMessage: $("#cameraMessage"),
  cancelRegistration: $("#cancelRegistration"),
  registrationVideo: $("#registrationVideo"),
  registrationStage: $("#registrationStage"),
  cameraMenu: $("#cameraMenu"),
  cameraMenuStep: $("#cameraMenuStep"),
  cameraMenuTitle: $("#cameraMenuTitle"),
  cameraMenuInstruction: $("#cameraMenuInstruction"),
  cameraMenuModeChoices: $("#cameraMenuModeChoices"),
  cameraMenuSettingChoices: $("#cameraMenuSettingChoices"),
  cameraMenuZones: $("#cameraMenuZones"),
  cameraMenuSolo: $("#cameraMenuSolo"),
  cameraMenuPvp: $("#cameraMenuPvp"),
  cameraMenuPositions: [$("#cameraMenuLeft"), $("#cameraMenuMiddle"), $("#cameraMenuRight")],
  cameraMenuMeter: $("#cameraMenuMeter"),
  cameraMenuStatus: $("#cameraMenuStatus"),
  registrationPlural: $("#registrationPlural"),
  registrationInstruction: $("#registrationInstruction"),
  registrationStatus: $("#registrationStatus"),
  registrationStatusText: $("#registrationStatus strong"),
  registrationDiagnostics: $("#registrationDiagnostics"),
  registrationTip: $(".registration-tip"),
  faceModelStatus: $("#faceModelStatus"),
  facePlayers: [$("#facePlayerOne"), $("#facePlayerTwo")],
  registrationCursors: [...document.querySelectorAll("#registrationCursors .player-cursor")],
  registrationFaces: [...document.querySelectorAll("#registrationFaces .face-anchor")],
  playerTwoKey: $("#playerTwoKey"),
  countdownBadge: $("#countdownBadge"),
  countdownValue: $("#countdownValue"),
  board: $("#gameBoard"),
  pvpArena: $("#pvpArena"),
  battleLanes: [...document.querySelectorAll("#pvpArena .battle-lane")],
  laneOneScore: $("#laneOneScore"),
  laneOneStreak: $("#laneOneStreak"),
  laneTwoScore: $("#laneTwoScore"),
  laneTwoStreak: $("#laneTwoStreak"),
  targets: $("#targets"),
  cursors: [...document.querySelectorAll("#playerCursors .player-cursor")],
  trackingStatus: $("#trackingStatus"),
  trackingStatusText: $("#trackingStatus strong"),
  cameraSpaceNotice: $("#cameraSpaceNotice"),
  trackingDiagnostics: $("#trackingDiagnostics"),
  trackingRecovery: $("#trackingRecovery"),
  recoveryTitle: $("#recoveryTitle"),
  recoveryMessage: $("#recoveryMessage"),
  recoveryFaceCheck: $("#recoveryFaceCheck"),
  recoveryHandCheck: $("#recoveryHandCheck"),
  recoveryConfirm: $("#recoveryConfirm"),
  video: $("#registrationVideo"),
  playerOneScore: $("#playerOneScore"),
  playerOneStreak: $("#playerOneStreak"),
  playerTwoScoreCard: $("#playerTwoScoreCard"),
  playerTwoScore: $("#playerTwoScore"),
  playerTwoStreak: $("#playerTwoStreak"),
  caught: $("#caughtValue"),
  missed: $("#missedValue"),
  missLimit: $("#missLimit"),
  time: $("#timeValue"),
  pause: $("#pauseButton"),
  end: $("#endButton"),
  pauseOverlay: $("#pauseOverlay"),
  inputHint: $("#inputHint"),
  resultsTitle: $("#resultsTitle"),
  finalPlayerOneLabel: $("#finalPlayerOneLabel"),
  finalPlayerOneScore: $("#finalPlayerOneScore"),
  finalPlayerTwoCard: $("#finalPlayerTwoCard"),
  finalPlayerTwoScore: $("#finalPlayerTwoScore"),
  finalCaught: $("#finalCaught"),
  resultMessage: $("#resultMessage"),
  playAgain: $("#playAgain"),
  backHome: $("#backHome"),
  resultsKioskStatus: $("#resultsKioskStatus"),
  statusLive: $("#statusLive"),
  modeSwitch: $("#modeSwitch"),
};

function emptyPlayerStats() {
  return { score: 0, streak: 0, multiplier: 1, bestStreak: 0, caught: 0 };
}

const state = {
  phase: "landing",
  starting: false,
  running: false,
  paused: false,
  inputMode: "keyboard",
  playMode: "solo",
  trackerKind: "hand",
  playerPoseIds: [null, null],
  playerHandSides: [null, null],
  playerHandSlots: [null, null],
  playerStats: [emptyPlayerStats(), emptyPlayerStats()],
  caught: 0,
  missed: 0,
  pace: "gentle",
  durationSeconds: 30,
  remainingSeconds: 30,
  startedAt: 0,
  pausedAt: 0,
  pausedDuration: 0,
  lastFrame: 0,
  lastStatsAt: 0,
  lastDiagnosticsAt: 0,
  lastSpawn: 0,
  objects: [],
  players: [],
  faces: [],
  registrationHands: [],
  registrationMatches: [],
  registrationFaceCandidate: null,
  registrationFaceLock: null,
  registrationLastFaceAt: 0,
  registrationHandCandidates: [null, null],
  cameraMenuCandidate: null,
  cameraMenuStage: "mode",
  cameraMenuArmed: true,
  cameraMenuReleaseSince: null,
  lastCameraMenuCheck: 0,
  registrationStartedAt: 0,
  keys: new Set(),
  stream: null,
  animationId: null,
  countdownAnimationId: null,
  countdownEndsAt: 0,
  playerFaceSlots: [],
  playerBoundary: 0.5,
  faceTrackingReady: false,
  faceTrackingError: "",
  registrationStatusKey: "",
  lastRegistrationCheck: 0,
  missingPlayerSince: [null, null],
  recoveryActive: false,
  recoveryMissingPlayers: [],
  recoveryStartedAt: 0,
  recoveryReadySince: null,
  recoveryCandidate: null,
  kioskRestartTimer: null,
  gameVideoRetryCount: 0,
  extraBodySince: null,
};

function showPanel(panel, phase) {
  panels.forEach((candidate) => { candidate.hidden = candidate !== panel; });
  $("#app").classList.toggle("loading-view", panel === elements.loading);
  state.phase = phase;
  panel.scrollIntoView({ block: "start" });
}

function selectedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function configureFromSetup() {
  state.playMode = selectedValue("playMode");
  // The kiosk uses palm landmarks in a worker for both modes. Pose-first PvP
  // remains available from the classic staff menu for comparison.
  state.trackerKind = !kioskMode && state.playMode === "pvp" && elements.poseTrackerToggle.checked
    ? "hybrid" : "hand";
  state.pace = selectedValue("pace");
  state.durationSeconds = Number(selectedValue("duration"));
  state.remainingSeconds = state.durationSeconds;
}

function registrationPlayers() {
  if (state.playMode === "pvp") {
    return state.registrationMatches.map((hand, ownerIndex) =>
      hand ? { ...hand, radius: 44, ownerIndex } : null,
    );
  }
  const hand = state.registrationMatches[0];
  return hand ? [{ ...hand, radius: 44, ownerIndex: 0 }] : [];
}

function gameplayPlayers(hands) {
  if (state.playMode === "pvp") {
    const assigned = state.trackerKind === "hybrid"
      ? state.playerPoseIds.map((id, index) => hands.find((hand) =>
        hand?.ownerIndex === index || (hand?.personId === id
          && hand.side === state.playerHandSides[index])) ?? null)
      : state.playerHandSlots.map((slot, index) =>
        getLockedHand(hands, slot, index, state.playerBoundary));
    return assigned.map((hand, ownerIndex) => {
      if (!hand && state.players[ownerIndex]) {
        return { ...state.players[ownerIndex], interactive: false };
      }
      return hand ? {
        ...hand,
        cameraX: hand.x,
        x: mapHandToPvpLane(hand.x, ownerIndex, state.playerBoundary),
        radius: 44,
        ownerIndex,
      } : null;
    });
  }
  const hand = state.trackerKind === "hybrid"
    ? hands.find((candidate) => candidate?.ownerIndex === 0) ?? null
    : getLockedHand(hands, state.playerHandSlots[0]);
  return hand
    ? [{ ...hand, radius: 44, ownerIndex: 0 }]
    : state.players[0] ? [{ ...state.players[0], interactive: false }] : [];
}

function activePlayerCount() {
  return state.playMode === "pvp" ? 2 : 1;
}

function updateRecoveryOverlay(hands = [], faces = [], now = performance.now()) {
  const playerCount = activePlayerCount();
  const selected = selectRegistrationFaces(faces, playerCount, now);
  const onOriginalSides = playerCount === 1 || Boolean(selected
    && (selected[0].face.cameraX ?? selected[0].face.x) < state.playerBoundary
    && (selected[1].face.cameraX ?? selected[1].face.x) >= state.playerBoundary);
  const facesReady = state.faceTrackingReady && Boolean(selected) && onOriginalSides;
  const matches = facesReady ? associateHandsToFaces(hands, selected, state.trackerKind, now, faces) : [];
  const handsReady = matches.length === playerCount && matches.every(Boolean);
  const missing = state.recoveryMissingPlayers;
  elements.recoveryTitle.textContent = state.playMode === "pvp" && missing.length === 1
    ? `Player ${missing[0] + 1}, come back into frame`
    : state.playMode === "pvp" ? "Players, come back into frame" : "Come back into frame";
  elements.recoveryMessage.textContent = facesReady && handsReady
    ? "Keep both players in view while we reconnect…"
    : state.trackerKind === "hybrid"
      ? "Each player: show your face and shoulders, then raise your registered arm until its wrist appears."
      : "Each player: look at the camera and raise one hand beside your face, on your side.";
  if (playerCount === 2) {
    elements.recoveryFaceCheck.textContent = `${selected?.[0] && matches[0] ? "✓" : "○"} Player 1`;
    elements.recoveryHandCheck.textContent = `${selected?.[1] && matches[1] ? "✓" : "○"} Player 2`;
    elements.recoveryFaceCheck.classList.toggle("is-ready", Boolean(facesReady && matches[0]));
    elements.recoveryHandCheck.classList.toggle("is-ready", Boolean(facesReady && matches[1]));
  } else {
    elements.recoveryFaceCheck.textContent = `${facesReady ? "✓" : "○"} Face`;
    elements.recoveryHandCheck.textContent = `${handsReady ? "✓" : "○"} Hand`;
    elements.recoveryFaceCheck.classList.toggle("is-ready", facesReady);
    elements.recoveryHandCheck.classList.toggle("is-ready", handsReady);
  }
  return { ready: facesReady && handsReady, selected, matches };
}

function startTrackingRecovery(missingPlayers, now) {
  if (state.recoveryActive) return;
  if (kioskMode) {
    // A camera-only kiosk cannot ask someone to click an identity confirmation.
    // End this round rather than allow a newcomer to inherit its controls.
    endSession("interrupted");
    return;
  }
  state.recoveryActive = true;
  state.recoveryMissingPlayers = [...missingPlayers];
  state.recoveryStartedAt = now;
  state.recoveryReadySince = null;
  state.recoveryCandidate = null;
  state.faces = [];
  elements.trackingRecovery.hidden = false;
  elements.recoveryConfirm.hidden = state.trackerKind !== "hybrid";
  elements.recoveryConfirm.disabled = true;
  elements.pause.disabled = true;
  if (state.trackerKind === "hybrid") tracker.unlockPlayers();
  tracker.setFaceTrackingEnabled(true);
  updateRecoveryOverlay([], []);
  elements.statusLive.textContent = "The round is paused while player tracking reconnects.";
}

function finishTrackingRecovery(hands, selected, matches, now) {
  lockPlayerSlots(selected, matches);
  state.players = gameplayPlayers(hands);
  state.pausedDuration += Math.max(0, now - state.recoveryStartedAt);
  state.lastFrame = now;
  state.recoveryActive = false;
  state.recoveryMissingPlayers = [];
  state.recoveryStartedAt = 0;
  state.recoveryReadySince = null;
  state.recoveryCandidate = null;
  state.missingPlayerSince = [null, null];
  state.faces = [];
  elements.trackingRecovery.hidden = true;
  elements.pause.disabled = false;
  tracker.setFaceTrackingEnabled(false);
  updateTrackingStatus(state.players.filter((player) => player?.interactive !== false).length);
  elements.statusLive.textContent = "Player controls reconnected. The round continues.";
}

function handleRecoveryTracking(hands, faces, now) {
  state.faces = faces;
  const { ready, selected, matches } = updateRecoveryOverlay(hands, faces, now);
  state.recoveryReadySince = getStableRecoveryStart(state.recoveryReadySince, ready, now);
  state.recoveryCandidate = null;
  elements.recoveryConfirm.disabled = true;
  if (state.recoveryReadySince !== null && now - state.recoveryReadySince >= RECOVERY_STABLE_MS) {
    if (state.trackerKind !== "hybrid") {
      finishTrackingRecovery(hands, selected, matches, now);
    } else {
      state.recoveryCandidate = { hands, selected, matches, at: now };
      elements.recoveryConfirm.disabled = false;
      elements.recoveryMessage.textContent = sameRegisteredPosePlayers(
        selected, matches, state.playerPoseIds, state.playerHandSides,
      )
        ? "Players are back in position. Please confirm they are the same people before continuing."
        : "Tracking labels changed. Please confirm the same people are on their original sides before continuing.";
    }
  }
}

function monitorGameplayPresence(now) {
  const playerCount = activePlayerCount();
  const missingPlayers = getMissingPlayerIndices(state.players, playerCount);
  for (let index = 0; index < playerCount; index += 1) {
    if (missingPlayers.includes(index)) {
      state.missingPlayerSince[index] ??= now;
    } else {
      state.missingPlayerSince[index] = null;
    }
  }
  const sustainedMissingPlayers = missingPlayers.filter((index) =>
    now - state.missingPlayerSince[index] >= PLAYER_MISSING_GRACE_MS,
  );
  if (sustainedMissingPlayers.length) startTrackingRecovery(sustainedMissingPlayers, now);
}

const handleTrackedPlayers = (hands, faces) => {
  if (state.inputMode !== "camera") return;
  if (state.phase === "camera-menu") {
    const now = performance.now();
    if (now - state.lastCameraMenuCheck < 80) return;
    state.lastCameraMenuCheck = now;
    updateCameraMenuZones(hands, faces, now);
    if (!state.cameraMenuArmed) {
      const release = advanceCameraMenuRelease(
        state.cameraMenuReleaseSince,
        hasRaisedMenuWrist(hands, now, state.trackerKind, faces,
          state.cameraMenuStage === "mode" ? 0 : activePlayerCount(), state.playerFaceSlots), now,
      );
      state.cameraMenuReleaseSince = release.since;
      if (release.armed) {
        state.cameraMenuArmed = true;
        elements.cameraMenuStatus.textContent = "Ready. Raise one hand beside your face to choose.";
      }
      return;
    }
    const choice = state.cameraMenuStage === "mode"
      ? getCameraMenuChoice(hands, faces, now, state.trackerKind)
      : getCameraSettingChoice(hands, faces, activePlayerCount(), now, state.trackerKind, state.playerFaceSlots);
    const menuFaces = state.cameraMenuStage === "mode" && choice
      ? selectRegistrationFaces(faces, choice === "pvp" ? 2 : 1, now) : null;
    const menu = advanceCameraMenu(state.cameraMenuCandidate, choice, now,
      undefined, menuFaces?.map(({ slot }) => slot).join(",") ?? "");
    state.cameraMenuCandidate = menu.candidate;
    elements.cameraMenuSolo.classList.toggle("is-active", state.cameraMenuStage === "mode" && choice === "solo");
    elements.cameraMenuPvp.classList.toggle("is-active", state.cameraMenuStage === "mode" && choice === "pvp");
    elements.cameraMenuPositions.forEach((element, index) =>
      element.classList.toggle("is-active", state.cameraMenuStage !== "mode"
        && choice === ["left", "middle", "right"][index]));
    elements.cameraMenuMeter.style.width = `${Math.round(menu.progress * 100)}%`;
    elements.cameraMenuStatus.textContent = !choice
      ? state.cameraMenuStage === "mode" ? "Waiting for one or two players with raised hands…"
        : "Show one hand beside a face."
      : state.cameraMenuStage === "mode"
        ? choice === "pvp" ? "Two nearest players found — keep both hands raised…" : "Nearest player found — keep your hand raised…"
        : `${state.cameraMenuStage === "pace"
          ? { left: "Gentle", middle: "Steady", right: "Lively" }[choice]
          : { left: "20 seconds", middle: "30 seconds", right: "60 seconds" }[choice]} selected — hold your hand there…`;
    if (menu.selected) advanceCameraMenuStage(menu.selected, now, faces);
    return;
  }
  if (isRegistrationLocked(state.phase)) {
    // Registration is immutable once the countdown starts. Brief detector
    // dropouts or reordered results must not move players or restart the timer.
    return;
  }
  state.faces = faces;
  if (state.phase === "registering") {
    const now = performance.now();
    if (now - state.lastRegistrationCheck < 80) return;
    state.lastRegistrationCheck = now;
    state.registrationHands = hands;
    handleRegistration(hands, faces, now);
    if (state.phase === "camera-menu") return;
    state.players = registrationPlayers();
    renderCursors(elements.registrationCursors);
    renderFaceAnchors(elements.registrationFaces);
    updateFaceLockProgress(faces, hands, now);
  } else if (state.phase === "playing" && state.running && !state.paused) {
    const now = performance.now();
    if (state.recoveryActive) {
      handleRecoveryTracking(hands, faces, now);
      return;
    }
    state.faces = [];
    state.players = gameplayPlayers(hands);
    monitorGameplayPresence(now);
    renderCursors(elements.cursors);
  }
};

function updateCameraMenuZones(hands, faces, now) {
  const guide = elements.cameraMenuZones;
  if (state.cameraMenuStage === "mode") {
    guide.hidden = true;
    return;
  }
  const selected = selectRegistrationFaces(faces, activePlayerCount(), now, state.playerFaceSlots);
  if (!selected) {
    guide.hidden = true;
    return;
  }
  const matches = associateHandsToFaces(hands, selected, state.trackerKind, now, faces);
  const ownerIndex = matches.filter(Boolean).length === 1 ? matches.findIndex(Boolean)
    : selected.length === 1 ? 0 : -1;
  const faceX = selected[ownerIndex]?.face.x;
  if (!Number.isFinite(faceX)) {
    guide.hidden = true;
    return;
  }
  // Menu choices use hand.x - face.x, with boundaries at ±0.18 of camera width.
  guide.style.setProperty("--zone-center", `${Math.min(100, Math.max(0, faceX * 100))}%`);
  guide.hidden = false;
}

const handleTrackerStatus = (status) => {
  if (state.inputMode !== "camera") return;
  if (isRegistrationLocked(state.phase) && status.type !== "fatal-error") return;
  if (status.type === "fatal-error") {
    const detail = String(status.message || "Pose tracking stopped.").slice(0, 160);
    if (state.running) {
      endSession("interrupted");
      stopCamera();
      tracker.dispose();
      elements.resultMessage.textContent = `Movement tracking stopped (${detail}). The camera will restart for the next round.`;
    } else {
      stopCamera();
      tracker.dispose();
      if (kioskMode) {
        elements.loadingStatus.textContent = `Movement tracking stopped (${detail}). Restarting automatically…`;
        showPanel(elements.loading, "loading");
        clearTimeout(state.kioskRestartTimer);
        state.kioskRestartTimer = setTimeout(() => void startWithCamera(), 5000);
      } else {
        showPanel(elements.setup, "setup");
        elements.cameraMessage.textContent = `Movement tracking stopped: ${detail}. Please try the camera again.`;
      }
    }
    return;
  }
  if (status.type === "face-ready") {
    state.faceTrackingReady = true;
    state.faceTrackingError = "";
    if (state.phase === "registering") {
      updateFaceLockProgress(state.faces, state.registrationHands);
      elements.statusLive.textContent = state.trackerKind === "hybrid"
        ? "Body and hand tracking is ready."
        : "Face position tracking is ready.";
    } else if (state.recoveryActive) {
      elements.statusLive.textContent = "Face tracking ready. Waiting to reconnect player controls.";
    }
  }
  if (status.type === "face-error") {
    state.faceTrackingReady = false;
    state.faceTrackingError = status.message || "Face tracker could not load.";
    if (state.recoveryActive) {
      elements.recoveryMessage.textContent = "Face scanner could not reconnect. Stay in view and keep your hands raised.";
    } else {
      updateFaceLockProgress(state.faces, state.registrationHands);
      setRegistrationStatus("face-error", "Face scanner could not start. Please change setup and try again.", false);
    }
  }
  if (status.type === "pose-rebound") {
    status.changes.forEach(({ ownerIndex, personId }) => {
      state.playerPoseIds[ownerIndex] = personId;
    });
  }
  if (status.type === "tracking" && state.phase === "playing" && !state.recoveryActive) {
    updateTrackingStatus(state.players.filter((player) => player?.interactive !== false).length);
    if (state.trackerKind === "hybrid" && kioskMode) {
      if ((status.bodyCount ?? 0) > activePlayerCount()) {
        state.extraBodySince ??= performance.now();
        if (kioskMode && performance.now() - state.extraBodySince > 1200) {
          endSession("interrupted");
          return;
        }
      } else {
        state.extraBodySince = null;
      }
    }
  }
  if (status.type === "tracking") {
    const now = performance.now();
    if (now - state.lastDiagnosticsAt < DIAGNOSTICS_REFRESH_MS) return;
    state.lastDiagnosticsAt = now;
    const message = state.trackerKind === "hybrid"
      ? `Bodies ${status.bodyCount ?? 0} · Wrists ${status.count ?? 0} · ${status.cameraWidth ?? 0}×${status.cameraHeight ?? 0} · Video ${status.cameraFps ?? 0} FPS / Pose ${status.fps ?? 0} FPS / ${Math.round(status.inferenceMs ?? 0)} ms / frame age ${Math.round(status.frameAgeMs ?? 0)} ms · ${state.recoveryActive || state.phase === "registering" ? `Face points ${status.faceCount ?? 0}` : "Face check off"} · IDs ${status.personIds?.join(", ") || "—"}`
      : `Faces ${status.faceCount ?? 0} · Palms ${status.count ?? 0} · ${status.fps ?? 0} FPS / ${Math.round(status.inferenceMs ?? 0)} ms / frame age ${Math.round(status.frameAgeMs ?? 0)} ms · ${status.backend ?? "Local"}`;
    elements.registrationDiagnostics.textContent = message;
    elements.trackingDiagnostics.textContent = message;
  }
  if (status.type === "error") {
    const detail = String(status.message || "Tracking paused.").slice(0, 160);
    if (state.phase === "registering" || state.phase === "countdown") {
      elements.registrationStatusText.textContent = `Tracking paused: ${detail}. Retrying…`;
    } else if (state.phase === "camera-menu") {
      elements.cameraMenuStatus.textContent = `Tracking paused: ${detail}. Retrying…`;
    } else if (state.recoveryActive) {
      elements.recoveryMessage.textContent = `Tracking paused: ${detail}. Retrying…`;
    } else if (state.phase === "playing") {
      elements.trackingStatus.classList.add("tracking-alert");
      elements.trackingStatusText.textContent = `Tracking paused: ${detail}. Retrying…`;
    }
    elements.statusLive.textContent = `Player tracking paused: ${detail}.`;
  }
};

let tracker = new HandTracker(elements.registrationVideo, handleTrackedPlayers, handleTrackerStatus);

function selectTracker() {
  const hybridSelected = state.trackerKind === "hybrid";
  if ((hybridSelected && tracker instanceof HybridTracker) || (!hybridSelected && tracker instanceof HandTracker)) return;
  tracker.dispose();
  tracker = hybridSelected
    ? new HybridTracker(elements.registrationVideo, handleTrackedPlayers, handleTrackerStatus)
    : new HandTracker(elements.registrationVideo, handleTrackedPlayers, handleTrackerStatus);
}

function updateTrackingStatus(count) {
  const needed = getRequiredHandCount(state.playMode);
  const ready = count >= needed;
  elements.trackingStatus.classList.remove("tracking-alert");
  elements.trackingStatus.classList.toggle("hands-ready", ready);
  let message;
  if (state.playMode === "pvp") {
    message = ready
      ? "Both player controls connected"
      : "Tracking player hands…";
  } else {
    message = count ? "Hand tracking is ready" : "Show a hand to the camera";
  }
  if (elements.trackingStatusText.textContent !== message) elements.trackingStatusText.textContent = message;
}

async function requestCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access needs localhost or a secure HTTPS page.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: state.trackerKind === "hybrid"
      ? { width: { ideal: 480, max: 640 }, height: { ideal: 270, max: 360 },
        facingMode: "user", frameRate: { ideal: 24, max: 24 } }
      : { width: { ideal: kioskMode ? 640 : 960, max: kioskMode ? 640 : 1280 },
        height: { ideal: kioskMode ? 360 : 540, max: kioskMode ? 360 : 720 },
        facingMode: "user", frameRate: { ideal: 30, max: 30 } },
  });
  state.stream = stream;
  elements.registrationStage.prepend(elements.video);
  elements.video.hidden = false;
  tracker.setVideo(elements.registrationVideo);
  elements.registrationVideo.srcObject = stream;
  await elements.registrationVideo.play();
}

function stopCamera() {
  cancelRegistrationCountdown();
  tracker.stop();
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  elements.video.pause();
  elements.video.srcObject = null;
}

function setRegistrationStatus(key, text, ready) {
  if (state.registrationStatusKey === key && elements.registrationStatusText.textContent === text
    && elements.registrationStatus.classList.contains("is-ready") === ready) return;
  state.registrationStatusKey = key;
  elements.registrationStatus.classList.toggle("is-ready", ready);
  elements.registrationStatusText.textContent = text;
}

function updateFaceLockProgress(faces = [], hands = [], now = performance.now()) {
  const requiredFaces = state.playMode === "pvp" ? 2 : 1;
  const selected = selectRegistrationFaces(faces, requiredFaces, now, state.playerFaceSlots);
  const freshFaces = faces.filter((face) => face && face.interactive !== false
    && now - face.lastSeen <= FACE_FRESH_MS);
  const faceLocked = Boolean(selected && state.registrationFaceLock
    && sameFaceCandidates(state.registrationFaceLock, selected, state.trackerKind));
  elements.faceModelStatus.classList.toggle("is-ready", state.faceTrackingReady);
  elements.faceModelStatus.classList.toggle("is-error", Boolean(state.faceTrackingError));
  elements.faceModelStatus.textContent = state.faceTrackingError
    ? "Scanner unavailable"
    : state.faceTrackingReady
      ? state.trackerKind === "hybrid" ? "Face points ready" : "Scanner ready"
      : "Starting scanner…";
  elements.facePlayers.forEach((row, index) => {
    row.hidden = index >= requiredFaces;
    if (row.hidden) return;
    const faceFound = Boolean(selected?.[index]) || (requiredFaces === 1
      ? freshFaces.length > 0
      : freshFaces.some((face) => index === 0 ? (face.cameraX ?? face.x) < 0.5
        : (face.cameraX ?? face.x) >= 0.5));
    const handFound = faceLocked && Boolean(state.registrationMatches[index]);
    const locked = faceLocked && handFound;
    row.classList.toggle("is-locked", locked);
    row.querySelector("small").textContent = `Face ${faceLocked ? "✓" : faceFound ? "◌" : "○"} · ${state.trackerKind === "hybrid" ? "Wrist" : "Hand"} ${handFound ? "✓" : "○"}`;
    row.querySelector("i").textContent = locked ? "✓" : "○";
  });
}

function setRegistrationCopy() {
  const isPvp = state.playMode === "pvp";
  const isHybrid = state.trackerKind === "hybrid";
  elements.registrationDiagnostics.hidden = false;
  elements.registration.classList.toggle("solo-mode", !isPvp);
  elements.registration.classList.toggle("pvp-mode", isPvp);
  elements.registrationPlural.textContent = isPvp ? "s" : "";
  elements.registrationInstruction.textContent = isHybrid
    ? "Stand side by side with faces and shoulders visible. Raise one arm each so the camera can see your wrist, then keep that arm in view during play."
    : isPvp
      ? "Stand side by side and raise one hand each beside your face. Keep your hand on your own side of the camera view."
    : "Look at the camera and raise one hand beside your face. Keep your face and hand visible for the full countdown.";
  elements.playerTwoKey.hidden = !isPvp;
  elements.registrationTip.hidden = !isPvp;
  state.registrationStatusKey = "";
  updateFaceLockProgress([]);
  setRegistrationStatus(
    isPvp ? "waiting-pvp" : "waiting-solo",
    isHybrid ? "Looking for two faces, bodies and wrists…" : isPvp ? "Looking for two players…" : "Looking for your face and hand…",
    false,
  );
}

function showCameraMenu(requireRelease = false) {
  state.cameraMenuStage = "mode";
  state.cameraMenuArmed = !requireRelease;
  state.cameraMenuReleaseSince = null;
  state.cameraMenuCandidate = null;
  state.lastCameraMenuCheck = 0;
  resetFaceRegistration();
  state.players = [];
  state.faces = [];
  state.registrationHands = [];
  state.playerFaceSlots = [];
  state.playerHandSlots = [null, null];
  renderCursors(elements.registrationCursors);
  renderFaceAnchors(elements.registrationFaces);
  elements.cameraMenuMeter.style.width = "0%";
  renderCameraMenuStage();
  elements.cameraMenu.hidden = false;
  elements.registration.classList.add("camera-menu-mode");
  elements.registration.setAttribute("aria-labelledby", "cameraMenuTitle");
  showPanel(elements.registration, "camera-menu");
}

function renderCameraMenuStage() {
  const stage = state.cameraMenuStage;
  const mode = stage === "mode";
  elements.cameraMenuZones.hidden = true;
  elements.cameraMenuStep.textContent = stage === "mode" ? "Step 1 of 3 · Players"
    : stage === "pace" ? "Step 2 of 3 · Difficulty" : "Step 3 of 3 · Round time";
  elements.cameraMenuTitle.textContent = mode ? "Choose how to play"
    : stage === "pace" ? "Choose a comfortable pace" : "Choose round time";
  elements.cameraMenuInstruction.textContent = mode
    ? "Raise one hand for Solo, or one hand each for Together. Hold to choose."
    : stage === "pace"
      ? "One hand: left for Gentle · middle for Steady · right for Lively."
      : "One hand: left for 20s · middle for 30s · right for 60s.";
  elements.cameraMenuModeChoices.hidden = !mode;
  elements.cameraMenuSettingChoices.hidden = mode;
  elements.cameraMenuSolo.classList.remove("is-active");
  elements.cameraMenuPvp.classList.remove("is-active");
  const labels = stage === "duration"
    ? [["20 sec", "Short"], ["30 sec", "Regular"], ["60 sec", "Long"]]
    : [["Gentle", "Slow"], ["Steady", "Medium"], ["Lively", "Fast"]];
  elements.cameraMenuPositions.forEach((element, index) => {
    element.querySelector("strong").textContent = labels[index][0];
    element.querySelector("span").textContent = labels[index][1];
    element.classList.remove("is-active");
  });
  elements.cameraMenuMeter.style.width = "0%";
  elements.cameraMenuStatus.textContent = state.cameraMenuArmed
    ? mode ? "Waiting for one or two players with raised hands…" : "Raise one hand beside your face to choose."
    : "Lower hands out of view briefly before the next choice.";
}

function advanceCameraMenuStage(selected, now, faces) {
  state.cameraMenuCandidate = null;
  if (state.cameraMenuStage === "mode") {
    state.playerFaceSlots = selectRegistrationFaces(faces, selected === "pvp" ? 2 : 1, now)
      ?.map(({ slot }) => slot) ?? [];
    document.querySelector(`input[name="playMode"][value="${selected}"]`).checked = true;
    configureFromSetup();
    state.cameraMenuStage = "pace";
  } else if (state.cameraMenuStage === "pace") {
    const pace = { left: "gentle", middle: "steady", right: "lively" }[selected];
    document.querySelector(`input[name="pace"][value="${pace}"]`).checked = true;
    configureFromSetup();
    state.cameraMenuStage = "duration";
  } else {
    const duration = { left: "20", middle: "30", right: "60" }[selected];
    document.querySelector(`input[name="duration"][value="${duration}"]`).checked = true;
    configureFromSetup();
    elements.cameraMenu.hidden = true;
    elements.cameraMenuZones.hidden = true;
    elements.registration.classList.remove("camera-menu-mode");
    elements.registration.setAttribute("aria-labelledby", "registrationTitle");
    resetFaceRegistration();
    setRegistrationCopy();
    state.registrationStartedAt = now;
    state.phase = "registering";
    elements.statusLive.textContent = `${state.playMode === "pvp" ? "Two-player" : "Solo"}, ${state.pace} pace, ${state.durationSeconds} seconds selected. Raise your hands to register.`;
    return;
  }
  state.cameraMenuArmed = false;
  state.cameraMenuReleaseSince = null;
  renderCameraMenuStage();
}

async function startWithCamera() {
  if (state.starting || state.running) return;
  clearTimeout(state.kioskRestartTimer);
  state.kioskRestartTimer = null;
  state.starting = true;
  configureFromSetup();
  selectTracker();
  if (tracker instanceof HybridTracker) tracker.unlockPlayers();
  elements.registration.classList.toggle("camera-kiosk", kioskMode);
  state.inputMode = "camera";
  state.playerFaceSlots = [];
  state.playerPoseIds = [null, null];
  state.playerHandSides = [null, null];
  state.playerHandSlots = [null, null];
  state.playerBoundary = 0.5;
  state.faces = [];
  state.registrationHands = [];
  state.registrationMatches = [];
  state.registrationFaceCandidate = null;
  state.registrationFaceLock = null;
  state.registrationLastFaceAt = 0;
  state.registrationHandCandidates = [null, null];
  state.faceTrackingReady = tracker.faceTrackingReady;
  state.faceTrackingError = "";
  state.lastRegistrationCheck = 0;
  elements.cameraStart.disabled = true;
  elements.cameraStart.textContent = "Preparing camera…";
  elements.cameraMessage.textContent = "Your browser may ask for camera permission. Images never leave this device.";
  setRegistrationCopy();
  elements.loadingStatus.textContent = "Starting the camera and tracking model…";
  elements.loadingCountdown.hidden = true;
  showPanel(elements.loading, "loading");
  const loadingStartedAt = performance.now();
  tracker.setFaceTrackingEnabled(true);
  try {
    // Paint the warning before dynamic model loading starts. Show which half
    // of startup is still pending instead of an indefinite generic spinner.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    let cameraReady = false;
    let modelReady = false;
    await Promise.all([
      requestCamera().then(() => {
        cameraReady = true;
        if (state.starting && !modelReady) elements.loadingStatus.textContent = "Camera ready. Loading the movement tracker…";
      }),
      tracker.initialize().then(() => {
        modelReady = true;
        if (state.starting && !cameraReady) elements.loadingStatus.textContent = "Tracker ready. Waiting for the camera…";
      }),
    ]);
    let readTimeRemaining = Math.max(0, MIN_LOADING_READ_MS - (performance.now() - loadingStartedAt));
    if (readTimeRemaining > 0) {
      elements.loadingStatus.textContent = "Camera and tracker ready. Please finish reading the notice.";
      elements.loadingCountdown.hidden = false;
      while (readTimeRemaining > 0) {
        elements.loadingCountdown.textContent = `Continuing in ${Math.ceil(readTimeRemaining / 1000)} seconds`;
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000, readTimeRemaining)));
        readTimeRemaining = Math.max(0, MIN_LOADING_READ_MS - (performance.now() - loadingStartedAt));
      }
      elements.loadingCountdown.hidden = true;
    }
    if (kioskMode) showCameraMenu();
    else showPanel(elements.registration, "registering");
    tracker.start();
    elements.statusLive.textContent = kioskMode
      ? "Camera ready. Raise hands to choose a game mode."
      : "Camera ready. Raise your hands to register.";
  } catch (error) {
    stopCamera();
    if (kioskMode) {
      const detail = String(error?.message || "Camera or tracker unavailable.").slice(0, 160);
      elements.loadingStatus.textContent = error?.name === "NotAllowedError"
        ? "A helper needs to allow camera access once in this browser."
        : `${detail} Trying again shortly…`;
      if (error?.name !== "NotAllowedError") {
        state.kioskRestartTimer = setTimeout(() => void startWithCamera(), 5000);
      }
    } else {
      showPanel(elements.setup, "setup");
      elements.cameraMessage.textContent = `${error.message || "The camera could not start."} You can still try solo mode with the keyboard.`;
      elements.keyboardStart.focus({ preventScroll: true });
    }
  } finally {
    state.starting = false;
    elements.cameraStart.disabled = false;
    elements.cameraStart.textContent = "Continue with camera";
  }
}

function lockPlayerSlots(selected, hands) {
  const playerCount = state.playMode === "pvp" ? 2 : 1;
  const faces = selected.map(({ face }) => face);
  if (playerCount === 2) state.playerBoundary = getPlayerBoundary(faces) ?? state.playerBoundary;
  state.playerHandSlots = hands.map((hand) => hand?.registrationSlot ?? null);
  if (state.trackerKind === "hybrid") {
    state.playerPoseIds = faces.map((face) => face.personId);
    state.playerHandSides = hands.map((hand) => hand?.side ?? null);
    tracker.lockPlayers(state.playerPoseIds.map((personId, index) =>
      ({ personId, side: state.playerHandSides[index], bodyX: faces[index].cameraX ?? faces[index].x })),
    state.playerBoundary);
  }
  state.playerFaceSlots = selected.map(({ slot }) => slot);
}

function resetFaceRegistration() {
  state.registrationFaceCandidate = null;
  state.registrationFaceLock = null;
  state.registrationLastFaceAt = 0;
  state.registrationHandCandidates = [null, null];
  state.registrationMatches = [];
}

function handleRegistration(hands, faces, now) {
  if (isRegistrationLocked(state.phase)) return;
  if (kioskMode && now - state.registrationStartedAt > 25000) {
    resetFaceRegistration();
    showCameraMenu(true);
    return;
  }
  const playerCount = activePlayerCount();
  const selected = selectRegistrationFaces(faces, playerCount, now, state.playerFaceSlots);
  if (selected) state.playerFaceSlots = selected.map(({ slot }) => slot);
  if (!state.faceTrackingReady || !selected) {
    if (!state.faceTrackingReady || now - state.registrationLastFaceAt > 750) {
      resetFaceRegistration();
    }
    const visibleCount = faces.filter((face) => face && face.interactive !== false
      && now - face.lastSeen <= FACE_FRESH_MS).length;
    setRegistrationStatus(
      state.faceTrackingError ? "face-error" : !state.faceTrackingReady ? "face-loading" : `looking-for-faces-${visibleCount}`,
      state.faceTrackingError ? "Face scanner unavailable. Please try again."
        : !state.faceTrackingReady ? "Starting face scanner…"
          : playerCount === 2 ? `Step 1: show two separated faces (${visibleCount}/2 visible)`
            : "Step 1: look toward the camera until your face appears",
      false,
    );
    return;
  }
  state.registrationLastFaceAt = now;

  if (state.registrationFaceLock
    && !sameFaceCandidates(state.registrationFaceLock, selected, state.trackerKind)) {
    resetFaceRegistration();
  }
  if (!state.registrationFaceLock) {
    if (!state.registrationFaceCandidate
      || !sameFaceCandidates(state.registrationFaceCandidate.faces, selected, state.trackerKind)) {
      state.registrationFaceCandidate = { faces: snapshotFaces(selected, state.trackerKind), since: now };
    }
    if (now - state.registrationFaceCandidate.since < FACE_LOCK_MS) {
      setRegistrationStatus("holding-faces", "Step 1: selected faces found — hold still to lock them…", false);
      return;
    }
    state.registrationFaceLock = snapshotFaces(selected, state.trackerKind);
    state.registrationHandCandidates = [null, null];
  }

  const matches = associateHandsToFaces(hands, selected, state.trackerKind, now, faces);
  state.registrationMatches = matches;
  const allHandsFound = matches.length === playerCount && matches.every(Boolean);
  state.registrationHandCandidates = state.registrationHandCandidates.map((candidate, index) => {
    const identity = handIdentity(matches[index], state.trackerKind);
    return identity
      ? candidate?.identity === identity ? { ...candidate, lastSeen: now } : { identity, since: now, lastSeen: now }
      : candidate && now - candidate.lastSeen <= 650 ? candidate : null;
  });
  if (!allHandsFound) {
    setRegistrationStatus("looking-for-hands", state.trackerKind === "hybrid"
      ? "Step 2: faces linked — raise one arm each until both wrists appear"
      : "Step 2: faces locked — raise one hand beside each face", false);
    return;
  }
  if (!areHandCandidatesStable(state.registrationHandCandidates, playerCount, now, HAND_LOCK_MS)) {
    setRegistrationStatus("holding-hands", state.trackerKind === "hybrid"
      ? "Step 2: wrists linked — hold your arms there briefly…"
      : "Step 2: hands matched — hold them there briefly…", false);
    return;
  }

  setRegistrationStatus(
    state.playMode === "pvp" ? "ready-pvp" : "ready-solo",
    state.playMode === "pvp" ? `Both faces and ${state.trackerKind === "hybrid" ? "wrists" : "hands"} locked` : "Face and hand locked",
    true,
  );
  if (state.phase === "registering") {
    lockPlayerSlots(selected, matches);
    startRegistrationCountdown();
  }
}

function startRegistrationCountdown() {
  state.phase = "countdown";
  state.countdownEndsAt = performance.now() + REGISTRATION_COUNTDOWN_MS;
  elements.countdownBadge.hidden = false;
  elements.statusLive.textContent = state.playMode === "pvp"
    ? "Both players confirmed. Starting in three seconds."
    : "Face and hand confirmed. Starting in three seconds.";
  cancelAnimationFrame(state.countdownAnimationId);
  state.countdownAnimationId = requestAnimationFrame(updateRegistrationCountdown);
}

function updateRegistrationCountdown(now) {
  if (state.phase !== "countdown") return;
  const remaining = Math.max(0, state.countdownEndsAt - now);
  elements.countdownValue.textContent = Math.max(1, Math.ceil(remaining / 1000));
  if (remaining <= 0) {
    elements.countdownBadge.hidden = true;
    void startSession("camera");
    return;
  }
  state.countdownAnimationId = requestAnimationFrame(updateRegistrationCountdown);
}

function cancelRegistrationCountdown() {
  cancelAnimationFrame(state.countdownAnimationId);
  state.countdownAnimationId = null;
  elements.countdownBadge.hidden = true;
  elements.countdownValue.textContent = "3";
}

function cancelRegistration() {
  stopCamera();
  state.players = [];
  state.faces = [];
  renderCursors(elements.registrationCursors);
  renderFaceAnchors(elements.registrationFaces);
  showPanel(elements.setup, "setup");
  elements.cameraMessage.textContent = "";
  elements.cameraStart.focus({ preventScroll: true });
}

async function startSession(inputMode) {
  if (inputMode === "camera") {
    // Registration and play share one video element. There is no second
    // decoder/play() handoff at the exact moment the countdown ends.
    if (!state.stream || elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      stopCamera();
      elements.loadingStatus.textContent = "Camera is settling. Reconnecting automatically…";
      showPanel(elements.loading, "loading");
      state.gameVideoRetryCount += 1;
      if (state.gameVideoRetryCount <= 3) {
        state.kioskRestartTimer = setTimeout(() => void startWithCamera(), 1200);
      } else if (kioskMode) {
        elements.loadingStatus.textContent = "The camera is having trouble. Trying again in a few moments…";
        state.kioskRestartTimer = setTimeout(() => void startWithCamera(), 10000);
      } else {
        elements.loadingStatus.textContent = "The camera could not continue. Please ask a helper to check it.";
      }
      return;
    }
  }
  state.gameVideoRetryCount = 0;
  configureFromSetup();
  state.running = true;
  state.paused = false;
  state.phase = "playing";
  state.inputMode = inputMode;
  state.playerStats = [emptyPlayerStats(), emptyPlayerStats()];
  state.caught = 0;
  state.missed = 0;
  state.remainingSeconds = state.durationSeconds;
  state.startedAt = performance.now();
  state.pausedDuration = 0;
  state.lastFrame = state.startedAt;
  state.lastStatsAt = state.startedAt;
  state.lastSpawn = state.startedAt - getPaceConfig(state.pace).spawnInterval * 0.55;
  state.objects = [];
  state.missingPlayerSince = [null, null];
  state.recoveryActive = false;
  state.recoveryMissingPlayers = [];
  state.recoveryStartedAt = 0;
  state.recoveryReadySince = null;
  state.recoveryCandidate = null;
  state.extraBodySince = null;
  state.faces = [];
  elements.trackingRecovery.hidden = true;
  elements.pause.disabled = false;
  elements.play.classList.toggle("camera-kiosk", kioskMode);
  if (inputMode === "keyboard") {
    state.playMode = "solo";
    state.players = [{ x: 0.5, y: 0.72, radius: 44, ownerIndex: 0 }];
  } else {
    elements.board.prepend(elements.video);
    tracker.setFaceTrackingEnabled(false);
  }

  elements.targets.replaceChildren();
  showPanel(elements.play, "playing");
  elements.video.hidden = inputMode !== "camera";
  elements.trackingStatus.hidden = inputMode !== "camera";
  elements.cameraSpaceNotice.hidden = !kioskMode && state.playMode !== "pvp";
  elements.cameraSpaceNotice.textContent = state.playMode === "pvp"
    ? "Two players only · Everyone else, please stay outside the camera view"
    : "Player only · Everyone else, please stay outside the camera view";
  elements.trackingDiagnostics.hidden = inputMode !== "camera" || state.trackerKind !== "hybrid";
  elements.board.classList.toggle("keyboard-mode", inputMode === "keyboard");
  elements.board.classList.toggle("pvp-mode", state.playMode === "pvp");
  elements.play.classList.toggle("pvp-mode", state.playMode === "pvp");
  elements.pvpArena.hidden = state.playMode !== "pvp";
  elements.battleLanes.forEach((lane) => lane.classList.remove("lane-scored", "lane-hazard"));
  elements.playerTwoScoreCard.hidden = state.playMode !== "pvp";
  updateTrackingStatus(state.players.filter(Boolean).length);
  elements.inputHint.textContent = inputMode === "camera"
    ? state.playMode === "pvp"
      ? state.trackerKind === "hybrid"
        ? "Stay on your side of the camera. Your visible wrist controls your lane."
        : "Stay on your side of the camera. Raise one hand to control your lane, catch shapes and avoid hazards."
      : "Your palms control the circles. Catch garden shapes and avoid hazards."
    : "Use the arrow keys or W A S D. Catch garden shapes and avoid hazards.";
  elements.pause.textContent = "Pause";
  elements.pauseOverlay.hidden = true;
  updateStats();
  renderCursors(elements.cursors);
  elements.board.focus({ preventScroll: true });
  elements.statusLive.textContent = state.playMode === "pvp" ? "Split-screen battle started." : "Session started.";
  cancelAnimationFrame(state.animationId);
  state.animationId = requestAnimationFrame(gameLoop);
}

function spawnObject(now) {
  const config = getPaceConfig(state.pace);
  const isPvp = state.playMode === "pvp";
  if (now - state.lastSpawn < config.spawnInterval) return;

  if (isPvp) {
    const laneCounts = [0, 1].map((ownerIndex) =>
      state.objects.filter((object) => object.ownerIndex === ownerIndex).length,
    );
    if (laneCounts.every((count) => count >= config.maxObjects)) return;
    const type = randomObjectType();
    const localPosition = Math.random();
    if (laneCounts[0] < config.maxObjects) {
      createFallingObject(now, type, getPvpSpawnX(0, localPosition), 0);
    }
    if (laneCounts[1] < config.maxObjects) {
      createFallingObject(now + 0.01, type, getPvpSpawnX(1, localPosition), 1);
    }
  } else {
    if (state.objects.length >= config.maxObjects) return;
    createFallingObject(now, randomObjectType(), 0.1 + Math.random() * 0.8, null);
  }
  state.lastSpawn = now;
}

function createFallingObject(now, type, x, ownerIndex) {
  const object = {
    id: `${now}-${Math.random()}`,
    type,
    ownerIndex,
    x,
    y: -0.08,
    radius: 30,
    drift: (Math.random() - 0.5) * (ownerIndex === null ? 0.025 : 0.012),
    phase: Math.random() * Math.PI * 2,
  };
  const node = document.createElement("div");
  node.className = `falling-object ${type.kind}${ownerIndex === null ? "" : ` player-${ownerIndex + 1}-target`}`;
  node.textContent = type.symbol;
  node.dataset.id = object.id;
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", type.label);
  object.node = node;
  state.objects.push(object);
  elements.targets.append(node);
}

function updateKeyboard(deltaSeconds) {
  if (state.inputMode !== "keyboard") return;
  const player = state.players[0];
  if (!player) return;
  const speed = 0.52 * deltaSeconds;
  if (state.keys.has("arrowleft") || state.keys.has("a")) player.x -= speed;
  if (state.keys.has("arrowright") || state.keys.has("d")) player.x += speed;
  if (state.keys.has("arrowup") || state.keys.has("w")) player.y -= speed;
  if (state.keys.has("arrowdown") || state.keys.has("s")) player.y += speed;
  player.x = clamp(player.x, 0.04, 0.96);
  player.y = clamp(player.y, 0.06, 0.94);
}

function gameLoop(now) {
  if (!state.running) return;
  if (state.paused) {
    state.lastFrame = now;
    state.animationId = requestAnimationFrame(gameLoop);
    return;
  }
  if (state.recoveryActive) {
    state.lastFrame = now;
    state.animationId = requestAnimationFrame(gameLoop);
    return;
  }
  if (state.inputMode === "camera" && now - state.lastFrame < CAMERA_GAME_FRAME_MS) {
    state.animationId = requestAnimationFrame(gameLoop);
    return;
  }

  const deltaSeconds = Math.min((now - state.lastFrame) / 1000, 0.05);
  state.lastFrame = now;
  state.remainingSeconds = state.durationSeconds - (now - state.startedAt - state.pausedDuration) / 1000;
  if (state.remainingSeconds <= 0) {
    endSession("time");
    return;
  }

  updateKeyboard(deltaSeconds);
  if (state.inputMode === "camera") {
    state.players = state.players.map((player) => player && now - player.lastSeen > 550
      ? { ...player, interactive: false } : player);
    monitorGameplayPresence(now);
    if (state.recoveryActive) {
      state.animationId = requestAnimationFrame(gameLoop);
      return;
    }
  }
  spawnObject(now);
  updateObjects(deltaSeconds, now);
  if (now - state.lastStatsAt >= STATS_REFRESH_MS) {
    updateStats();
    state.lastStatsAt = now;
  }
  if (state.inputMode === "keyboard") renderCursors(elements.cursors);
  state.animationId = requestAnimationFrame(gameLoop);
}

function closestCollidingPlayer(objectPosition, players, requiredOwnerIndex = null) {
  let closest = null;
  players.forEach((player) => {
    if (requiredOwnerIndex !== null && player?.ownerIndex !== requiredOwnerIndex) return;
    if (!player || player.interactive === false || !circlesOverlap(objectPosition, player)) return;
    const distance = Math.hypot(objectPosition.x - player.x, objectPosition.y - player.y);
    if (!closest || distance < closest.distance) closest = { ownerIndex: player.ownerIndex ?? 0, distance };
  });
  return closest?.ownerIndex ?? -1;
}

function updateObjects(deltaSeconds, now) {
  const boardHeight = elements.board.clientHeight;
  const boardWidth = elements.board.clientWidth;
  const fallRate = getPaceConfig(state.pace).fallSpeed / Math.max(boardHeight, 1);
  const boardPlayers = state.players.map((player) => player ? {
    ...player,
    x: player.x * boardWidth,
    y: player.y * boardHeight,
  } : null);

  for (const object of [...state.objects]) {
    object.y += fallRate * deltaSeconds;
    const sway = Math.sin(now / 650 + object.phase) * object.drift;
    const lane = object.ownerIndex === null ? null : PVP_LANES[object.ownerIndex];
    const displayX = clamp(
      object.x + sway,
      lane ? lane.minX + 0.025 : 0.05,
      lane ? lane.maxX - 0.025 : 0.95,
    );
    object.node.style.transform = `translate(${displayX * boardWidth}px, ${object.y * boardHeight}px)`;
    const objectPosition = { x: displayX * boardWidth, y: object.y * boardHeight, radius: object.radius };
    const ownerIndex = closestCollidingPlayer(objectPosition, boardPlayers, object.ownerIndex);
    if (ownerIndex >= 0) {
      resolveObject(object, ownerIndex);
    } else if (object.y > 1.08) {
      if (object.type.hazard) removeObject(object);
      else missObject(object);
    }
  }
}

function removeObject(object) {
  object.node.remove();
  state.objects = state.objects.filter((candidate) => candidate.id !== object.id);
}

function resolveObject(object, ownerIndex) {
  const current = state.playerStats[ownerIndex] ?? state.playerStats[0];
  const result = applyObjectScore(current, object.type);
  Object.assign(current, result);
  current.bestStreak = Math.max(current.bestStreak, current.streak);
  object.node.classList.add(object.type.hazard ? "hazard-hit" : "collected");
  setTimeout(() => object.node.remove(), 260);
  state.objects = state.objects.filter((candidate) => candidate.id !== object.id);
  const playerName = state.playMode === "pvp" ? `Player ${ownerIndex + 1}` : "You";
  const battleLane = state.playMode === "pvp" ? elements.battleLanes[ownerIndex] : null;

  if (object.type.hazard) {
    updateStats();
    const flashTarget = battleLane ?? elements.board;
    const flashClass = battleLane ? "lane-hazard" : "hazard-flash";
    flashTarget.classList.remove(flashClass);
    void flashTarget.offsetWidth;
    flashTarget.classList.add(flashClass);
    setTimeout(() => flashTarget.classList.remove(flashClass), 300);
    const pointsLost = Math.abs(result.delta);
    elements.statusLive.textContent = `${playerName} hit a ${object.type.label}. ${pointsLost ? `${pointsLost} points lost. ` : ""}Streak reset.`;
    return;
  }

  current.caught += 1;
  state.caught += 1;
  updateStats();
  if (battleLane) {
    battleLane.classList.remove("lane-scored");
    void battleLane.offsetWidth;
    battleLane.classList.add("lane-scored");
    setTimeout(() => battleLane.classList.remove("lane-scored"), 320);
  }
  elements.statusLive.textContent = `${playerName} caught a ${object.type.label} for ${result.delta} points.`;
}

function missObject(object) {
  removeObject(object);
  state.missed += 1;
  updateStats();
  const missLimit = getPaceConfig(state.pace).missLimit * (state.playMode === "pvp" ? 2 : 1);
  if (state.missed >= missLimit) endSession("misses");
}

function renderCursors(cursorElements) {
  cursorElements.forEach((cursor, index) => {
    const player = state.players[index];
    cursor.hidden = !player;
    if (!player) return;
    cursor.style.left = `${player.x * 100}%`;
    cursor.style.top = `${player.y * 100}%`;
  });
}

function renderFaceAnchors(anchorElements) {
  anchorElements.forEach((anchor, index) => {
    const faceSlotIndex = state.playerFaceSlots[index] ?? index;
    const face = state.faces[faceSlotIndex];
    anchor.hidden = !face;
    if (!face) return;
    anchor.style.left = `${face.x * 100}%`;
    anchor.style.top = `${face.y * 100}%`;
    anchor.style.width = `${face.width * 100}%`;
    anchor.style.height = `${face.height * 100}%`;
    anchor.classList.toggle("face-searching", face.interactive === false);
  });
}

function streakLabel(stats) {
  if (!stats.streak) return "Ready";
  return stats.multiplier > 1 ? `${stats.streak} streak · ×${stats.multiplier}` : `${stats.streak} streak`;
}

function updateStats() {
  const config = getPaceConfig(state.pace);
  const setText = (element, value) => {
    const next = String(value);
    if (element.textContent !== next) element.textContent = next;
  };
  setText(elements.playerOneScore, state.playerStats[0].score);
  setText(elements.playerOneStreak, streakLabel(state.playerStats[0]));
  setText(elements.playerTwoScore, state.playerStats[1].score);
  setText(elements.playerTwoStreak, streakLabel(state.playerStats[1]));
  setText(elements.laneOneScore, state.playerStats[0].score);
  setText(elements.laneOneStreak, streakLabel(state.playerStats[0]));
  setText(elements.laneTwoScore, state.playerStats[1].score);
  setText(elements.laneTwoStreak, streakLabel(state.playerStats[1]));
  setText(elements.caught, state.caught);
  setText(elements.missed, state.missed);
  setText(elements.missLimit, config.missLimit * (state.playMode === "pvp" ? 2 : 1));
  setText(elements.time, formatTime(state.remainingSeconds));
}

function togglePause() {
  if (!state.running || state.recoveryActive) return;
  state.paused = !state.paused;
  if (state.paused) {
    state.pausedAt = performance.now();
    if (state.inputMode === "camera") {
      tracker.stop();
      state.players = [];
      renderCursors(elements.cursors);
    }
    elements.pause.textContent = "Continue";
    elements.pauseOverlay.hidden = false;
    elements.statusLive.textContent = "Session paused.";
  } else {
    state.pausedDuration += performance.now() - state.pausedAt;
    state.lastFrame = performance.now();
    if (state.inputMode === "camera") tracker.start();
    elements.pause.textContent = "Pause";
    elements.pauseOverlay.hidden = true;
    elements.statusLive.textContent = "Session continued.";
    elements.board.focus({ preventScroll: true });
  }
}

function endSession(reason = "ended") {
  if (!state.running) return;
  state.running = false;
  state.paused = false;
  cancelAnimationFrame(state.animationId);
  if (state.inputMode === "camera") {
    if (kioskMode) tracker.stop();
    else stopCamera();
  }
  state.objects.forEach((object) => object.node.remove());
  state.objects = [];
  state.players = [];
  state.faces = [];
  state.recoveryActive = false;
  state.recoveryMissingPlayers = [];
  state.recoveryReadySince = null;
  state.recoveryCandidate = null;
  state.extraBodySince = null;
  elements.trackingRecovery.hidden = true;
  elements.pause.disabled = false;
  renderCursors(elements.cursors);

  showPanel(elements.results, "results");
  elements.results.classList.toggle("camera-kiosk", kioskMode);
  elements.resultsKioskStatus.hidden = !kioskMode;
  const scores = state.playerStats.map((player) => player.score);
  const matchResult = getMatchResult(scores[0], scores[1], state.playMode);
  elements.resultsTitle.textContent = reason === "interrupted" ? "Let’s try another round" : matchResult.title;
  elements.resultMessage.textContent = reason === "interrupted"
    ? "A player left the camera view, so this round ended to keep player controls safe."
    : reason === "misses"
    ? `${state.caught} shapes caught. Time for a gentle rest.`
    : matchResult.message;
  elements.finalPlayerOneLabel.textContent = state.playMode === "pvp" ? "Player 1" : "Score";
  elements.finalPlayerOneScore.textContent = scores[0];
  elements.finalPlayerTwoCard.hidden = state.playMode !== "pvp";
  elements.finalPlayerTwoScore.textContent = scores[1];
  elements.finalCaught.textContent = state.caught;
  elements.statusLive.textContent = `Session complete. ${matchResult.title}`;
  if (kioskMode) {
    clearTimeout(state.kioskRestartTimer);
    state.kioskRestartTimer = setTimeout(() => {
      if (state.phase === "results") returnToCameraMenu();
    }, 8000);
  } else {
    elements.playAgain.focus({ preventScroll: true });
  }
}

function returnToCameraMenu() {
  clearTimeout(state.kioskRestartTimer);
  state.kioskRestartTimer = null;
  if (!kioskMode || state.phase !== "results") return;
  const cameraLive = state.stream?.getVideoTracks().some((track) => track.readyState === "live")
    && elements.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  if (!cameraLive) {
    stopCamera();
    void startWithCamera();
    return;
  }
  if (tracker instanceof HybridTracker) tracker.unlockPlayers();
  tracker.setFaceTrackingEnabled(true);
  elements.registrationStage.prepend(elements.video);
  elements.video.hidden = false;
  showCameraMenu(true);
  tracker.start();
  elements.statusLive.textContent = "Camera menu ready. Lower your hands, then choose another session.";
}

function resetToSetup() {
  elements.cameraMessage.textContent = "";
  showPanel(elements.setup, "setup");
  elements.cameraStart.focus({ preventScroll: true });
}

function resetToWelcome() {
  elements.cameraMessage.textContent = "";
  showPanel(elements.landing, "landing");
  elements.enterGame.focus({ preventScroll: true });
}

function handleKeyDown(event) {
  const key = event.key.toLowerCase();
  if (["arrowleft", "arrowright", "arrowup", "arrowdown", "w", "a", "s", "d"].includes(key)) {
    if (state.running && state.inputMode === "keyboard") event.preventDefault();
    state.keys.add(key);
  }
  if (key === " " && state.running && event.target === elements.board) {
    event.preventDefault();
    togglePause();
  }
  if (key === "escape" && state.running) togglePause();
}

elements.enterGame.addEventListener("click", () => {
  showPanel(elements.setup, "setup");
  elements.cameraStart.focus({ preventScroll: true });
});
elements.backToWelcome.addEventListener("click", resetToWelcome);
elements.cameraStart.addEventListener("click", () => {
  state.gameVideoRetryCount = 0;
  void startWithCamera();
});
document.querySelectorAll('input[name="playMode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    elements.poseTrackerOption.hidden = selectedValue("playMode") !== "pvp";
  });
});
elements.keyboardStart.addEventListener("click", () => startSession("keyboard"));
elements.cancelRegistration.addEventListener("click", cancelRegistration);
elements.recoveryConfirm.addEventListener("click", () => {
  const candidate = state.recoveryCandidate;
  const now = performance.now();
  if (!state.recoveryActive || !candidate) return;
  if (now - candidate.at > 400) {
    elements.recoveryConfirm.disabled = true;
    elements.recoveryMessage.textContent = "Hold still with both faces and wrists visible, then confirm again.";
    return;
  }
  finishTrackingRecovery(candidate.hands, candidate.selected, candidate.matches, now);
});
elements.pause.addEventListener("click", togglePause);
elements.end.addEventListener("click", () => endSession("ended"));
elements.playAgain.addEventListener("click", () => kioskMode ? returnToCameraMenu() : resetToSetup());
elements.backHome.addEventListener("click", () => kioskMode ? returnToCameraMenu() : resetToWelcome());
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", (event) => state.keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => state.keys.clear());
window.addEventListener("beforeunload", () => {
  clearTimeout(state.kioskRestartTimer);
  stopCamera();
  tracker.dispose();
});

elements.modeSwitch.textContent = kioskMode ? "Switch to the classic menu" : "Switch to the camera-only menu";
elements.modeSwitch.href = kioskMode ? "?mode=manual" : window.location.pathname;

if (kioskMode) {
  document.querySelector('input[name="playMode"][value="pvp"]').checked = true;
  elements.poseTrackerToggle.checked = true;
  const pace = pageParams.get("pace");
  const duration = pageParams.get("duration");
  if (["gentle", "steady", "lively"].includes(pace)) {
    document.querySelector(`input[name="pace"][value="${pace}"]`).checked = true;
  }
  if (["20", "30", "60"].includes(duration)) {
    document.querySelector(`input[name="duration"][value="${duration}"]`).checked = true;
  }
  void startWithCamera();
} else {
  showPanel(elements.landing, "landing");
}

if (import.meta.env.DEV) {
  window.__gentleCatch = {
    getState: () => ({
      phase: state.phase,
      playMode: state.playMode,
      running: state.running,
      recoveryActive: state.recoveryActive,
    }),
    simulateTracking: (hands = [], faces = []) => tracker.onHands(hands, faces),
  };
  const preview = new URLSearchParams(window.location.search).get("preview");
  if (preview === "kiosk-loading") {
    elements.loadingStatus.textContent = "Starting the camera and tracking model…";
    showPanel(elements.loading, "loading");
  } else if (preview === "camera-menu") {
    state.inputMode = "camera";
    showCameraMenu();
  } else if (preview === "camera-menu-pace" || preview === "camera-menu-duration") {
    state.inputMode = "camera";
    state.playMode = "pvp";
    state.pace = "steady";
    showCameraMenu();
    state.cameraMenuStage = preview === "camera-menu-pace" ? "pace" : "duration";
    renderCameraMenuStage();
    elements.cameraMenuZones.style.setProperty("--zone-center", "50%");
    elements.cameraMenuZones.hidden = false;
  } else if (preview === "kiosk-results") {
    showPanel(elements.results, "results");
    elements.results.classList.add("camera-kiosk");
    elements.resultsKioskStatus.hidden = false;
  } else if (preview === "face-init") {
    document.querySelector('input[name="playMode"][value="pvp"]').checked = true;
    configureFromSetup();
    state.inputMode = "camera";
    setRegistrationCopy();
    showPanel(elements.registration, "registering");
    tracker.setFaceTrackingEnabled(true);
    tracker.initialize().catch((error) => {
      state.faceTrackingError = error?.message || "Tracking could not load.";
      updateFaceLockProgress([]);
    });
  } else if (preview === "pvp-registration") {
    document.querySelector('input[name="playMode"][value="pvp"]').checked = true;
    configureFromSetup();
    state.inputMode = "camera";
    state.faceTrackingReady = true;
    const previewTime = performance.now();
    state.registrationHands = [
      { x: 0.3, y: 0.55, lastSeen: previewTime, interactive: true },
      { x: 0.7, y: 0.55, lastSeen: previewTime, interactive: true },
    ];
    state.players = [
      { x: 0.3, y: 0.55, radius: 44, ownerIndex: 0 },
      { x: 0.7, y: 0.55, radius: 44, ownerIndex: 1 },
    ];
    state.faces = [
      { x: 0.3, y: 0.26, width: 0.15, height: 0.22, lastSeen: previewTime, interactive: true },
      { x: 0.7, y: 0.26, width: 0.15, height: 0.22, lastSeen: previewTime, interactive: true },
    ];
    state.playerFaceSlots = [0, 1];
    setRegistrationCopy();
    showPanel(elements.registration, "countdown");
    elements.registrationStatus.classList.add("is-ready");
    elements.registrationStatusText.textContent = "Both players ready";
    elements.countdownBadge.hidden = false;
    renderCursors(elements.registrationCursors);
    renderFaceAnchors(elements.registrationFaces);
    updateFaceLockProgress(state.faces, state.registrationHands, previewTime);
  } else if (preview === "pvp-game") {
    document.querySelector('input[name="playMode"][value="pvp"]').checked = true;
    configureFromSetup();
    state.inputMode = "camera";
    state.playerStats = [
      { ...emptyPlayerStats(), score: 55, streak: 4, multiplier: 2, caught: 4 },
      { ...emptyPlayerStats(), score: 40, streak: 2, caught: 3 },
    ];
    state.caught = 7;
    state.players = [
      { x: 0.3, y: 0.62, radius: 44, ownerIndex: 0 },
      { x: 0.7, y: 0.56, radius: 44, ownerIndex: 1 },
    ];
    state.faces = [];
    state.playerFaceSlots = [0, 1];
    showPanel(elements.play, "playing");
    elements.play.classList.add("camera-kiosk");
    elements.video.hidden = true;
    elements.trackingStatus.hidden = false;
    elements.cameraSpaceNotice.hidden = false;
    elements.board.classList.add("keyboard-mode", "pvp-mode");
    elements.play.classList.add("pvp-mode");
    elements.pvpArena.hidden = false;
    elements.playerTwoScoreCard.hidden = false;
    elements.inputHint.textContent = "Split-screen score battle: each player controls one side. Catch your shapes and avoid hazards.";
    updateTrackingStatus(2);
    updateStats();
    renderCursors(elements.cursors);
  } else if (preview === "pvp-recovery") {
    document.querySelector('input[name="playMode"][value="pvp"]').checked = true;
    configureFromSetup();
    state.inputMode = "camera";
    state.running = true;
    state.recoveryActive = true;
    state.recoveryMissingPlayers = [1];
    state.players = [
      { x: 0.3, y: 0.62, radius: 44, ownerIndex: 0 },
      null,
    ];
    showPanel(elements.play, "playing");
    elements.video.hidden = true;
    elements.trackingStatus.hidden = false;
    elements.board.classList.add("keyboard-mode", "pvp-mode");
    elements.play.classList.add("pvp-mode");
    elements.pvpArena.hidden = false;
    elements.playerTwoScoreCard.hidden = false;
    elements.pause.disabled = true;
    elements.trackingRecovery.hidden = false;
    updateRecoveryOverlay([], []);
    updateStats();
    renderCursors(elements.cursors);
  }
}
