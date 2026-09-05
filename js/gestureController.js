/**
 * Reconocimiento y estabilización de gestos.
 *
 * Mejoras sobre el conteo del proyecto original (`lm[tip].y < lm[joint].y`):
 *   · Es invariante a la rotación: proyecta los dedos sobre el eje de la palma
 *     en lugar de comparar coordenadas Y absolutas, así funciona con la mano
 *     inclinada o de costado.
 *   · Cuenta el pulgar. El original recorría sólo [8,12,16,20], de modo que
 *     nunca podía devolver 5 y el gesto de 5 dedos era inalcanzable.
 *   · Suaviza los landmarks y exige que el gesto se sostenga ~400 ms antes de
 *     cambiar de modo, con histéresis para no oscilar entre estados.
 */

import { clamp } from './view.js';

// Índices de landmarks de MediaPipe Hands
const WRIST = 0, THUMB_IP = 3, THUMB_TIP = 4;
const INDEX_MCP = 5, INDEX_TIP = 8;
const MIDDLE_MCP = 9, MIDDLE_TIP = 12;
const PINKY_MCP = 17;
const FINGERS = [
  { mcp: 5, pip: 6, tip: 8 },     // índice
  { mcp: 9, pip: 10, tip: 12 },   // medio
  { mcp: 13, pip: 14, tip: 16 },  // anular
  { mcp: 17, pip: 18, tip: 20 },  // meñique
];

