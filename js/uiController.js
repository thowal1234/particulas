/**
 * Controlador de la interfaz: todo el acceso al DOM vive acá.
 *
 * Punto clave de rendimiento: el panel matemático se CONSTRUYE una sola vez
 * por modo y después sólo se actualizan los nodos de valor (marcados con
 * data-val). Reconstruir el HTML en cada frame rompería las animaciones y
 * dispararía el coste de layout.
 */

import { fmtNum, fmtSigned } from './mathEngine.js';
import { clamp } from './view.js';

const MODE_LABELS = {
  particles: 'Partículas',
  slope: 'Pendiente',
  quotient: 'Cociente incremental',
  derivatives: 'Derivadas',
  analysis: 'Análisis completo',
  visual: 'Visualización',
};
const MODE_EMOJI = {
  particles: '✊', slope: '☝', quotient: '✌',
  derivatives: '🤟', analysis: '🖖', visual: '✋',
};
const H_MIN = 0.01, H_MAX = 2;

const $ = (id) => document.getElementById(id);

/** Renderiza TeX con KaTeX; si la librería no cargó, muestra el texto plano. */
function tex(el, texString, fallback) {
  if (!el) return;
  if (window.katex && texString) {
    try {
      window.katex.render(texString, el, { throwOnError: false, displayMode: false, output: 'html' });
      return;
    } catch { /* cae al texto plano */ }
  }
  el.textContent = fallback ?? texString ?? '';
}

export class UiController {
  constructor(handlers = {}) {
    this.h = handlers;
    this.el = {
      startScreen: $('start-screen'),
      fnInput: $('fn-input'),
      fnPreview: $('fn-preview'),
      fnFeedback: $('fn-feedback'),
      x0Input: $('x0-input'),
      chips: $('example-chips'),
      startBtn: $('start-btn'),
      startNoCam: $('start-nocam'),

      topbar: $('topbar'),
      fnCurrent: $('fn-current'),
      indCamera: $('ind-camera'),
      indHands: $('ind-hands'),
      indMode: $('ind-mode'),
      btnChangeFn: $('btn-change-fn'),
      btnCamera: $('btn-camera'),
      btnSound: $('btn-sound'),
      btnProjector: $('btn-projector'),
      btnHelp: $('btn-help'),

      rail: $('mode-rail'),
      mathPanel: $('math-panel'),
      mpMode: $('mp-mode'),
      mpBody: $('mp-body'),
      btnCollapse: $('btn-collapse'),

      explain: $('explain-panel'),
      epTitle: $('ep-title'),
      epBody: $('ep-body'),
      btnAi: $('btn-ai'),
      aiBox: $('ai-box'),

      controls: $('controls-bar'),
      x0Slider: $('x0-slider'),
      x0Out: $('x0-out'),
      hSlider: $('h-slider'),
      hOut: $('h-out'),
      hControl: $('h-control'),
      btnLockX0: $('btn-lock-x0'),
      btnLockH: $('btn-lock-h'),
      btnFit: $('btn-fit'),
      btnZoomIn: $('btn-zoom-in'),
      btnZoomOut: $('btn-zoom-out'),

      badge: $('gesture-badge'),
      gbEmoji: $('gb-emoji'),
      gbCount: $('gb-count'),
      gbMode: $('gb-mode'),
      ringFg: $('hold-ring-fg'),

      previewWrap: $('preview-wrap'),
      tutorial: $('tutorial'),
      tutClose: $('tut-close'),

      aiDialog: $('ai-dialog'),
      aiEndpoint: $('ai-endpoint'),
      aiEndpointMsg: $('ai-endpoint-msg'),
      aiSave: $('ai-save'),
      aiClear: $('ai-clear'),
      aiClose: $('ai-close'),

      toast: $('toast'),
      fatal: $('fatal'),
    };

    this._panelMode = null;
    this._valNodes = {};
    this._animToken = 0;
    this._toastTimer = 0;
    this._draggingSlider = false;
    this._startVisible = true;

    this._bind();
  }

  // ── Enlace de eventos ───────────────────────────────────────────────────────

