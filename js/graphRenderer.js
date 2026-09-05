/**
 * Gráfica matemática sobre canvas 2D.
 *
 * Comparte el objeto View con el sistema de partículas, así que la curva
 * dibujada y las partículas ocupan exactamente las mismas coordenadas.
 * Todo el dibujo se hace en píxeles CSS; el devicePixelRatio se aplica una
 * sola vez en la transformación del contexto.
 */

import { MathEngine, fmtNum } from './mathEngine.js';

export const COLORS = {
  f: '#22e0ff',
  df: '#a06bff',
  d2f: '#ff5ec4',
  tangent: '#ffb457',
  secant: '#4be8a4',
  point: '#ffffff',
  axis: 'rgba(150,190,255,0.42)',
  gridMinor: 'rgba(120,160,230,0.055)',
  gridMajor: 'rgba(120,160,230,0.13)',
  label: 'rgba(190,215,255,0.62)',
};

const UI_FONT = "12px 'Inter','Segoe UI',system-ui,sans-serif";
const MATH_FONT = "italic 14px 'Cambria Math','Latin Modern Math',Georgia,serif";

export class GraphRenderer {
  constructor(canvas, view) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = view;
    this.dpr = 1;
    this._curveCache = { sig: null };
    this.opacity = 1;      // se atenúa en el modo partículas
    this.showAxes = true;
  }

  resize() {
    const { view, canvas } = this;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(view.width * this.dpr);
    canvas.height = Math.round(view.height * this.dpr);
    canvas.style.width = `${view.width}px`;
    canvas.style.height = `${view.height}px`;
    this._curveCache.sig = null;
  }

  /** Curvas muestreadas y partidas en tramos, cacheadas por vista+función. */
  _curveSegments(engine, which) {
    const sig = `${this.view.signature()}|${which}|${engine.expr}`;
    const key = `segs_${which}`;
    if (this._curveCache.sig === sig && this._curveCache[key]) return this._curveCache[key];
    if (this._curveCache.sig !== sig) {
      this._curveCache = { sig };
    }
    const { view } = this;
    const n = Math.max(400, Math.min(2400, Math.round(view.width * 1.4)));
    const pad = view.spanX * 0.02;
    const s = engine.sample(which, view.xMin - pad, view.xMax + pad, n);
    // Un salto mayor que ~1,5 pantallas entre muestras contiguas es una asíntota
    const segs = MathEngine.segments(s.xs, s.ys, view.spanY * 1.5);
    this._curveCache[key] = segs;
    return segs;
  }

  // ── Dibujo principal ────────────────────────────────────────────────────────

  draw(state) {
    const { ctx, view } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    if (!state.engine?.ready) return;

    ctx.globalAlpha = this.opacity;
    if (this.showAxes) this._drawGrid();

    const mode = state.mode;

    // Derivadas de fondo (modo DERIVADAS)
    if (mode === 'derivatives') {
      this._drawCurve(state.engine, 'd2f', COLORS.d2f, 1.6, 0.55, [6, 5]);
      this._drawCurve(state.engine, 'df', COLORS.df, 2, 0.8, [10, 4]);
    }

    this._drawCurve(state.engine, 'f', COLORS.f, mode === 'visual' ? 3 : 2.4, 1);

    if (mode === 'analysis') this._drawAnalysis(state);
    if (mode === 'slope') this._drawTangent(state);
    if (mode === 'quotient') this._drawSecant(state);
    if (mode === 'derivatives') this._drawDerivativeMarkers(state);
    if (mode === 'visual') this._drawCursorPoint(state);

    ctx.globalAlpha = 1;
  }

  _drawGrid() {
    const { ctx, view } = this;
    const step = niceStep(view.spanX / Math.max(2, view.width / 90));
    const minor = step / 5;

    ctx.lineWidth = 1;
    // Líneas menores
    ctx.strokeStyle = COLORS.gridMinor;
    ctx.beginPath();
    for (let x = Math.ceil(view.xMin / minor) * minor; x <= view.xMax; x += minor) {
      const sx = Math.round(view.toScreenX(x)) + 0.5;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, view.height);
    }
    for (let y = Math.ceil(view.yMin / minor) * minor; y <= view.yMax; y += minor) {
      const sy = Math.round(view.toScreenY(y)) + 0.5;
      ctx.moveTo(0, sy); ctx.lineTo(view.width, sy);
    }
    ctx.stroke();

    // Líneas mayores
    ctx.strokeStyle = COLORS.gridMajor;
    ctx.beginPath();
    for (let x = Math.ceil(view.xMin / step) * step; x <= view.xMax; x += step) {
      const sx = Math.round(view.toScreenX(x)) + 0.5;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, view.height);
    }
    for (let y = Math.ceil(view.yMin / step) * step; y <= view.yMax; y += step) {
      const sy = Math.round(view.toScreenY(y)) + 0.5;
      ctx.moveTo(0, sy); ctx.lineTo(view.width, sy);
    }
    ctx.stroke();

    // Ejes
    const ax = clampPx(view.toScreenY(0), view.height);
    const ay = clampPx(view.toScreenX(0), view.width);
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(ax) + 0.5); ctx.lineTo(view.width, Math.round(ax) + 0.5);
    ctx.moveTo(Math.round(ay) + 0.5, 0); ctx.lineTo(Math.round(ay) + 0.5, view.height);
    ctx.stroke();

    // Números
    ctx.fillStyle = COLORS.label;
    ctx.font = UI_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelY = Math.min(view.height - 18, Math.max(4, ax + 6));
    for (let x = Math.ceil(view.xMin / step) * step; x <= view.xMax; x += step) {
      if (Math.abs(x) < step * 0.01) continue;
      ctx.fillText(fmtNum(x, 3), view.toScreenX(x), labelY);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const labelX = Math.min(view.width - 6, Math.max(28, ay - 8));
    for (let y = Math.ceil(view.yMin / step) * step; y <= view.yMax; y += step) {
      if (Math.abs(y) < step * 0.01) continue;
      ctx.fillText(fmtNum(y, 3), labelX, view.toScreenY(y));
    }
    // Origen
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('0', Math.max(10, ay - 6), Math.min(view.height - 16, ax + 5));
  }

  _drawCurve(engine, which, color, width, alpha, dash = null) {
    const { ctx, view } = this;
    const segs = this._curveSegments(engine, which);
    if (!segs.length) return;

    ctx.save();
    ctx.globalAlpha = this.opacity * alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (dash) ctx.setLineDash(dash);
    // Resplandor
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;

    for (const seg of segs) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < seg.xs.length; i++) {
        const sy = view.toScreenY(seg.ys[i]);
        // Recorta verticalmente para que canvas no degrade con coordenadas enormes
        const cy = Math.max(-4000, Math.min(view.height + 4000, sy));
        const sx = view.toScreenX(seg.xs[i]);
        if (!started) { ctx.moveTo(sx, cy); started = true; } else ctx.lineTo(sx, cy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Modo PENDIENTE ──────────────────────────────────────────────────────────

  _drawTangent(state) {
    const { ctx, view } = this;
    const { engine, x0 } = state;
    const y0 = engine.f(x0);
    const m = engine.df(x0);
    if (!Number.isFinite(y0)) { this._drawUndefinedMarker(x0); return; }

    if (Number.isFinite(m)) {
      // Recta tangente: y = y0 + m(x − x0), dibujada de borde a borde
      const xa = view.xMin, xb = view.xMax;
      ctx.save();
      ctx.strokeStyle = COLORS.tangent;
      ctx.lineWidth = 2;
      ctx.shadowColor = COLORS.tangent;
      ctx.shadowBlur = 12;
      ctx.globalAlpha = this.opacity * 0.95;
      ctx.beginPath();
      ctx.moveTo(view.toScreenX(xa), view.toScreenY(y0 + m * (xa - x0)));
      ctx.lineTo(view.toScreenX(xb), view.toScreenY(y0 + m * (xb - x0)));
      ctx.stroke();
      ctx.restore();

      this._drawSlopeTriangle(x0, y0, m);
    }

    this._drawPoint(x0, y0, COLORS.tangent, 'P', `(${fmtNum(x0, 2)} , ${fmtNum(y0, 2)})`);
  }

  /**
   * Triángulo de pendiente: avanza 1 unidad en x y sube m unidades.
   * Es la representación visual de "m = Δy / Δx".
   */
  _drawSlopeTriangle(x0, y0, m) {
    const { ctx, view } = this;
    if (!Number.isFinite(m) || Math.abs(m) < 1e-9) return;

    // Se busca el Δx "bonito" más grande cuyo triángulo entre en pantalla.
    // Con pendientes fuertes ningún valor redondo sirve (Δx = 1 daría un Δy de
    // 8 unidades), así que se cae a un Δx calculado desde la altura disponible.
    const ppu = view.pixelsPerUnit;
    const maxRisePx = view.height * 0.26;
    const minRunPx = 30, maxRunPx = 150;

    let dx = null;
    for (let e = 2; e >= -3 && dx === null; e--) {
      for (const mult of [5, 2, 1]) {
        const c = mult * Math.pow(10, e);
        const runPx = c * ppu;
        if (runPx <= maxRunPx && runPx >= minRunPx && Math.abs(m * c) * ppu <= maxRisePx) { dx = c; break; }
      }
    }
    if (dx === null) {
      dx = maxRisePx / (Math.abs(m) * ppu);
      if (dx * ppu < 12) return;   // el triángulo sería ilegible
    }

    const dy = m * dx;
    const x1 = x0 + dx, y1 = y0 + dy;
    const sx0 = view.toScreenX(x0), sy0 = view.toScreenY(y0);
    const sx1 = view.toScreenX(x1), sy1 = view.toScreenY(y1);

    ctx.save();
    ctx.globalAlpha = this.opacity * 0.85;
    ctx.strokeStyle = 'rgba(255,180,87,0.75)';
    ctx.fillStyle = 'rgba(255,180,87,0.10)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sx0, sy0); ctx.lineTo(sx1, sy0); ctx.lineTo(sx1, sy1); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = UI_FONT;
    ctx.fillStyle = 'rgba(255,205,140,0.95)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`Δx = ${fmtNum(dx, 3)}`, (sx0 + sx1) / 2, sy0 + 6);
    ctx.textAlign = dx > 0 ? 'left' : 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(`Δy = ${fmtNum(dy, 3)}`, sx1 + (dx > 0 ? 8 : -8), (sy0 + sy1) / 2);
    ctx.restore();
  }

  // ── Modo COCIENTE INCREMENTAL ───────────────────────────────────────────────

  _drawSecant(state) {
    const { ctx, view } = this;
    const { engine, x0, h } = state;
    const y0 = engine.f(x0);
    const x1 = x0 + h;
    const y1 = engine.f(x1);

    // Tangente de referencia, tenue: se ve cómo la secante converge hacia ella
    const m = engine.df(x0);
    if (Number.isFinite(y0) && Number.isFinite(m)) {
      ctx.save();
      ctx.globalAlpha = this.opacity * 0.32;
      ctx.strokeStyle = COLORS.tangent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.moveTo(view.toScreenX(view.xMin), view.toScreenY(y0 + m * (view.xMin - x0)));
      ctx.lineTo(view.toScreenX(view.xMax), view.toScreenY(y0 + m * (view.xMax - x0)));
      ctx.stroke();
      ctx.restore();
    }

    if (!Number.isFinite(y0)) { this._drawUndefinedMarker(x0); return; }
    if (!Number.isFinite(y1)) {
      this._drawPoint(x0, y0, COLORS.secant, 'P', `(${fmtNum(x0, 2)} , ${fmtNum(y0, 2)})`);
      this._drawUndefinedMarker(x1);
      return;
    }

    // Recta secante prolongada a todo el ancho
    const ms = (y1 - y0) / h;
    if (Number.isFinite(ms)) {
      ctx.save();
      ctx.strokeStyle = COLORS.secant;
      ctx.lineWidth = 2;
      ctx.shadowColor = COLORS.secant;
      ctx.shadowBlur = 12;
      ctx.globalAlpha = this.opacity * 0.95;
      ctx.beginPath();
      ctx.moveTo(view.toScreenX(view.xMin), view.toScreenY(y0 + ms * (view.xMin - x0)));
      ctx.lineTo(view.toScreenX(view.xMax), view.toScreenY(y0 + ms * (view.xMax - x0)));
      ctx.stroke();
      ctx.restore();
    }

    // Triángulo h / Δf entre P y Q
    const sx0 = view.toScreenX(x0), sy0 = view.toScreenY(y0);
    const sx1 = view.toScreenX(x1), sy1 = view.toScreenY(y1);
    ctx.save();
    ctx.globalAlpha = this.opacity * 0.9;
    ctx.strokeStyle = 'rgba(75,232,164,0.7)';
    ctx.fillStyle = 'rgba(75,232,164,0.10)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sx0, sy0); ctx.lineTo(sx1, sy0); ctx.lineTo(sx1, sy1); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = UI_FONT;
    ctx.fillStyle = 'rgba(150,255,210,0.95)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    if (Math.abs(sx1 - sx0) > 26) ctx.fillText(`h = ${fmtNum(h, 3)}`, (sx0 + sx1) / 2, sy0 + 6);
    ctx.textAlign = h > 0 ? 'left' : 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(`f(x₀+h) − f(x₀) = ${fmtNum(y1 - y0, 3)}`, sx1 + (h > 0 ? 8 : -8), (sy0 + sy1) / 2);
    ctx.restore();

    this._drawPoint(x0, y0, COLORS.secant, 'P', `(${fmtNum(x0, 2)} , ${fmtNum(y0, 2)})`);
    this._drawPoint(x1, y1, COLORS.secant, 'Q', `(${fmtNum(x1, 2)} , ${fmtNum(y1, 2)})`);
  }

  // ── Modo DERIVADAS ──────────────────────────────────────────────────────────

  _drawDerivativeMarkers(state) {
    const { engine, x0 } = state;
    const pts = [
      [engine.f(x0), COLORS.f, 'f'],
      [engine.df(x0), COLORS.df, "f′"],
      [engine.d2f(x0), COLORS.d2f, 'f″'],
    ];
    const { ctx, view } = this;
    // Línea vertical que une los tres valores en el mismo x₀
    ctx.save();
    ctx.globalAlpha = this.opacity * 0.35;
    ctx.strokeStyle = 'rgba(190,215,255,0.6)';
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(view.toScreenX(x0), 0);
    ctx.lineTo(view.toScreenX(x0), view.height);
    ctx.stroke();
    ctx.restore();

    for (const [y, color, label] of pts) {
      if (!Number.isFinite(y)) continue;
      this._drawPoint(x0, y, color, label, fmtNum(y, 3));
    }
  }

  _drawCursorPoint(state) {
    const y = state.engine.f(state.x0);
    if (Number.isFinite(y)) this._drawPoint(state.x0, y, COLORS.f, '', `(${fmtNum(state.x0, 2)} , ${fmtNum(y, 2)})`);
  }

  // ── Modo ANÁLISIS ───────────────────────────────────────────────────────────

  _drawAnalysis(state) {
    const { ctx, view } = this;
    const a = state.analysis;
    if (!a) return;

    // Asíntotas verticales
    ctx.save();
    ctx.globalAlpha = this.opacity * 0.6;
    ctx.strokeStyle = 'rgba(255,94,196,0.55)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([8, 6]);
    for (const p of a.poles) {
      const sx = view.toScreenX(p);
      if (sx < -20 || sx > view.width + 20) continue;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, view.height); ctx.stroke();
    }
    ctx.restore();

    for (const r of a.roots) this._drawPoint(r.x, 0, '#7fe7ff', '', `raíz ${fmtNum(r.x, 3)}`, 5);
    for (const c of a.critical) {
      const color = c.kind === 'máximo' ? '#ff9f45' : c.kind === 'mínimo' ? '#4be8a4' : '#c9d6ef';
      this._drawPoint(c.x, c.y, color, '', `${c.kind} (${fmtNum(c.x, 2)} , ${fmtNum(c.y, 2)})`, 6);
    }
    for (const p of a.inflections) this._drawPoint(p.x, p.y, COLORS.d2f, '', `inflexión ${fmtNum(p.x, 2)}`, 5);
    if (a.yIntercept !== null) this._drawPoint(0, a.yIntercept, '#ffffff', '', `corte Y: ${fmtNum(a.yIntercept, 3)}`, 5);
  }

  // ── Primitivas ──────────────────────────────────────────────────────────────

  _drawPoint(x, y, color, tag, caption, radius = 6.5) {
    const { ctx, view } = this;
    const sx = view.toScreenX(x), sy = view.toScreenY(y);
    if (sx < -60 || sx > view.width + 60 || sy < -60 || sy > view.height + 60) return;

    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(sx, sy, radius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(4,6,15,0.9)';
    ctx.beginPath(); ctx.arc(sx, sy, radius * 0.42, 0, Math.PI * 2); ctx.fill();

    // Etiqueta desplazada, siempre dentro del lienzo
    const goRight = sx < view.width - 150;
    const goUp = sy > 60;
    ctx.font = tag ? MATH_FONT : UI_FONT;
    ctx.textAlign = goRight ? 'left' : 'right';
    ctx.textBaseline = goUp ? 'bottom' : 'top';
    const tx = sx + (goRight ? radius + 8 : -radius - 8);
    const ty = sy + (goUp ? -radius - 5 : radius + 5);
    if (tag) {
      ctx.fillStyle = color;
      ctx.fillText(tag, tx, ty);
    }
    if (caption) {
      ctx.font = UI_FONT;
      ctx.fillStyle = 'rgba(215,232,255,0.82)';
      const dy = tag ? (goUp ? -16 : 16) : 0;
      ctx.fillText(caption, tx, ty + dy);
    }
    ctx.restore();
  }

  _drawUndefinedMarker(x) {
    const { ctx, view } = this;
    const sx = view.toScreenX(x);
    ctx.save();
    ctx.globalAlpha = this.opacity * 0.8;
    ctx.strokeStyle = '#ff6b8a';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, view.height); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff6b8a';
    ctx.font = UI_FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`f(${fmtNum(x, 2)}) no está definida`, sx, 14);
    ctx.restore();
  }
}

/** Paso de rejilla "bonito": 1, 2, 5 × 10^k */
function niceStep(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const f = raw / base;
  const mult = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return mult * base;
}

function clampPx(v, max) { return Math.max(0, Math.min(max, v)); }
