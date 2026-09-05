/**
 * Orquestador de la aplicación: estado global, bucle de render y cableado
 * entre módulos. Ningún otro archivo toca el estado directamente.
 */

import { View, clamp, damp } from './view.js';
import { MathEngine } from './mathEngine.js';
import { GraphRenderer } from './graphRenderer.js';
import { ParticleRenderer } from './particleRenderer.js';
import { GestureController, MODE_BY_FINGERS, spreadToH, palmToX0 } from './gestureController.js';
import { CameraManager, CAMERA_STATE } from './cameraManager.js';
import { UiController } from './uiController.js';
import { AudioFx } from './audioFx.js';
import { AiExplainer } from './aiExplainer.js';
import { explainFor } from './explanations.js';

// ── Estado ────────────────────────────────────────────────────────────────────

const state = {
  engine: new MathEngine(),
  mode: 'particles',
  x0: 2,
  h: 1,
  analysis: null,
  handControlsX0: true,
  handControlsH: true,
  handPresent: false,
  started: false,
};

const view = new View();
let graph, particles, gestures, camera, ui, audio, ai;

// Marcas de trabajo diferido
let dirtyParticles = true;
let dirtyAnalysis = true;
let lastViewSignature = '';
let particleRebuildAt = 0;
let uiUpdateAt = 0;
let analysisAt = 0;
let aiAbort = null;

// Objetivos suavizados provenientes de la mano
let targetX0 = state.x0;
let targetLogH = Math.log10(state.h);
let targetSpan = null;

// Calidad adaptativa
const perf = { frames: 0, elapsed: 0, level: 1, lastChange: 0 };
const QUALITY_LEVELS = [20000, 13000, 8000, 4500];

// ── Arranque ──────────────────────────────────────────────────────────────────

function boot() {
  ui = new UiController({
    onValidate: handleValidate,
    onStart: handleStart,
    onChangeFunction: handleChangeFunction,
    onModeChange: (mode, fingers) => setMode(mode, fingers, true),
    onX0Change: handleX0Slider,
    onHChange: handleHSlider,
    onToggleLock: handleToggleLock,
    onToggleCamera: handleToggleCamera,
    onToggleSound: handleToggleSound,
    onViewAction: handleViewAction,
    onAiExplain: handleAiExplain,
    onAiSaveEndpoint: handleAiSaveEndpoint,
  });

  const missing = [];
  if (!window.math) missing.push('math.js (motor matemático)');
  if (!window.THREE) missing.push('Three.js (partículas)');
  if (missing.length) {
    ui.fatal('No se pudieron cargar las librerías',
      `Faltan: ${missing.join(', ')}. Revisá tu conexión a internet y recargá la página. `
      + 'Si estás detrás de un firewall corporativo, puede estar bloqueando los CDN.');
    return;
  }

  audio = new AudioFx();
  ai = new AiExplainer();
  ui.setSoundEnabled(audio.enabled);

  resize();
  graph = new GraphRenderer(document.getElementById('graph-canvas'), view);
  particles = new ParticleRenderer(document.getElementById('particle-canvas'), view);
  if (!particles.ok) {
    ui.toast('Tu navegador no pudo iniciar WebGL: las partículas quedan desactivadas, pero la gráfica y los cálculos funcionan.', 'error', 7000);
  }
  graph.resize();
  particles.resize();

  gestures = new GestureController();
  gestures.onCommit = handleGestureCommit;

  camera = new CameraManager(document.getElementById('video'), document.getElementById('preview'));
  camera.onResults = handleHandResults;
  camera.onStateChange = handleCameraState;

  bindViewportInteraction();
  window.addEventListener('resize', onResize);

  if (!window.katex) {
    ui.toast('KaTeX no se pudo cargar: las fórmulas se muestran en texto plano.', '', 5200);
  }

  // Punto de inspección para depurar (sólo con ?debug=1 en la URL)
  if (new URLSearchParams(location.search).has('debug')) {
    window.mphDebug = {
      state, view,
      get graph() { return graph; },
      get particles() { return particles; },
      get gestures() { return gestures; },
      get flags() { return { dirtyParticles, dirtyAnalysis, particleRebuildAt, lastViewSignature, sigNow: view.signature() }; },
      // Ejecuta frames a mano: permite probar el render sin depender de que
      // requestAnimationFrame esté activo (se pausa en pestañas ocultas).
      step(n = 1, dt = 1 / 60) {
        let t = performance.now();
        for (let k = 0; k < n; k++) { t += dt * 1000; frame(dt, t); }
        return { frames: n, mode: state.mode };
      },
    };
  }

  ui.showStartScreen('x^3 - 4x', 2);
  requestAnimationFrame(loop);
}