  _bind() {
    const e = this.el;

    e.fnInput?.addEventListener('input', () => this._previewFunction());
    e.fnInput?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); this._submitStart(true); }
    });
    e.x0Input?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); this._submitStart(true); }
    });

    e.chips?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.chip');
      if (!btn) return;
      e.fnInput.value = btn.dataset.fn;
      e.fnInput.focus();
      this._previewFunction();
    });

    e.startBtn?.addEventListener('click', () => this._submitStart(true));
    e.startNoCam?.addEventListener('click', () => this._submitStart(false));

    e.btnChangeFn?.addEventListener('click', () => this.h.onChangeFunction?.());
    e.btnCamera?.addEventListener('click', () => this.h.onToggleCamera?.());
    e.btnSound?.addEventListener('click', () => this.h.onToggleSound?.());
    e.btnProjector?.addEventListener('click', () => this.h.onToggleProjector?.());
    e.btnHelp?.addEventListener('click', () => this.showTutorial());
    e.tutClose?.addEventListener('click', () => this.hideTutorial());

    e.btnCollapse?.addEventListener('click', () => {
      const collapsed = document.body.classList.toggle('panel-collapsed');
      e.btnCollapse.textContent = collapsed ? '+' : '–';
    });

    e.rail?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.mode-btn');
      if (btn) this.h.onModeChange?.(btn.dataset.mode, Number(btn.dataset.fingers));
    });

    // Deslizadores: al usarlos, el usuario toma el control manual
    const sliderGuard = (on) => { this._draggingSlider = on; };
    e.x0Slider?.addEventListener('pointerdown', () => sliderGuard(true));
    e.hSlider?.addEventListener('pointerdown', () => sliderGuard(true));
    window.addEventListener('pointerup', () => sliderGuard(false));

    e.x0Slider?.addEventListener('input', () => {
      this.h.onX0Change?.(Number(e.x0Slider.value) / 1000, true);
    });
    e.hSlider?.addEventListener('input', () => {
      const t = Number(e.hSlider.value) / 1000;
      const h = Math.pow(10, Math.log10(H_MIN) + t * (Math.log10(H_MAX) - Math.log10(H_MIN)));
      this.h.onHChange?.(h, true);
    });

    e.btnLockX0?.addEventListener('click', () => this.h.onToggleLock?.('x0'));
    e.btnLockH?.addEventListener('click', () => this.h.onToggleLock?.('h'));
    e.btnFit?.addEventListener('click', () => this.h.onViewAction?.('fit'));
    e.btnZoomIn?.addEventListener('click', () => this.h.onViewAction?.('in'));
    e.btnZoomOut?.addEventListener('click', () => this.h.onViewAction?.('out'));

    e.btnAi?.addEventListener('click', () => this.h.onAiExplain?.());
    e.aiSave?.addEventListener('click', () => this.h.onAiSaveEndpoint?.(e.aiEndpoint.value));
    e.aiClear?.addEventListener('click', () => { e.aiEndpoint.value = ''; this.h.onAiSaveEndpoint?.(''); });
    e.aiClose?.addEventListener('click', () => this.hideAiDialog());
    e.aiDialog?.addEventListener('click', (ev) => { if (ev.target === e.aiDialog) this.hideAiDialog(); });
    e.tutorial?.addEventListener('click', (ev) => { if (ev.target === e.tutorial) this.hideTutorial(); });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (!e.aiDialog.hidden) this.hideAiDialog();
        else if (!e.tutorial.hidden) this.hideTutorial();
      }
      // Atajos numéricos para los modos (sin cámara). Se consulta la bandera y no
      // el atributo hidden, que sólo se aplica al terminar la animación de salida.
      if (this._startVisible || ev.target.tagName === 'INPUT') return;
      const n = Number(ev.key);
      if (Number.isInteger(n) && n >= 0 && n <= 5) {
        const btn = e.rail?.querySelector(`.mode-btn[data-fingers="${n}"]`);
        if (btn) this.h.onModeChange?.(btn.dataset.mode, n);
      }
    });
  }

  // ── Pantalla inicial ────────────────────────────────────────────────────────

  _previewFunction() {
    const raw = this.el.fnInput.value;
    const result = this.h.onValidate?.(raw);
    if (!result) return;

    if (result.ok) {
      this.el.fnPreview.classList.remove('invalid');
      tex(this.el.fnPreview, `f(x) = ${result.tex}`, `f(x) = ${result.plain}`);
      this.el.fnFeedback.className = 'feedback' + (result.note ? ' info' : '');
      this.el.fnFeedback.textContent = result.note ?? '';
      this.el.startBtn.disabled = false;
      this.el.startNoCam.disabled = false;
    } else {
      this.el.fnPreview.classList.add('invalid');
      this.el.fnPreview.textContent = raw.trim() ? '—' : '';
      this.el.fnFeedback.className = 'feedback error';
      this.el.fnFeedback.innerHTML = raw.trim()
        ? `${escapeHtml(result.error)}${result.hint ? `<span class="hint">${escapeHtml(result.hint)}</span>` : ''}`
        : '';
      this.el.startBtn.disabled = true;
      this.el.startNoCam.disabled = true;
    }
  }

  _submitStart(withCamera) {
    const fn = this.el.fnInput.value;
    const x0 = this.el.x0Input.value;
    this.h.onStart?.({ fn, x0, withCamera });
  }

  showStartScreen(prefillFn, prefillX0) {
    const e = this.el;
    this._startVisible = true;
    e.startScreen.hidden = false;
    e.startScreen.classList.remove('closing');
    if (prefillFn !== undefined) e.fnInput.value = prefillFn;
    if (prefillX0 !== undefined) e.x0Input.value = String(prefillX0);
    this._previewFunction();
    setTimeout(() => e.fnInput.focus(), 60);
  }

  hideStartScreen() {
    const e = this.el;
    this._startVisible = false;
    e.startScreen.classList.add('closing');
    setTimeout(() => { e.startScreen.hidden = true; }, 380);
  }

  showApp() {
    document.body.classList.remove('booting');
    for (const el of [this.el.topbar, this.el.rail, this.el.mathPanel, this.el.explain, this.el.controls]) {
      if (el) el.hidden = false;
    }
    this._trackTopbarHeight();
  }

  // ── Barra superior e indicadores ────────────────────────────────────────────

  setFunctionDisplay(engine) {
    tex(this.el.fnCurrent, `f(x) = ${engine.tex}`, `f(x) = ${engine.plain}`);
  }

  setIndicator(which, level, text) {
    const el = which === 'camera' ? this.el.indCamera
      : which === 'hands' ? this.el.indHands : this.el.indMode;
    if (!el) return;
    el.className = `ind ${level}`;
    el.querySelector('.ind-text').textContent = text;
  }

  setCameraButton(state) {
    const b = this.el.btnCamera;
    if (!b) return;
    const label = state === 'on' ? 'Apagar cámara'
      : state === 'starting' ? 'Iniciando…' : 'Activar cámara';
    // Sólo el rótulo: el icono se conserva para cuando el texto se oculta en móvil
    const lbl = b.querySelector('.lbl');
    if (lbl) lbl.textContent = label; else b.textContent = label;
    b.title = label;
    b.disabled = state === 'starting';
  }

  /**
   * Publica la altura real de la barra superior como variable CSS.
   * La barra cambia de alto al reordenarse en pantallas angostas, así que
   * fijar un valor a mano hacía que la vista de cámara se le montara encima.
   */
  _trackTopbarHeight() {
    const el = this.el.topbar;
    if (!el) return;
    let last = -1;
    this.syncChrome = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0 && h !== last) {
        last = h;
        document.documentElement.style.setProperty('--topbar-h', `${h}px`);
      }
    };
    this.syncChrome();
    if (window.ResizeObserver) new ResizeObserver(this.syncChrome).observe(el);
    window.addEventListener('resize', this.syncChrome);
    window.addEventListener('orientationchange', () => setTimeout(this.syncChrome, 200));
  }

  /** Sobrescrito por _trackTopbarHeight; no hace nada antes de mostrar la app. */
  syncChrome() {}

  setSoundEnabled(on) { document.body.classList.toggle('muted', !on); }

  /** Modo proyector: sólo cambia --fs-scale y los grises; no toca la lógica. */
  setProjector(on) {
    document.body.classList.toggle('projector', !!on);
    this.el.btnProjector?.classList.toggle('active', !!on);
    this.el.btnProjector?.setAttribute('aria-pressed', on ? 'true' : 'false');
    // La barra superior cambia de alto al reescalar la tipografía y los
    // paneles se posicionan a partir de --topbar-h: hay que republicarlo.
    this.syncChrome?.();
  }

  setPreviewVisible(on) { this.el.previewWrap.hidden = !on; }

  // ── Modos ───────────────────────────────────────────────────────────────────

  setActiveMode(mode) {
    for (const btn of this.el.rail.querySelectorAll('.mode-btn')) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    }
    document.body.classList.toggle('mode-visual', mode === 'visual');
    this.el.hControl.style.display = mode === 'quotient' ? '' : 'none';
    this.setIndicator('mode', 'on', `Modo: ${MODE_LABELS[mode] ?? mode}`);
  }

  updateGestureBadge({ present, fingers, holdProgress, mode }) {
    const b = this.el.badge;
    if (!present) { b.hidden = true; return; }
    b.hidden = false;
    this.el.gbEmoji.textContent = MODE_EMOJI[mode] ?? '✊';
    this.el.gbCount.textContent = fingers === 1 ? '1 dedo' : `${fingers} dedos`;
    this.el.gbMode.textContent = MODE_LABELS[mode] ?? mode;
    const circumference = 119.4;
    this.el.ringFg.style.strokeDashoffset = String(circumference * (1 - clamp(holdProgress, 0, 1)));
    b.classList.toggle('committing', holdProgress > 0.05);
  }

  // ── Panel matemático ────────────────────────────────────────────────────────

  /** Reconstruye la estructura del panel (sólo al cambiar de modo). */
  buildMathPanel(state) {
    const { mode, engine } = state;
    this._panelMode = mode;
    this._animToken++;
    this.el.mpMode.textContent = `Modo: ${MODE_LABELS[mode] ?? mode}`;

    const body = this.el.mpBody;
    body.innerHTML = '';
    this._valNodes = {};

    const numericNote = engine.derivativeMode === 'numeric'
      ? `<div class="note-numeric">Esta función no admite derivación simbólica (por ejemplo <code>floor</code> o <code>sign</code>). Las derivadas se calculan numéricamente con diferencias centradas: los valores son correctos pero no hay una fórmula cerrada.</div>`
      : '';

    switch (mode) {
      case 'slope': body.innerHTML = this._slopePanel(state) + numericNote; break;
      case 'quotient': body.innerHTML = this._quotientPanel(state) + numericNote; break;
      case 'derivatives': body.innerHTML = this._derivativesPanel(state) + numericNote; break;
      case 'analysis': body.innerHTML = this._analysisPanel(state) + numericNote; break;
      case 'visual': body.innerHTML = this._visualPanel(state); break;
      default: body.innerHTML = this._particlesPanel(state); break;
    }

    // Índice de nodos actualizables y render de TeX
    for (const node of body.querySelectorAll('[data-val]')) this._valNodes[node.dataset.val] = node;
    for (const node of body.querySelectorAll('[data-tex]')) {
      tex(node, node.dataset.tex, node.dataset.plain ?? node.dataset.tex);
    }

    if (mode === 'derivatives') this._animateDerivatives();
    this.updateMathValues(state);
  }

  _row(key, valueHtml, cls = '') {
    return `<div class="mrow ${cls}"><span class="mrow-key">${key}</span><span class="mrow-val">${valueHtml}</span></div>`;
  }

  _texRow(key, texStr, plain, cls = '') {
    return this._row(key, `<span data-tex="${escapeAttr(texStr)}" data-plain="${escapeAttr(plain)}"></span>`, cls);
  }

  _valRow(key, name, cls = '', hero = false) {
    return this._row(key, `<span data-val="${name}">—</span>`, `${cls}${hero ? ' hero' : ''}`);
  }

  _particlesPanel(state) {
    const { engine } = state;
    return `
      ${this._texRow('f(x)', engine.tex, engine.plain, 'c-f')}
      <div class="msection">
        <div class="msection-title">Interacción</div>
        <p class="ep-body">Las partículas dibujan tu función y la giran alrededor del eje X como sólido de revolución.
        Cerrá el puño y movelo frente a la cámara para empujarlas y generar ondas. La función no cambia.</p>
      </div>`;
  }

  _slopePanel(state) {
    const { engine } = state;
    const formula = engine.isLinear
      ? `<div class="formula-block" data-tex="m = \\frac{\\Delta y}{\\Delta x}" data-plain="m = Δy / Δx"></div>`
      : `<div class="formula-block" data-tex="m = f'(x_0)" data-plain="m = f'(x₀)"></div>`;
    const linearRows = engine.isLinear
      ? this._row('Forma', `<span>y = ${fmtNum(engine.linear.m)}x ${engine.linear.b >= 0 ? '+' : '−'} ${fmtNum(Math.abs(engine.linear.b))}</span>`)
      : '';
    return `
      ${this._texRow('f(x)', engine.tex, engine.plain, 'c-f')}
      ${engine.dTex ? this._texRow("f′(x)", engine.dTex, engine.dPlain, 'c-df') : ''}
      ${linearRows}
      <div class="msection">
        <div class="msection-title">${engine.isLinear ? 'Pendiente de la recta' : 'Pendiente en el punto'}</div>
        ${formula}
        ${this._valRow('x₀', 'x0')}
        ${this._valRow('f(x₀)', 'fx0')}
        ${this._valRow('Pendiente m', 'slope', 'c-tan', true)}
        ${this._valRow('Ángulo', 'angle')}
      </div>
      <div class="msection">
        <div class="msection-title">Recta tangente</div>
        ${this._valRow('Ecuación', 'tangentEq', 'c-tan')}
      </div>`;
  }

  _quotientPanel(state) {
    const { engine } = state;
    return `
      ${this._texRow('f(x)', engine.tex, engine.plain, 'c-f')}
      <div class="msection">
        <div class="msection-title">Cociente incremental</div>
        <div class="formula-block" data-tex="\\frac{f(x_0+h)-f(x_0)}{h}" data-plain="[f(x₀+h) − f(x₀)] / h"></div>
        ${this._valRow('x₀', 'x0')}
        ${this._valRow('h', 'h', 'c-sec')}
        ${this._valRow('f(x₀)', 'fx0')}
        ${this._valRow('f(x₀+h)', 'fx0h')}
      </div>
      <div class="msection">
        <div class="msection-title">Sustitución</div>
        ${this._row('Cálculo', '<span data-val="substitution">—</span>')}
        ${this._valRow('Resultado', 'quotient', 'c-sec', true)}
      </div>
      <div class="msection">
        <div class="msection-title">Comparación con la derivada</div>
        ${this._valRow("f′(x₀)", 'exact', 'c-tan')}
        ${this._valRow('Diferencia', 'gap')}
        ${this._row('Límite', '<span data-val="limitNote">—</span>')}
      </div>`;
  }

  _derivativesPanel(state) {
    const { engine } = state;
    return `
      <div class="legend-row">
        <span class="lg"><i style="background:#22e0ff"></i>f(x)</span>
        <span class="lg"><i style="background:#a06bff"></i>f′(x)</span>
        <span class="lg"><i style="background:#ff5ec4"></i>f″(x)</span>
      </div>
      <div id="deriv-seq">
        ${this._texRow('f(x)', engine.tex, engine.plain, 'c-f')}
        <div class="deriving" data-step="1" hidden>Derivando</div>
        <div data-step="2" hidden>
          ${engine.dTex ? this._texRow("f′(x)", engine.dTex, engine.dPlain, 'c-df')
    : this._row("f′(x)", '<span>derivada numérica</span>', 'c-df na')}
        </div>
        <div class="deriving" data-step="3" hidden>Segunda derivada</div>
        <div data-step="4" hidden>
          ${engine.d2Tex ? this._texRow("f″(x)", engine.d2Tex, engine.d2Plain, 'c-d2f')
    : this._row("f″(x)", '<span>derivada numérica</span>', 'c-d2f na')}
        </div>
      </div>
      <div class="msection">
        <div class="msection-title">Valores en x₀</div>
        ${this._valRow('x₀', 'x0')}
        ${this._valRow('f(x₀)', 'fx0', 'c-f')}
        ${this._valRow("f′(x₀)", 'dfx0', 'c-df')}
        ${this._valRow("f″(x₀)", 'd2fx0', 'c-d2f')}
      </div>
      <div class="msection">
        <div class="msection-title">Lectura</div>
        ${this._row('Crecimiento', '<span data-val="growth">—</span>')}
        ${this._row('Concavidad', '<span data-val="concavity">—</span>')}
      </div>`;
  }

  _analysisPanel(state) {
    const { engine } = state;
    return `
      ${this._texRow('f(x)', engine.tex, engine.plain, 'c-f')}
      ${engine.dTex ? this._texRow("f′(x)", engine.dTex, engine.dPlain, 'c-df') : ''}
      ${engine.d2Tex ? this._texRow("f″(x)", engine.d2Tex, engine.d2Plain, 'c-d2f') : ''}
      <div class="msection">
        <div class="msection-title">Dominio e intersecciones</div>
        ${this._row('Dominio', '<span data-val="domain">—</span>')}
        ${this._row('Raíces', '<span class="pill-list" data-val="roots">—</span>')}
        ${this._valRow('Corte con eje Y', 'yIntercept')}
        ${this._row('Asíntotas verticales', '<span class="pill-list" data-val="poles">—</span>')}
      </div>
      <div class="msection">
        <div class="msection-title">Puntos críticos</div>
        ${this._row('Máximos', '<span class="pill-list" data-val="maxima">—</span>')}
        ${this._row('Mínimos', '<span class="pill-list" data-val="minima">—</span>')}
        ${this._row('Inflexión', '<span class="pill-list" data-val="inflections">—</span>')}
      </div>
      <div class="msection">
        <div class="msection-title">Intervalos</div>
        ${this._row('Monotonía', '<span class="pill-list" data-val="monotonic">—</span>')}
        ${this._row('Concavidad', '<span class="pill-list" data-val="concavityIntervals">—</span>')}
      </div>`;
  }

  _visualPanel(state) {
    return this._texRow('f(x)', state.engine.tex, state.engine.plain, 'c-f');
  }

  /** Secuencia f → "derivando" → f′ → f″ (requisito de animación de fórmulas). */
  _animateDerivatives() {
    const token = ++this._animToken;
    const seq = this.el.mpBody.querySelector('#deriv-seq');
    if (!seq) return;
    const steps = [...seq.querySelectorAll('[data-step]')];
    const delays = [180, 620, 900, 1320];
    steps.forEach((el, i) => {
      setTimeout(() => {
        if (token !== this._animToken || !document.body.contains(el)) return;
        el.hidden = false;
        el.classList.add('reveal');
        // Los rótulos "derivando" desaparecen al revelarse el resultado
        if (el.classList.contains('deriving')) {
          setTimeout(() => { if (token === this._animToken) el.hidden = true; }, 420);
        }
      }, delays[i] ?? 0);
    });
  }

  /** Actualiza sólo los valores numéricos. Barato: se puede llamar seguido. */
  updateMathValues(state) {
    const v = this._valNodes;
    if (!v || !Object.keys(v).length) return;
    const { engine, mode, x0, h } = state;
    const set = (name, text) => { if (v[name]) v[name].textContent = text; };
    const setHtml = (name, html) => { if (v[name]) v[name].innerHTML = html; };

    set('x0', fmtNum(x0, 3));
    const y0 = engine.f(x0);
    set('fx0', fmtNum(y0, 4));

    if (mode === 'slope') {
      const m = engine.df(x0);
      set('slope', Number.isFinite(m) ? `m = ${fmtNum(m, 4)}` : 'no definida');
      set('angle', Number.isFinite(m) ? `${fmtNum(Math.atan(m) * 180 / Math.PI, 2)}°` : '—');
      if (Number.isFinite(m) && Number.isFinite(y0)) {
        const b = y0 - m * x0;
        set('tangentEq', `y = ${fmtNum(m, 3)}x ${b >= 0 ? '+' : '−'} ${fmtNum(Math.abs(b), 3)}`);
      } else set('tangentEq', 'no definida en este punto');
    }

    if (mode === 'quotient') {
      const q = engine.differenceQuotient(x0, h);
      set('h', fmtNum(h, 4));
      set('fx0h', fmtNum(q.fx0h, 4));
      set('quotient', Number.isFinite(q.value) ? fmtNum(q.value, 4) : 'no definido');
      set('exact', fmtNum(q.exact, 4));
      if (Number.isFinite(q.fx0) && Number.isFinite(q.fx0h)) {
        set('substitution', `[${fmtNum(q.fx0h, 3)} − ${fmtSigned(q.fx0, 3)}] / ${fmtNum(h, 3)}`);
      } else set('substitution', 'fuera del dominio');
      const gap = Math.abs(q.value - q.exact);
      set('gap', Number.isFinite(gap) ? fmtNum(gap, 5) : '—');
      set('limitNote', !Number.isFinite(gap) ? '—'
        : gap < 1e-3 ? 'h → 0 · el cociente ya es la derivada'
          : gap < 0.1 ? 'la secante casi coincide con la tangente'
            : 'achicá h para acercarte a f′(x₀)');
    }

    if (mode === 'derivatives') {
      const d1 = engine.df(x0), d2 = engine.d2f(x0);
      set('dfx0', fmtNum(d1, 4));
      set('d2fx0', fmtNum(d2, 4));
      set('growth', !Number.isFinite(d1) ? 'no definida'
        : Math.abs(d1) < 1e-9 ? 'tangente horizontal'
          : d1 > 0 ? 'creciente' : 'decreciente');
      set('concavity', !Number.isFinite(d2) ? 'no definida'
        : Math.abs(d2) < 1e-9 ? 'posible inflexión'
          : d2 > 0 ? 'cóncava hacia arriba' : 'cóncava hacia abajo');
    }

    if (mode === 'analysis') {
      const a = state.analysis;
      if (!a) return;
      const NA = '<span class="pill na">No disponible para esta función.</span>';
      set('domain', a.domain.text);
      setHtml('roots', a.roots.length
        ? a.roots.slice(0, 10).map((r) => `<span class="pill root">x = ${fmtNum(r.x, 3)}</span>`).join('')
        : NA);
      set('yIntercept', a.yIntercept === null ? 'No disponible para esta función.' : fmtNum(a.yIntercept, 4));
      setHtml('poles', a.poles.length
        ? a.poles.slice(0, 8).map((p) => `<span class="pill inf">x = ${fmtNum(p, 3)}</span>`).join('')
        : '<span class="pill na">Ninguna</span>');

      const maxima = a.critical.filter((c) => c.kind === 'máximo');
      const minima = a.critical.filter((c) => c.kind === 'mínimo');
      setHtml('maxima', maxima.length
        ? maxima.slice(0, 6).map((c) => `<span class="pill max">(${fmtNum(c.x, 2)} , ${fmtNum(c.y, 2)})</span>`).join('')
        : NA);
      setHtml('minima', minima.length
        ? minima.slice(0, 6).map((c) => `<span class="pill min">(${fmtNum(c.x, 2)} , ${fmtNum(c.y, 2)})</span>`).join('')
        : NA);
      setHtml('inflections', a.inflections.length
        ? a.inflections.slice(0, 6).map((p) => `<span class="pill inf">x = ${fmtNum(p.x, 3)}</span>`).join('')
        : NA);
      setHtml('monotonic', a.monotonic.length
        ? a.monotonic.slice(0, 8).map((i) => `<span class="pill">${i.label === 'creciente' ? '↗' : '↘'} (${fmtNum(i.from, 2)} , ${fmtNum(i.to, 2)})</span>`).join('')
        : NA);
      setHtml('concavityIntervals', a.concavity.length
        ? a.concavity.slice(0, 8).map((i) => `<span class="pill">${i.label.includes('arriba') ? '⌣' : '⌢'} (${fmtNum(i.from, 2)} , ${fmtNum(i.to, 2)})</span>`).join('')
        : NA);
    }
  }

  needsRebuild(mode) { return this._panelMode !== mode; }

  /** Fuerza la reconstrucción del panel (por ejemplo al cambiar de función). */
  invalidatePanel() { this._panelMode = null; }

  isTutorialVisible() { return !this.el.tutorial.hidden; }

  // ── Explicación ─────────────────────────────────────────────────────────────

  setExplanation({ title, body }) {
    this.el.epTitle.textContent = title;
    this.el.epBody.textContent = body;
  }

  setAiResult(text, isError = false) {
    const box = this.el.aiBox;
    box.hidden = false;
    box.className = `ai-box${isError ? ' err' : ''}`;
    box.innerHTML = `<span class="ai-tag">${isError ? 'IA — error' : 'Explicación generada por IA'}</span>`;
    box.appendChild(document.createTextNode(text));
  }

  clearAiResult() { this.el.aiBox.hidden = true; this.el.aiBox.innerHTML = ''; }
  setAiLoading(on) {
    this.el.btnAi.disabled = on;
    this.el.btnAi.textContent = on ? 'Consultando…' : 'Explicar con IA';
  }

  // ── Controles ───────────────────────────────────────────────────────────────

  syncSliders(state, view) {
    if (this._draggingSlider) return;
    const { x0, h } = state;
    const t = clamp((x0 - view.xMin) / (view.xMax - view.xMin), 0, 1);
    this.el.x0Slider.value = String(Math.round(t * 1000));
    this.el.x0Out.textContent = fmtNum(x0, 3);
    const ht = (Math.log10(clamp(h, H_MIN, H_MAX)) - Math.log10(H_MIN)) / (Math.log10(H_MAX) - Math.log10(H_MIN));
    this.el.hSlider.value = String(Math.round(ht * 1000));
    this.el.hOut.textContent = fmtNum(h, 4);
  }

  setLockState(which, handControls, cameraOn) {
    const btn = which === 'x0' ? this.el.btnLockX0 : this.el.btnLockH;
    if (!btn) return;
    btn.textContent = handControls ? '🔓 mano' : '🔒 fijo';
    btn.classList.toggle('active', handControls && cameraOn);
    btn.title = handControls
      ? 'La mano controla este valor. Clic para fijarlo.'
      : 'Valor fijo: sólo cambia con el deslizador. Clic para devolver el control a la mano.';
  }

  // ── Diálogos y avisos ───────────────────────────────────────────────────────

  showTutorial() { this.el.tutorial.hidden = false; this.el.tutorial.classList.remove('closing'); }
  hideTutorial() {
    const t = this.el.tutorial;
    t.classList.add('closing');
    setTimeout(() => { t.hidden = true; }, 340);
  }

  showAiDialog(endpoint) {
    this.el.aiEndpoint.value = endpoint ?? '';
    this.el.aiEndpointMsg.textContent = '';
    this.el.aiEndpointMsg.className = 'feedback';
    this.el.aiDialog.hidden = false;
    setTimeout(() => this.el.aiEndpoint.focus(), 60);
  }
  hideAiDialog() { this.el.aiDialog.hidden = true; }
  setAiDialogMessage(text, type = 'info') {
    this.el.aiEndpointMsg.textContent = text;
    this.el.aiEndpointMsg.className = `feedback ${type}`;
  }

  toast(message, type = '', duration = 4200) {
    const t = this.el.toast;
    t.textContent = message;
    t.className = type;
    t.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.hidden = true; }, duration);
  }

  fatal(title, message) {
    this.el.fatal.hidden = false;
    this.el.fatal.innerHTML = `<div class="fatal-inner"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/\n/g, ' '); }
