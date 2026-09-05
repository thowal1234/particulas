/**
 * Sistema de coordenadas compartido entre la gráfica 2D y el sistema de partículas.
 *
 * La clave del proyecto: partículas y gráfica viven en el MISMO espacio matemático.
 * El mundo de Three.js ES el plano cartesiano, con relación de aspecto 1:1, de modo
 * que una recta tangente se ve realmente tangente y una pendiente de 1 se ve a 45°.
 */

export class View {
  constructor() {
    this.cx = 0;        // centro en x (unidades matemáticas)
    this.cy = 0;        // centro en y
    this.spanX = 20;    // ancho visible en unidades matemáticas
    this.width = 1;     // px CSS
    this.height = 1;    // px CSS
    this.version = 0;   // se incrementa en cada cambio → invalida cachés
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.version++;
  }

  /** Unidades matemáticas por píxel CSS (idéntico en x e y: aspecto 1:1). */
  get unitsPerPixel() { return this.spanX / this.width; }
  get pixelsPerUnit() { return this.width / this.spanX; }
  get spanY() { return this.spanX * this.height / this.width; }

  get xMin() { return this.cx - this.spanX / 2; }
  get xMax() { return this.cx + this.spanX / 2; }
  get yMin() { return this.cy - this.spanY / 2; }
  get yMax() { return this.cy + this.spanY / 2; }

  // ── Mundo ↔ pantalla ────────────────────────────────────────────────────
  toScreenX(x) { return (x - this.xMin) * this.pixelsPerUnit; }
  toScreenY(y) { return this.height - (y - this.yMin) * this.pixelsPerUnit; }
  toWorldX(sx) { return this.xMin + sx * this.unitsPerPixel; }
  toWorldY(sy) { return this.yMin + (this.height - sy) * this.unitsPerPixel; }

  /**
   * Zoom uniforme manteniendo fijo un punto de anclaje en pantalla.
   * @param {number} factor  <1 acerca, >1 aleja
   */
  zoomAt(sx, sy, factor) {
    const wx = this.toWorldX(sx);
    const wy = this.toWorldY(sy);
    const next = clamp(this.spanX * factor, 0.05, 4000);
    const applied = next / this.spanX;
    this.spanX = next;
    // El punto bajo el cursor debe permanecer en el mismo lugar
    this.cx = wx + (this.cx - wx) * applied;
    this.cy = wy + (this.cy - wy) * applied;
    this.version++;
  }

  /** Zoom absoluto al centro (usado por el pellizco de la mano izquierda). */
  setSpan(spanX) {
    const next = clamp(spanX, 0.05, 4000);
    if (Math.abs(next - this.spanX) < 1e-9) return;
    this.spanX = next;
    this.version++;
  }

  panByPixels(dxPx, dyPx) {
    this.cx -= dxPx * this.unitsPerPixel;
    this.cy += dyPx * this.unitsPerPixel;
    this.version++;
  }

  setCenter(cx, cy) {
    if (Number.isFinite(cx)) this.cx = cx;
    if (Number.isFinite(cy)) this.cy = cy;
    this.version++;
  }

  /** Firma que cambia cuando cambia lo visible → sirve para invalidar cachés. */
  signature() {
    return `${this.cx.toFixed(6)}|${this.cy.toFixed(6)}|${this.spanX.toFixed(6)}|${this.width}x${this.height}`;
  }
}

export function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
export function lerp(a, b, t) { return a + (b - a) * t; }

/** Interpolación exponencial independiente del framerate. */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
