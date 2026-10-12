import "./styles.css";
import {
  applyObjectScore,
  circlesOverlap,
  clamp,
  formatTime,
  getMatchResult,
  getOrderedHandEntries,
  getPaceConfig,
  getRequiredHandCount,
  randomObjectType,
  REGISTRATION_COUNTDOWN_MS,
} from "./gameLogic.js";
import { HandTracker } from "./handTracker.js";

const $ = (selector) => document.querySelector(selector);
const panels = [$("#landingPanel"), $("#setupPanel"), $("#registrationPanel"), $("#playPanel"), $("#resultsPanel")];
const elements = {
  landing: $("#landingPanel"),
  setup: $("#setupPanel"),
  registration: $("#registrationPanel"),
  play: $("#playPanel"),
  results: $("#resultsPanel"),
  enterGame: $("#enterGame"),
  backToWelcome: $("#backToWelcome"),
  cameraStart: $("#cameraStart"),
  keyboardStart: $("#keyboardStart"),
  cameraMessage: $("#cameraMessage"),
  cancelRegistration: $("#cancelRegistration"),
  registrationVideo: $("#registrationVideo"),
  registrationPlural: $("#registrationPlural"),
  registrationInstruction: $("#registrationInstruction"),
  registrationStatus: $("#registrationStatus"),
  registrationStatusText: $("#registrationStatus strong"),
  registrationTip: $(".registration-tip"),
  registrationCursors: [...document.querySelectorAll("#registrationCursors .player-cursor")],
  playerTwoKey: $("#playerTwoKey"),
  countdownBadge: $("#countdownBadge"),
  countdownValue: $("#countdownValue"),
  board: $("#gameBoard"),
  targets: $("#targets"),
  cursors: [...document.querySelectorAll("#playerCursors .player-cursor")],
  trackingStatus: $("#trackingStatus"),
  trackingStatusText: $("#trackingStatus strong"),
  video: $("#cameraVideo"),
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
  statusLive: $("#statusLive"),
};

function emptyPlayerStats() {
  return { score: 0, streak: 0, multiplier: 1, bestStreak: 0, caught: 0 };
}

const state = {
  phase: "landing",
  running: false,
  paused: false,
  inputMode: "keyboard",
  playMode: "solo",
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
  lastSpawn: 0,
  objects: [],
  players: [],
  keys: new Set(),
  stream: null,
  animationId: null,
  countdownAnimationId: null,
  countdownEndsAt: 0,
  playerSlots: [],
};

function showPanel(panel, phase) {
  panels.forEach((candidate) => { candidate.hidden = candidate !== panel; });
  state.phase = phase;
  panel.scrollIntoView({ block: "start" });
}

function selectedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function configureFromSetup() {
  state.playMode = selectedValue("playMode");
  state.pace = selectedValue("pace");
  state.durationSeconds = Number(selectedValue("duration"));
  state.remainingSeconds = state.durationSeconds;
}

function visibleHandEntries(hands) {
  return getOrderedHandEntries(hands).filter(({ hand }) => hand.interactive !== false);
}

function registrationPlayers(hands) {
  const entries = visibleHandEntries(hands);
  if (state.playMode === "pvp") {
    return entries.slice(0, 2).map(({ hand }, ownerIndex) => ({ ...hand, radius: 44, ownerIndex }));
  }
  return entries.slice(0, 2).map(({ hand }) => ({ ...hand, radius: 44, ownerIndex: 0 }));
}

function gameplayPlayers(hands) {
  if (state.playMode === "pvp") {
    return state.playerSlots.map((slotIndex, ownerIndex) => {
      const hand = hands[slotIndex];
      return hand ? { ...hand, radius: 44, ownerIndex } : null;
    });
  }
  return hands.filter(Boolean).slice(0, 2).map((hand) => ({ ...hand, radius: 44, ownerIndex: 0 }));
}

const tracker = new HandTracker(elements.registrationVideo, (hands) => {
  if (state.inputMode !== "camera") return;
  if (state.phase === "registering" || state.phase === "countdown") {
    state.players = registrationPlayers(hands);
    renderCursors(elements.registrationCursors);
    handleRegistration(hands);
  } else if (state.phase === "playing" && state.running && !state.paused) {
    state.players = gameplayPlayers(hands);
  }
}, (status) => {
  if (state.inputMode !== "camera") return;
  if (status.type === "tracking" && state.phase === "playing") updateTrackingStatus(status.count);
  if (status.type === "error") {
    if (state.phase === "registering" || state.phase === "countdown") {
      elements.registrationStatusText.textContent = "Tracking is recovering…";
    } else if (state.phase === "playing") {
      elements.trackingStatusText.textContent = "Tracking is recovering…";
    }
    elements.statusLive.textContent = "Hand tracking is recovering.";
  }
});

