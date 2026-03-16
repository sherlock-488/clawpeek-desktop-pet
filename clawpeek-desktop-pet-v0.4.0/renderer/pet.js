import { createStore } from '../src/core/store.js';
import { createClient } from '../src/bridge/gateway-client.js';
import { debugLabelForEvent, debugLabelForState } from '../src/core/debug-text.js';
import { derivePetViewModel } from '../src/pet/visual-state.js';

const api = window.desktopPetAPI;

const root = document.getElementById('pet-root');
const petButton = document.getElementById('pet-button');
const overlayIcon = document.getElementById('overlay-icon');
const overlayText = document.getElementById('overlay-text');

const DRAG_THRESHOLD_PX = 6;
const DRAG_CLICK_SUPPRESS_MS = 260;

let ticker = null;
let activeClient = null;
let shutdownRequested = false;
let suppressClickUntil = 0;
let pointerState = {
  active: false,
  dragging: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  lastScreenX: 0,
  lastScreenY: 0,
};

const bootstrap = await api.getBootstrapConfig();

const store = createStore({
  settings: {
    mainSessionKey: bootstrap.mainSessionKey,
  },
});

let lastLoggedDerivedKey = '';

function debugLog(scope, payload) {
  try {
    api.debugLog?.(scope, payload);
  } catch {
    // Ignore debug logging failures.
  }
}

function dispatch(event) {
  const nextState = store.dispatch(event);
  api.sendStateSnapshot(nextState);

  if (event.type !== 'TICK') {
    debugLog('pet-dispatch', {
      eventType: event.type,
      sessionKey: event.sessionKey || '',
      runId: event.runId || '',
      activityKind: event.activityKind || '',
      label: debugLabelForEvent(event),
      detail: event.detail || '',
      derivedPhase: nextState?.derived?.phase || '',
      derivedActivity: nextState?.derived?.activityKind || '',
      derivedLabel: debugLabelForState(nextState?.derived),
    });
  }

  return nextState;
}

function renderPet(state) {
  const view = derivePetViewModel(state);
  root.dataset.phase = view.phase;
  root.dataset.activity = view.activity;
  root.classList.toggle('show-overlay', view.showOverlay);
  root.classList.toggle('is-dragging', pointerState.dragging);
  petButton.title = `${view.title}（拖动移动，点击打开龙虾控制面板）`;
  petButton.setAttribute('aria-label', petButton.title);

  overlayIcon.textContent = view.overlayIcon;
  overlayText.textContent = view.overlayText;

  const derivedKey = [
    state?.derived?.sessionKey || '',
    view.phase,
    view.activity,
    state?.derived?.label || '',
  ].join('|');

  if (derivedKey !== lastLoggedDerivedKey) {
    lastLoggedDerivedKey = derivedKey;
    debugLog('pet-render', {
      sessionKey: state?.derived?.sessionKey || '',
      phase: view.phase,
      activity: view.activity,
      label: debugLabelForState(state?.derived),
      connection: state?.connection || '',
    });
  }
}

store.subscribe(renderPet);

function startTicker() {
  if (ticker) return;
  ticker = window.setInterval(() => {
    dispatch({ type: 'TICK', ts: Date.now() });
  }, 1000);
}

function stopTicker() {
  if (!ticker) return;
  clearInterval(ticker);
  ticker = null;
}

async function disconnect() {
  stopTicker();
  if (activeClient) {
    await activeClient.disconnect();
    activeClient = null;
  }
}

async function connect() {
  await disconnect();

  activeClient = createClient({
    mainSessionKey: bootstrap.mainSessionKey,
  });

  activeClient.onStatus((event) => {
    dispatch(event);
  });

  activeClient.onEvent((event) => {
    dispatch(event);
  });

  startTicker();

  try {
    await activeClient.connect();
  } catch (error) {
    dispatch({
      type: 'SYSTEM_ERROR',
      ts: Date.now(),
      label: '连接失败',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function openLobsterControlPanel() {
  api.openDashboard();
}

function suppressClicks(delayMs = DRAG_CLICK_SUPPRESS_MS) {
  suppressClickUntil = Date.now() + delayMs;
}

function shouldIgnoreClick() {
  return Date.now() < suppressClickUntil;
}

function resetPointerState() {
  pointerState.active = false;
  pointerState.dragging = false;
  pointerState.pointerId = null;
  root.classList.remove('is-dragging');
}

petButton.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;

  pointerState = {
    active: true,
    dragging: false,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastScreenX: event.screenX,
    lastScreenY: event.screenY,
  };

  petButton.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

window.addEventListener('pointermove', (event) => {
  if (!pointerState.active || event.pointerId !== pointerState.pointerId) return;

  const movedX = event.clientX - pointerState.startX;
  const movedY = event.clientY - pointerState.startY;
  const movedDistance = Math.hypot(movedX, movedY);

  if (!pointerState.dragging && movedDistance >= DRAG_THRESHOLD_PX) {
    pointerState.dragging = true;
    root.classList.add('is-dragging');
  }

  if (!pointerState.dragging) return;

  const deltaX = event.screenX - pointerState.lastScreenX;
  const deltaY = event.screenY - pointerState.lastScreenY;
  if (deltaX || deltaY) {
    api.movePetBy(deltaX, deltaY);
    pointerState.lastScreenX = event.screenX;
    pointerState.lastScreenY = event.screenY;
  }
});

window.addEventListener('pointerup', (event) => {
  if (!pointerState.active || event.pointerId !== pointerState.pointerId) return;

  const dragged = pointerState.dragging;
  resetPointerState();

  if (dragged) {
    suppressClicks();
  }
});

window.addEventListener('pointercancel', () => {
  if (pointerState.dragging) {
    suppressClicks();
  }
  resetPointerState();
});

petButton.addEventListener('dragstart', (event) => {
  event.preventDefault();
});

petButton.addEventListener('click', (event) => {
  event.preventDefault();
  if (shouldIgnoreClick()) return;
  openLobsterControlPanel();
});

petButton.addEventListener('dblclick', (event) => {
  event.preventDefault();
});

window.addEventListener('beforeunload', async () => {
  shutdownRequested = true;
  await disconnect();
});

dispatch({
  type: 'SYSTEM_DISCONNECTED',
  ts: Date.now(),
  label: '准备连接 Gateway',
  detail: `${bootstrap.gatewayUrl} · 认证来源：${bootstrap.gatewayAuthSource || 'unknown'}`,
});

if (!shutdownRequested) {
  await connect();
}