// ── Pantalla inicial ──────────────────────────────────────────────────────────

/** Validación en vivo con un motor descartable (no toca el estado). */
function handleValidate(raw) {
  const probe = new MathEngine();
  const r = probe.setExpression(raw);
  return r.ok
    ? { ok: true, tex: probe.tex, plain: probe.plain, note: r.note }
    : { ok: false, error: r.error, hint: r.hint };
}

function handleStart({ fn, x0, withCamera }) {
  const result = state.engine.setExpression(fn);
  if (!result.ok) {
    ui.toast(result.error, 'error');
    audio.error();
    return;
  }

  const parsedX0 = parseNumber(x0);
  state.x0 = Number.isFinite(parsedX0) ? parsedX0 : 0;
  targetX0 = state.x0;

  audio.resume();
  audio.functionSet();

  state.started = true;
  ui.hideStartScreen();
  ui.showApp();
  ui.setFunctionDisplay(state.engine);
  ui.invalidatePanel();
  if (result.note) ui.toast(result.note, '', 5000);

  autoFit();
  setMode('particles', 0, false, true);
  invalidateAll();

  if (withCamera) {
    startCamera();
  } else {
    ui.setIndicator('camera', '', 'Cámara: apagada');
    ui.setIndicator('hands', '', 'Manos: sin cámara');
    ui.toast('Modo sin cámara: usá los botones de la izquierda o las teclas 0–5 para cambiar de modo.', '', 6500);
  }
  updateLockUi();
}

function handleChangeFunction() {
  ui.showStartScreen(state.engine.source || state.engine.plain, state.x0);
}

// ── Cámara ────────────────────────────────────────────────────────────────────

async function startCamera() {
  ui.setPreviewVisible(true);
  const ok = await camera.start();
  if (ok) {
    audio.cameraOn();
    ui.showTutorial();
    setTimeout(() => { if (ui.isTutorialVisible()) ui.hideTutorial(); }, 9000);
  }
}

function handleToggleCamera() {
  if (camera.state === CAMERA_STATE.ON) {
    camera.stop();
    ui.setPreviewVisible(false);
    state.handPresent = false;
    ui.updateGestureBadge({ present: false });
  } else {
    audio.resume();
    startCamera();
  }
}

function handleCameraState(cameraState, message) {
  ui.setCameraButton(cameraState);
  switch (cameraState) {
    case CAMERA_STATE.ON:
      ui.setIndicator('camera', 'on', 'Cámara: activa');
      ui.setIndicator('hands', 'warn', 'Manos: buscando…');
      break;
    case CAMERA_STATE.STARTING:
      ui.setIndicator('camera', 'warn', 'Cámara: iniciando…');
      break;
    case CAMERA_STATE.ERROR:
      ui.setIndicator('camera', 'error', 'Cámara: error');
      ui.setIndicator('hands', '', 'Manos: sin cámara');
      ui.setPreviewVisible(false);
      ui.toast(`${message} Podés seguir usando la app con los botones de modo.`, 'error', 8000);
      audio.error();
      break;
    default:
      ui.setIndicator('camera', '', 'Cámara: apagada');
      ui.setIndicator('hands', '', 'Manos: sin detectar');
      ui.setPreviewVisible(false);
  }
}

function handleHandResults(results) {
  gestures.update(results.multiHandLandmarks, results.multiHandedness, performance.now());
  state.handPresent = gestures.present;

  if (!gestures.present) {
    ui.setIndicator('hands', 'warn', 'Manos: sin detectar');
    particles?.setPush(false);
    return;
  }
  ui.setIndicator('hands', 'on', gestures.hands.secondary ? 'Manos: 2 detectadas' : 'Manos: 1 detectada');

  // x₀ desde la posición horizontal de la palma
  if (state.handControlsX0 && state.mode !== 'particles') {
    targetX0 = palmToX0(gestures.palm.x, view);
  }

  // h desde la separación índice–medio
  if (state.handControlsH && state.mode === 'quotient') {
    targetLogH = Math.log10(spreadToH(gestures.spread));
  }

  // Zoom con el pellizco de la segunda mano
  if (gestures.pinch !== null) {
    const t = clamp((gestures.pinch - 0.15) / 1.15, 0, 1);
    targetSpan = Math.pow(10, Math.log10(6) + t * (Math.log10(48) - Math.log10(6)));
  } else {
    targetSpan = null;
  }

  // Puño: empuje de partículas en coordenadas del mundo
  const fist = gestures.committed === 0;
  if (fist && particles?.ok) {
    const wx = view.xMin + gestures.palm.x * view.spanX;
    const wy = view.yMax - gestures.palm.y * view.spanY;
    particles.setPush(true, wx, wy);
    maybeRipple(wx, wy);
  } else {
    particles?.setPush(false);
  }
}