function updateTrackingStatus(count) {
  const needed = getRequiredHandCount(state.playMode);
  const ready = count >= needed;
  elements.trackingStatus.classList.toggle("hands-ready", ready);
  if (state.playMode === "pvp") {
    elements.trackingStatusText.textContent = ready ? "Both players are in view" : "Keep one hand per player in view";
  } else {
    elements.trackingStatusText.textContent = count ? "Hand tracking is ready" : "Show a hand to the camera";
  }
}

async function requestCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access needs localhost or a secure HTTPS page.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: 1280, max: 1280 },
      height: { ideal: 720, max: 720 },
      facingMode: "user",
      frameRate: { ideal: 30, max: 30 },
    },
  });
  elements.registrationVideo.srcObject = stream;
  elements.video.srcObject = stream;
  await Promise.all([elements.registrationVideo.play(), elements.video.play()]);
  state.stream = stream;
}

function stopCamera() {
  cancelRegistrationCountdown();
  tracker.stop();
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  elements.registrationVideo.srcObject = null;
  elements.video.srcObject = null;
}

function setRegistrationCopy() {
  const isPvp = state.playMode === "pvp";
  elements.registration.classList.toggle("solo-mode", !isPvp);
  elements.registration.classList.toggle("pvp-mode", isPvp);
  elements.registrationPlural.textContent = isPvp ? "s" : "";
  elements.registrationInstruction.textContent = isPvp
    ? "Each player raises one hand. Keep both hands comfortably visible for the full countdown."
    : "Raise one or both hands. Keep them comfortably visible for the full countdown.";
  elements.playerTwoKey.hidden = !isPvp;
  elements.registrationTip.hidden = !isPvp;
  elements.registrationStatusText.textContent = isPvp ? "Looking for two players…" : "Looking for your hand…";
  elements.registrationStatus.classList.remove("is-ready");
}

async function startWithCamera() {
  configureFromSetup();
  state.inputMode = "camera";
  state.playerSlots = [];
  elements.cameraStart.disabled = true;
  elements.cameraStart.textContent = "Preparing camera…";
  elements.cameraMessage.textContent = "Your browser may ask for camera permission. Images never leave this device.";
  setRegistrationCopy();
  try {
    await Promise.all([requestCamera(), tracker.initialize()]);
    showPanel(elements.registration, "registering");
    tracker.start();
    elements.statusLive.textContent = "Camera ready. Raise your hands to register.";
  } catch (error) {
    stopCamera();
    showPanel(elements.setup, "setup");
    elements.cameraMessage.textContent = `${error.message || "The camera could not start."} You can still try solo mode with the keyboard.`;
    elements.keyboardStart.focus({ preventScroll: true });
  } finally {
    elements.cameraStart.disabled = false;
    elements.cameraStart.textContent = "Continue with camera";
  }
}

function lockPlayerSlots(hands) {
  if (state.playMode !== "pvp") return;
  state.playerSlots = visibleHandEntries(hands).slice(0, 2).map(({ index }) => index);
}

function handleRegistration(hands) {
  const visibleEntries = visibleHandEntries(hands);
  const needed = getRequiredHandCount(state.playMode);
  const ready = visibleEntries.length >= needed;
  if (!ready) {
    if (state.phase === "countdown") {
      cancelRegistrationCountdown();
      state.phase = "registering";
      state.playerSlots = [];
      elements.statusLive.textContent = "Countdown reset. Keep your hands in view.";
    }
    const missing = needed - visibleEntries.length;
    elements.registrationStatus.classList.remove("is-ready");
    elements.registrationStatusText.textContent = state.playMode === "pvp"
      ? `${missing === 2 ? "Two hands" : "One more hand"} needed`
      : "Raise a hand to continue";
    return;
  }

  elements.registrationStatus.classList.add("is-ready");
  elements.registrationStatusText.textContent = state.playMode === "pvp" ? "Both players registered" : "Hands registered";
  if (state.phase === "registering") {
    lockPlayerSlots(hands);
    startRegistrationCountdown();
  }
}

