/**
 * Detección de capacidades del dispositivo.
 *
 * Un teléfono no puede con los mismos parámetros que una notebook: MediaPipe
 * Hands con modelComplexity 1 y 20.000 partículas a devicePixelRatio 3 lo
 * funden. Acá se decide el presupuesto UNA vez, y a partir de ahí la calidad
 * adaptativa de main.js ajusta el resto según los fps reales.
 */

function coarsePointer() {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

function shortestSide() {
  const w = window.screen?.width ?? window.innerWidth;
  const h = window.screen?.height ?? window.innerHeight;
  return Math.min(w, h);
}

const touch = coarsePointer() || (navigator.maxTouchPoints ?? 0) > 1;
const small = shortestSide() <= 820;
const phone = touch && shortestSide() <= 500;
const mobile = touch && small;

// Señales de gama baja. No están en todos los navegadores, así que sólo se
// usan para bajar el presupuesto, nunca para subirlo.
const cores = navigator.hardwareConcurrency ?? 4;
const memory = navigator.deviceMemory ?? 4;
const weak = cores <= 4 || memory <= 4;

export const device = {
  touch,
  mobile,
  phone,
  small,

  /** Píxeles físicos por píxel CSS. En móvil el DPR real (3) es inasumible. */
  maxDpr: mobile ? 1.25 : 1.75,

  /** Escalera de calidad de partículas, de mayor a menor. */
  qualityLevels: mobile
    ? (weak ? [4000, 2600, 1800, 1200] : [7000, 4500, 3000, 1800])
    : [20000, 13000, 8000, 4500],

  /** Complejidad del modelo de MediaPipe: 0 es notablemente más rápido. */
  handModelComplexity: mobile ? 0 : 1,

  /** Frecuencia de detección de manos, desacoplada del render. */
  detectionFps: mobile ? 18 : 30,

  /** Resolución de captura pedida a la cámara. */
  captureSize: mobile ? { width: 640, height: 480 } : { width: 1280, height: 720 },

  /** Ancho inicial del encuadre en unidades matemáticas. */
  defaultSpanX: phone ? 13 : 20,

  /** Puntos de muestreo de las curvas de la gráfica. */
  maxCurveSamples: mobile ? 900 : 2400,

  /** Puntos de la malla que reparte las partículas sobre la curva. */
  curveGridSamples: mobile ? 480 : 900,
};