let lastRippleAt = 0;
let lastRipplePos = { x: 0, y: 0 };
function maybeRipple(wx, wy) {
  const now = performance.now();
  const moved = Math.hypot(wx - lastRipplePos.x, wy - lastRipplePos.y);
  if (now - lastRippleAt > 380 && moved > view.spanX * 0.04) {
    particles.addRipple(wx, wy);
    lastRippleAt = now;
    lastRipplePos = { x: wx, y: wy };
  }
}

function handleGestureCommit(fingers) {
  const mode = MODE_BY_FINGERS[fingers] ?? 'particles';
  setMode(mode, fingers, false);
  audio.modeChange(fingers);
}

// ── Modos ─────────────────────────────────────────────────────────────────────

function setMode(mode, fingers, fromUser, force = false) {
  if (!state.started) return;
  if (state.mode === mode && !force) return;
  state.mode = mode;

  ui.setActiveMode(mode);
  if (ui.needsRebuild(mode)) ui.buildMathPanel(state);
  ui.clearAiResult();
  refreshExplanation();

  if (mode === 'analysis') dirtyAnalysis = true;
  dirtyParticles = true;

  if (particles?.ok) particles.targetRotation = mode === 'particles' ? particles.rotation : 0;
  if (graph) {
    graph.opacity = mode === 'particles' ? 0.42 : 1;
    graph.showAxes = true;
  }
  if (fromUser) {
    audio.resume();
    audio.modeChange(fingers ?? 0);
  }
}

// ── Controles manuales ────────────────────────────────────────────────────────

function handleX0Slider(t) {
  state.handControlsX0 = false;
  targetX0 = view.xMin + t * (view.xMax - view.xMin);
  state.x0 = targetX0;
  updateLockUi();
  refreshExplanation();
}

function handleHSlider(h) {
  state.handControlsH = false;
  targetLogH = Math.log10(h);
  state.h = h;
  updateLockUi();
  refreshExplanation();
}

function handleToggleLock(which) {
  if (which === 'x0') state.handControlsX0 = !state.handControlsX0;
  else state.handControlsH = !state.handControlsH;
  updateLockUi();
}

function updateLockUi() {
  const on = camera?.state === CAMERA_STATE.ON;
  ui.setLockState('x0', state.handControlsX0, on);
  ui.setLockState('h', state.handControlsH, on);
}

function handleToggleSound() {
  audio.setEnabled(!audio.enabled);
  ui.setSoundEnabled(audio.enabled);
  if (audio.enabled) { audio.resume(); audio.computed(); }
}

function handleViewAction(action) {
  if (action === 'fit') autoFit();
  else view.zoomAt(view.width / 2, view.height / 2, action === 'in' ? 1 / 1.35 : 1.35);
  invalidateView();
}

// ── IA ────────────────────────────────────────────────────────────────────────

async function handleAiExplain() {
  if (!ai.configured) {
    ui.showAiDialog(ai.endpoint);
    return;
  }
  aiAbort?.abort();
  aiAbort = new AbortController();
  ui.setAiLoading(true);
  if (state.mode === 'analysis') ensureAnalysis(true);

  const result = await ai.explain(state, { signal: aiAbort.signal });
  ui.setAiLoading(false);
  if (result.ok) {
    ui.setAiResult(result.text);
    audio.computed();
  } else if (result.error !== 'cancelled') {
    ui.setAiResult(`${result.error} La explicación determinista de arriba sigue siendo válida.`, true);
  }
}