function startRegistrationCountdown() {
  state.phase = "countdown";
  state.countdownEndsAt = performance.now() + REGISTRATION_COUNTDOWN_MS;
  elements.countdownBadge.hidden = false;
  elements.statusLive.textContent = "Hands registered. Starting in three seconds.";
  cancelAnimationFrame(state.countdownAnimationId);
  state.countdownAnimationId = requestAnimationFrame(updateRegistrationCountdown);
}

function updateRegistrationCountdown(now) {
  if (state.phase !== "countdown") return;
  const remaining = Math.max(0, state.countdownEndsAt - now);
  elements.countdownValue.textContent = Math.max(1, Math.ceil(remaining / 1000));
  if (remaining <= 0) {
    elements.countdownBadge.hidden = true;
    startSession("camera");
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
  renderCursors(elements.registrationCursors);
  showPanel(elements.setup, "setup");
  elements.cameraMessage.textContent = "";
  elements.cameraStart.focus({ preventScroll: true });
}

function startSession(inputMode) {
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
  state.lastSpawn = state.startedAt - getPaceConfig(state.pace).spawnInterval * 0.55;
  state.objects = [];
  if (inputMode === "keyboard") {
    state.playMode = "solo";
    state.players = [{ x: 0.5, y: 0.72, radius: 44, ownerIndex: 0 }];
  }

  elements.targets.replaceChildren();
  showPanel(elements.play, "playing");
  elements.video.hidden = inputMode !== "camera";
  elements.trackingStatus.hidden = inputMode !== "camera";
  elements.board.classList.toggle("keyboard-mode", inputMode === "keyboard");
  elements.board.classList.toggle("pvp-mode", state.playMode === "pvp");
  elements.playerTwoScoreCard.hidden = state.playMode !== "pvp";
  updateTrackingStatus(state.players.filter(Boolean).length);
  elements.inputHint.textContent = inputMode === "camera"
    ? state.playMode === "pvp"
      ? "Player 1 is teal · Player 2 is pink. Catch shapes before your neighbour does."
      : "Your palms control the circles. Catch garden shapes and avoid hazards."
    : "Use the arrow keys or W A S D. Catch garden shapes and avoid hazards.";
  elements.pause.textContent = "Pause";
  elements.pauseOverlay.hidden = true;
  updateStats();
  renderCursors(elements.cursors);
  elements.board.focus({ preventScroll: true });
  elements.statusLive.textContent = state.playMode === "pvp" ? "Two-player challenge started." : "Session started.";
  cancelAnimationFrame(state.animationId);
  state.animationId = requestAnimationFrame(gameLoop);
}

function spawnObject(now) {
  const config = getPaceConfig(state.pace);
  if (state.objects.length >= config.maxObjects || now - state.lastSpawn < config.spawnInterval) return;

  const type = randomObjectType();
  const object = {
    id: `${now}-${Math.random()}`,
    type,
    x: 0.1 + Math.random() * 0.8,
    y: -0.08,
    radius: 30,
    drift: (Math.random() - 0.5) * 0.025,
    phase: Math.random() * Math.PI * 2,
  };
  const node = document.createElement("div");
  node.className = `falling-object ${type.kind}`;
  node.textContent = type.symbol;
  node.dataset.id = object.id;
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", type.label);
  object.node = node;
  state.objects.push(object);
  elements.targets.append(node);
  state.lastSpawn = now;
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

  const deltaSeconds = Math.min((now - state.lastFrame) / 1000, 0.05);
  state.lastFrame = now;
  state.remainingSeconds = state.durationSeconds - (now - state.startedAt - state.pausedDuration) / 1000;
  if (state.remainingSeconds <= 0) {
    endSession("time");
    return;
  }

  updateKeyboard(deltaSeconds);
  spawnObject(now);
  updateObjects(deltaSeconds, now);
  updateStats();
  renderCursors(elements.cursors);
  state.animationId = requestAnimationFrame(gameLoop);
}

function closestCollidingPlayer(objectPosition, players) {
  let closest = null;
  players.forEach((player) => {
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
    const displayX = clamp(object.x + sway, 0.05, 0.95);
    object.node.style.transform = `translate(${displayX * boardWidth}px, ${object.y * boardHeight}px)`;
    const objectPosition = { x: displayX * boardWidth, y: object.y * boardHeight, radius: object.radius };
    const ownerIndex = closestCollidingPlayer(objectPosition, boardPlayers);
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

  if (object.type.hazard) {
    elements.board.classList.remove("hazard-flash");
    void elements.board.offsetWidth;
    elements.board.classList.add("hazard-flash");
    setTimeout(() => elements.board.classList.remove("hazard-flash"), 300);
    const pointsLost = Math.abs(result.delta);
    elements.statusLive.textContent = `${playerName} hit a ${object.type.label}. ${pointsLost ? `${pointsLost} points lost. ` : ""}Streak reset.`;
    return;
  }

  current.caught += 1;
  state.caught += 1;
  elements.statusLive.textContent = `${playerName} caught a ${object.type.label} for ${result.delta} points.`;
}

function missObject(object) {
  removeObject(object);
  state.missed += 1;
  if (state.missed >= getPaceConfig(state.pace).missLimit) endSession("misses");
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

function streakLabel(stats) {
  if (!stats.streak) return "Ready";
  return stats.multiplier > 1 ? `${stats.streak} streak · ×${stats.multiplier}` : `${stats.streak} streak`;
}

function updateStats() {
  const config = getPaceConfig(state.pace);
  elements.playerOneScore.textContent = state.playerStats[0].score;
  elements.playerOneStreak.textContent = streakLabel(state.playerStats[0]);
  elements.playerTwoScore.textContent = state.playerStats[1].score;
  elements.playerTwoStreak.textContent = streakLabel(state.playerStats[1]);
  elements.caught.textContent = state.caught;
  elements.missed.textContent = state.missed;
  elements.missLimit.textContent = config.missLimit;
  elements.time.textContent = formatTime(state.remainingSeconds);
}

function togglePause() {
  if (!state.running) return;
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
  if (state.inputMode === "camera") stopCamera();
  state.objects.forEach((object) => object.node.remove());
  state.objects = [];
  state.players = [];
  renderCursors(elements.cursors);

  showPanel(elements.results, "results");
  const scores = state.playerStats.map((player) => player.score);
  const matchResult = getMatchResult(scores[0], scores[1], state.playMode);
  elements.resultsTitle.textContent = matchResult.title;
  elements.resultMessage.textContent = reason === "misses"
    ? `${state.caught} shapes caught. Time for a gentle rest.`
    : matchResult.message;
  elements.finalPlayerOneLabel.textContent = state.playMode === "pvp" ? "Player 1" : "Score";
  elements.finalPlayerOneScore.textContent = scores[0];
  elements.finalPlayerTwoCard.hidden = state.playMode !== "pvp";
  elements.finalPlayerTwoScore.textContent = scores[1];
  elements.finalCaught.textContent = state.caught;
  elements.statusLive.textContent = `Session complete. ${matchResult.title}`;
  elements.playAgain.focus({ preventScroll: true });
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
elements.cameraStart.addEventListener("click", startWithCamera);
elements.keyboardStart.addEventListener("click", () => startSession("keyboard"));
elements.cancelRegistration.addEventListener("click", cancelRegistration);
elements.pause.addEventListener("click", togglePause);
elements.end.addEventListener("click", () => endSession("ended"));
elements.playAgain.addEventListener("click", resetToSetup);
elements.backHome.addEventListener("click", resetToWelcome);
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", (event) => state.keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => state.keys.clear());
window.addEventListener("beforeunload", () => {
  stopCamera();
  tracker.dispose();
});

if (import.meta.env.DEV) {
  window.__gentleCatch = {
    getState: () => ({ phase: state.phase, playMode: state.playMode, running: state.running }),
    simulateHands: (hands) => tracker.onHands(hands),
  };
  const preview = new URLSearchParams(window.location.search).get("preview");
  if (preview === "pvp-registration") {
    document.querySelector('input[name="playMode"][value="pvp"]').checked = true;
    configureFromSetup();
    state.inputMode = "camera";
    state.players = [
      { x: 0.3, y: 0.55, radius: 44, ownerIndex: 0 },
      { x: 0.7, y: 0.55, radius: 44, ownerIndex: 1 },
    ];
    setRegistrationCopy();
    showPanel(elements.registration, "countdown");
    elements.registrationStatus.classList.add("is-ready");
    elements.registrationStatusText.textContent = "Both players registered";
    elements.countdownBadge.hidden = false;
    renderCursors(elements.registrationCursors);
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
    showPanel(elements.play, "playing");
    elements.video.hidden = true;
    elements.trackingStatus.hidden = false;
    elements.board.classList.add("keyboard-mode", "pvp-mode");
    elements.playerTwoScoreCard.hidden = false;
    elements.inputHint.textContent = "Player 1 is teal · Player 2 is pink. Catch shapes before your neighbour does.";
    updateTrackingStatus(2);
    updateStats();
    renderCursors(elements.cursors);
  }
}