export const MODE_BY_FINGERS = ['particles', 'slope', 'quotient', 'derivatives', 'analysis', 'visual'];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class GestureController {
  constructor(options = {}) {
    this.holdMs = options.holdMs ?? 420;
    this.exitHoldMs = options.exitHoldMs ?? 560;  // histéresis al abandonar un modo
    this.smoothing = options.smoothing ?? 0.45;

    this.reset();
  }

  reset() {
    this._smoothed = new Map();      // handKey → landmarks suavizados
    this.committed = 0;              // dedos confirmados
    this.raw = null;                 // dedos del frame actual
    this.candidate = null;
    this.candidateSince = 0;
    this.candidateHits = 0;
    this.candidateTotal = 0;
    this.holdProgress = 0;
    this.confidence = 0;

    this.present = false;
    this.hands = { primary: null, secondary: null };
    this.palm = { x: 0.5, y: 0.5 };
    this.indexTip = { x: 0.5, y: 0.5 };
    this.spread = 0;                 // separación índice–medio (controla h)
    this.pinch = null;               // pellizco de la mano secundaria (zoom)
    this.onCommit = null;
  }

  /** Suavizado exponencial de landmarks para eliminar el temblor. */
  _smooth(key, landmarks) {
    const prev = this._smoothed.get(key);
    if (!prev || prev.length !== landmarks.length) {
      const copy = landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
      this._smoothed.set(key, copy);
      return copy;
    }
    const a = this.smoothing;
    for (let i = 0; i < landmarks.length; i++) {
      prev[i].x += (landmarks[i].x - prev[i].x) * a;
      prev[i].y += (landmarks[i].y - prev[i].y) * a;
      prev[i].z += ((landmarks[i].z ?? 0) - prev[i].z) * a;
    }
    return prev;
  }

  /**
   * Cuenta dedos extendidos de forma invariante a la rotación.
   * @returns {{count:number, confidence:number, flags:boolean[]}}
   */
  static countFingers(lm) {
    const wrist = lm[WRIST];
    const mid = lm[MIDDLE_MCP];
    // Eje "hacia arriba" de la palma
    let ux = mid.x - wrist.x, uy = mid.y - wrist.y;
    const ulen = Math.hypot(ux, uy) || 1e-6;
    ux /= ulen; uy /= ulen;
    const palmSize = Math.max(1e-6, dist(lm[INDEX_MCP], lm[PINKY_MCP]));

    const proj = (p) => (p.x - wrist.x) * ux + (p.y - wrist.y) * uy;

    const flags = [];
    let margins = 0;
    for (const f of FINGERS) {
      const dTip = proj(lm[f.tip]);
      const dPip = proj(lm[f.pip]);
      const margin = (dTip - dPip) / palmSize;
      flags.push(margin > 0.12);
      margins += Math.min(1, Math.abs(margin) / 0.35);
    }

    // El pulgar se abre lateralmente: se aleja del meñique al extenderse
    const pinkyMcp = lm[PINKY_MCP];
    const dTipRef = dist(lm[THUMB_TIP], pinkyMcp);
    const dIpRef = dist(lm[THUMB_IP], pinkyMcp);
    const thumbMargin = (dTipRef - dIpRef) / palmSize;
    const thumbOut = thumbMargin > 0.12;
    flags.unshift(thumbOut);
    margins += Math.min(1, Math.abs(thumbMargin) / 0.3);

    const count = flags.reduce((n, v) => n + (v ? 1 : 0), 0);
    return { count, confidence: clamp(margins / 5, 0, 1), flags };
  }

  /**
   * Procesa un frame de MediaPipe.
   * @param {Array<Array>} multiHandLandmarks
   * @param {Array<{label:string}>} multiHandedness
   * @param {number} now  timestamp en ms
   */
  update(multiHandLandmarks, multiHandedness, now) {
    if (!multiHandLandmarks || multiHandLandmarks.length === 0) {
      this.present = false;
      this.hands = { primary: null, secondary: null };
      this.pinch = null;
      this._decay(now);
      return;
    }

    // Mano primaria: la derecha si está; si no, la primera detectada.
    let primaryIdx = 0;
    if (multiHandLandmarks.length > 1) {
      const right = multiHandedness?.findIndex((h) => h?.label === 'Right');
      if (right >= 0) primaryIdx = right;
    }
    const secondaryIdx = multiHandLandmarks.length > 1 ? (primaryIdx === 0 ? 1 : 0) : -1;

    const primary = this._smooth(`h${primaryIdx}`, multiHandLandmarks[primaryIdx]);
    this.hands.primary = primary;
    this.hands.secondary = secondaryIdx >= 0
      ? this._smooth(`h${secondaryIdx}`, multiHandLandmarks[secondaryIdx])
      : null;

    this.present = true;

    // Centro de la palma: promedio de nudillos, más estable que un solo punto
    const ids = [WRIST, INDEX_MCP, MIDDLE_MCP, 13, PINKY_MCP];
    let px = 0, py = 0;
    for (const i of ids) { px += primary[i].x; py += primary[i].y; }
    this.palm = { x: px / ids.length, y: py / ids.length };
    this.indexTip = { x: primary[INDEX_TIP].x, y: primary[INDEX_TIP].y };

    const palmSize = Math.max(1e-6, dist(primary[INDEX_MCP], primary[PINKY_MCP]));
    // Separación índice–medio normalizada por el tamaño de la palma:
    // así no depende de la distancia a la cámara.
    this.spread = dist(primary[INDEX_TIP], primary[MIDDLE_TIP]) / palmSize;

    if (this.hands.secondary) {
      const s = this.hands.secondary;
      const sPalm = Math.max(1e-6, dist(s[INDEX_MCP], s[PINKY_MCP]));
      this.pinch = dist(s[THUMB_TIP], s[INDEX_TIP]) / sPalm;
    } else {
      this.pinch = null;
    }

    const { count, confidence } = GestureController.countFingers(primary);
    this.raw = count;
    this.confidence = confidence;
    this._accumulate(count, now);
  }

  /** Máquina de estabilidad: exige sostener el gesto antes de confirmarlo. */
  _accumulate(count, now) {
    if (this.candidate !== count) {
      // Cambio de candidato sólo si el actual perdió consistencia
      if (this.candidate === null || this.candidateTotal === 0 || (this.candidateHits / this.candidateTotal) < 0.62) {
        this.candidate = count;
        this.candidateSince = now;
        this.candidateHits = 1;
        this.candidateTotal = 1;
        this.holdProgress = 0;
        return;
      }
      this.candidateTotal++;
      this.holdProgress = this._progress(now);
      return;
    }

    this.candidateHits++;
    this.candidateTotal++;

    if (count === this.committed) {
      this.holdProgress = 0;
      return;
    }

    const required = this.committed === count ? 0 : (this.committed === 0 ? this.holdMs : this.exitHoldMs);
    const elapsed = now - this.candidateSince;
    const ratio = this.candidateHits / this.candidateTotal;
    this.holdProgress = clamp(elapsed / required, 0, 1) * clamp(ratio / 0.7, 0, 1);

    if (elapsed >= required && ratio >= 0.7) {
      const previous = this.committed;
      this.committed = count;
      this.holdProgress = 0;
      this.candidateHits = 1;
      this.candidateTotal = 1;
      this.candidateSince = now;
      if (this.onCommit) this.onCommit(count, previous);
    }
  }

  _progress(now) {
    const required = this.committed === 0 ? this.holdMs : this.exitHoldMs;
    return clamp((now - this.candidateSince) / required, 0, 1);
  }

  /** Sin manos: se conserva el último modo confirmado y se reinicia el candidato. */
  _decay(now) {
    this.candidate = null;
    this.candidateHits = 0;
    this.candidateTotal = 0;
    this.candidateSince = now;
    this.holdProgress = 0;
    this.raw = null;
    this.confidence = 0;
  }

  get mode() { return MODE_BY_FINGERS[this.committed] ?? 'particles'; }
}

/**
 * Mapea la separación índice–medio a h con escala logarítmica.
 * Cerrar los dedos → h → 0, que es justamente la idea educativa del límite.
 * Se eligió la separación entre dedos (y no el pellizco) porque mantiene los
 * dos dedos extendidos: el conteo del gesto no se rompe mientras se ajusta h.
 */
export function spreadToH(spread, { min = 0.01, max = 2, lo = 0.16, hi = 1.15 } = {}) {
  const t = clamp((spread - lo) / (hi - lo), 0, 1);
  const logH = Math.log10(min) + t * (Math.log10(max) - Math.log10(min));
  // El redondeo de pow/log puede devolver 1.9999999999999998 en el extremo:
  // se recorta para garantizar el rango exacto que promete la función.
  return clamp(Math.pow(10, logH), min, max);
}

/** Posición horizontal de la mano → x₀, usando el 80 % central del encuadre. */
export function palmToX0(nx, view, invert = false) {
  const t = clamp((nx - 0.1) / 0.8, 0, 1);
  const u = invert ? 1 - t : t;
  return view.xMin + u * (view.xMax - view.xMin);
}