function handleAiSaveEndpoint(url) {
  const r = ai.setEndpoint(url);
  if (!r.ok) { ui.setAiDialogMessage(r.error, 'error'); return; }
  if (ai.configured) {
    ui.setAiDialogMessage('Endpoint guardado. Ya podés usar «Explicar con IA».', 'ok');
    setTimeout(() => ui.hideAiDialog(), 1100);
  } else {
    ui.setAiDialogMessage('Endpoint quitado. La app sigue funcionando con las explicaciones deterministas.', 'info');
  }
}

// ── Vista ─────────────────────────────────────────────────────────────────────

/**
 * Encuadre por defecto: x ∈ [−10, 10] centrado en 0, que es lo que espera
 * cualquier estudiante. Sólo se desplaza el eje Y si la curva quedaría fuera
 * de pantalla (por ejemplo f(x) = x² + 1000).
 */
function autoFit() {
  const engine = state.engine;
  if (!engine.ready) return;

  view.spanX = 20;
  view.cx = Math.abs(state.x0) > 8 ? state.x0 : 0;
  view.cy = 0;

  const s = engine.sample('f', view.xMin, view.xMax, 400);
  const finite = [];
  for (let i = 0; i < s.n; i++) if (Number.isFinite(s.ys[i])) finite.push(s.ys[i]);
  if (finite.length) {
    const half = view.spanY / 2;
    const visible = finite.filter((y) => Math.abs(y) <= half).length;
    if (visible / finite.length < 0.15) {
      finite.sort((a, b) => a - b);
      view.cy = finite[Math.floor(finite.length / 2)];
    }
  }
  view.version++;
  invalidateView();
}

function bindViewportInteraction() {
  const isUi = (target) => !!target?.closest?.('.glass, #start-screen, #tutorial, #ai-dialog, button, input');

  document.addEventListener('wheel', (ev) => {
    if (!state.started || isUi(ev.target)) return;
    ev.preventDefault();
    view.zoomAt(ev.clientX, ev.clientY, ev.deltaY > 0 ? 1.12 : 1 / 1.12);
    invalidateView();
  }, { passive: false });

  let dragging = false, lastX = 0, lastY = 0;
  document.addEventListener('pointerdown', (ev) => {
    if (!state.started || isUi(ev.target) || ev.button !== 0) return;
    dragging = true; lastX = ev.clientX; lastY = ev.clientY;
    document.body.style.cursor = 'grabbing';
  });
  document.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    view.panByPixels(ev.clientX - lastX, ev.clientY - lastY);
    lastX = ev.clientX; lastY = ev.clientY;
    invalidateView();
  });
  const endDrag = () => { dragging = false; document.body.style.cursor = ''; };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  // Pellizco táctil
  let pinchStart = null;
  document.addEventListener('touchstart', (ev) => {
    if (ev.touches.length === 2 && !isUi(ev.target)) {
      pinchStart = { d: touchDistance(ev), span: view.spanX };
    }
  }, { passive: true });
  document.addEventListener('touchmove', (ev) => {
    if (ev.touches.length === 2 && pinchStart) {
      ev.preventDefault();
      const d = touchDistance(ev);
      if (d > 0) { view.setSpan(pinchStart.span * (pinchStart.d / d)); invalidateView(); }
    }
  }, { passive: false });
  document.addEventListener('touchend', () => { pinchStart = null; }, { passive: true });
}

function touchDistance(ev) {
  const [a, b] = ev.touches;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function onResize() { resize(); graph?.resize(); particles?.resize(); invalidateView(); }

function resize() { view.resize(window.innerWidth, window.innerHeight); }

function invalidateView() { dirtyParticles = true; dirtyAnalysis = true; }
function invalidateAll() { invalidateView(); }

// ── Análisis ──────────────────────────────────────────────────────────────────

/**
 * El análisis completo cuesta ~6 ms (muestreo de 2400 puntos + búsqueda de
 * raíces). Se limita su frecuencia para que arrastrar o hacer zoom no lo
 * dispare en cada frame; mientras tanto se sigue mostrando el último resultado.
 * `force` lo recalcula al instante (por ejemplo antes de consultar a la IA).
 */
function ensureAnalysis(force = false) {
  if (!state.engine.ready) return;
  if (!dirtyAnalysis && state.analysis) return;
  const now = performance.now();
  if (!force && state.analysis && now - analysisAt < 220) return;
  state.analysis = state.engine.analyze(view.xMin, view.xMax);
  analysisAt = now;
  dirtyAnalysis = false;
}

function refreshExplanation() {
  if (!state.started) return;
  if (state.mode === 'analysis') ensureAnalysis();
  ui.setExplanation(explainFor(state.mode, state));
}

// ── Bucle principal ───────────────────────────────────────────────────────────

let lastTime = performance.now();

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastTime) / 1000) || 0.016;
  lastTime = now;
  frame(dt, now);
}

// Al volver de una pestaña en segundo plano, requestAnimationFrame estuvo
// pausado: se reinicia el reloj para que el primer dt no sea un salto enorme.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lastTime = performance.now();
});

function frame(dt, now) {
  if (!state.started) return;

  updateDynamicState(dt);
  trackPerformance(dt, now);

  // Reconstrucción de partículas: como máximo cada 110 ms
  const sig = view.signature();
  if (sig !== lastViewSignature) { lastViewSignature = sig; dirtyParticles = true; dirtyAnalysis = true; }
  if (dirtyParticles && now - particleRebuildAt > 110 && particles?.ok) {
    particles.rebuild(state);
    particleRebuildAt = now;
    dirtyParticles = false;
  }

  if (state.mode === 'analysis') ensureAnalysis();

  if (particles?.ok) {
    particles.updateDynamic(state, dt);
    if (state.mode === 'particles') particles.targetRotation += dt * 0.28;
    particles.render(dt);
  }
  graph.draw(state);

  // Texto de la interfaz a ~18 Hz: suficiente y mucho más barato que 60 Hz
  if (now - uiUpdateAt > 55) {
    uiUpdateAt = now;
    ui.updateMathValues(state);
    ui.syncSliders(state, view);
    if (state.handPresent) {
      ui.updateGestureBadge({
        present: true,
        fingers: gestures.raw ?? gestures.committed,
        holdProgress: gestures.holdProgress,
        mode: MODE_BY_FINGERS[gestures.candidate ?? gestures.committed] ?? state.mode,
      });
    } else {
      ui.updateGestureBadge({ present: false });
    }
  }
}

/** Suaviza x₀, h y el zoom hacia sus objetivos (independiente del framerate). */
function updateDynamicState(dt) {
  const prevX0 = state.x0;
  const prevH = state.h;

  state.x0 = damp(state.x0, clamp(targetX0, view.xMin - view.spanX, view.xMax + view.spanX), 11, dt);
  const logH = damp(Math.log10(state.h), targetLogH, 9, dt);
  state.h = Math.pow(10, logH);

  if (targetSpan !== null) {
    const next = damp(view.spanX, targetSpan, 4, dt);
    if (Math.abs(next - view.spanX) > view.spanX * 0.002) { view.setSpan(next); }
  }

  // La explicación depende de los valores: refrescarla cuando cambian de veras
  if (Math.abs(state.x0 - prevX0) > view.spanX * 0.004 || Math.abs(state.h - prevH) > prevH * 0.02) {
    if (!refreshExplanation.queued) {
      refreshExplanation.queued = true;
      setTimeout(() => { refreshExplanation.queued = false; refreshExplanation(); }, 220);
    }
  }
}

/** Baja la cantidad de partículas si el equipo no sostiene 60 fps. */
function trackPerformance(dt, now) {
  if (!particles?.ok) return;
  perf.frames++;
  perf.elapsed += dt;
  if (perf.elapsed < 1.2) return;

  const fps = perf.frames / perf.elapsed;
  perf.frames = 0;
  perf.elapsed = 0;
  if (now - perf.lastChange < 2600) return;

  if (fps < 42 && perf.level < QUALITY_LEVELS.length - 1) {
    perf.level++;
    particles.setQuality(QUALITY_LEVELS[perf.level]);
    perf.lastChange = now;
    dirtyParticles = true;
  } else if (fps > 57 && perf.level > 0) {
    perf.level--;
    particles.setQuality(QUALITY_LEVELS[perf.level]);
    perf.lastChange = now;
    dirtyParticles = true;
  }
}

// ── Utilidades ────────────────────────────────────────────────────────────────

/** Acepta "2", "2.5", "2,5", "-3" y expresiones simples como "pi/2". */
function parseNumber(raw) {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (!s) return NaN;
  const direct = Number(s);
  if (Number.isFinite(direct)) return direct;
  try {
    const v = window.math.evaluate(s);
    return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  } catch { return NaN; }
}

window.addEventListener('error', (ev) => {
  console.error('[Math Particle Hands]', ev.error ?? ev.message);
});

boot();
