/**
 * Explicaciones en español generadas a partir de los valores YA calculados
 * por el motor matemático. Sin IA y sin plantillas vacías: cada frase usa los
 * números reales del estado actual.
 */

import { fmtNum, fmtSigned } from './mathEngine.js';

const T = (v) => fmtNum(v, 3);
/** Para sustraendos: escribe "− (−2)" en lugar del ambiguo "− −2". */
const S = (v) => fmtSigned(v, 3);

/** Describe qué significa el signo de una pendiente. */
function slopeMeaning(m) {
  if (!Number.isFinite(m)) return 'En este punto la función no tiene una pendiente definida.';
  if (Math.abs(m) < 1e-9) return 'Al ser cero, la recta tangente es horizontal: en ese instante la función no crece ni decrece. Suele indicar un máximo, un mínimo o un punto de inflexión con tangente horizontal.';
  const dir = m > 0 ? 'crece' : 'decrece';
  const mag = Math.abs(m);
  const speed = mag > 3 ? 'muy rápido' : mag > 1 ? 'rápido' : mag > 0.3 ? 'de forma moderada' : 'muy lentamente';
  return `Como la pendiente es ${m > 0 ? 'positiva' : 'negativa'}, la función ${dir} ${speed} en ese punto: si avanzás 1 unidad en x, y cambia aproximadamente ${T(m)} unidades.`;
}

export function explainSlope(state) {
  const { engine, x0 } = state;
  const y0 = engine.f(x0);
  const m = engine.df(x0);

  if (!Number.isFinite(y0)) {
    return {
      title: 'Pendiente',
      body: `La función no está definida en x = ${T(x0)}, así que no existe un punto donde apoyar la recta tangente. Movés la mano (o el deslizador de x₀) hacia una zona del dominio para volver a verla.`,
    };
  }

  if (engine.isLinear) {
    const { m: mm, b } = engine.linear;
    return {
      title: 'Pendiente de una recta',
      body: `Esta función es una recta de la forma y = mx + b, con m = ${T(mm)} y b = ${T(b)}. `
        + `En una recta la pendiente es la misma en todos sus puntos: vale ${T(mm)} tanto en x = ${T(x0)} como en cualquier otro lugar. `
        + `${slopeMeaning(mm)} Por eso la recta tangente coincide exactamente con la función.`,
    };
  }

  return {
    title: 'Pendiente en un punto',
    body: `La pendiente indica qué tan rápido cambia la función en un punto concreto. Para una curva se calcula con la derivada: m = f′(x₀). `
      + `En x₀ = ${T(x0)} el punto de la curva es P(${T(x0)}, ${T(y0)}) y la pendiente vale f′(${T(x0)}) = ${T(m)}. `
      + `${slopeMeaning(m)} La recta que ves tocando la curva en P es la recta tangente: es la recta que mejor aproxima a la función cerca de ese punto.`,
  };
}

export function explainQuotient(state) {
  const { engine, x0, h } = state;
  const q = engine.differenceQuotient(x0, h);

  if (!Number.isFinite(q.fx0)) {
    return {
      title: 'Cociente incremental',
      body: `La función no está definida en x₀ = ${T(x0)}, por lo que no se puede formar el cociente incremental desde ese punto.`,
    };
  }
  if (!Number.isFinite(q.fx0h)) {
    return {
      title: 'Cociente incremental',
      body: `El segundo punto, x₀ + h = ${T(x0 + h)}, cae fuera del dominio de la función. Achicá h con los dedos (o con el deslizador) hasta que ambos puntos existan.`,
    };
  }

  const err = Math.abs(q.value - q.exact);
  const closeness = !Number.isFinite(q.exact) ? ''
    : err < 1e-3
      ? ` Con este h tan chico el cociente (${T(q.value)}) ya casi no se distingue de la derivada exacta (${T(q.exact)}): la recta secante se apoya sobre la tangente.`
      : err < 0.5
        ? ` El cociente vale ${T(q.value)} y la derivada exacta es ${T(q.exact)}: la diferencia es de ${T(err)}. Achicá h y verás cómo esa diferencia se reduce.`
        : ` Con h = ${T(h)} el cociente da ${T(q.value)}, todavía lejos de la derivada exacta f′(${T(x0)}) = ${T(q.exact)}. Cerrá los dedos para achicar h.`;

  return {
    title: 'Cociente incremental',
    body: `El cociente incremental calcula la pendiente de la recta secante que une dos puntos de la curva: `
      + `P(${T(x0)}, ${T(q.fx0)}) y Q(${T(x0 + h)}, ${T(q.fx0h)}). `
      + `Se obtiene dividiendo cuánto subió la función por cuánto avanzamos en x: [f(x₀+h) − f(x₀)] / h = [${T(q.fx0h)} − ${S(q.fx0)}] / ${T(h)} = ${T(q.value)}. `
      + `Cuando h se aproxima a cero, Q se desliza hacia P y la secante se convierte en la tangente: ese límite es, exactamente, la derivada.${closeness}`,
  };
}

export function explainDerivatives(state) {
  const { engine, x0 } = state;
  const y = engine.f(x0), d1 = engine.df(x0), d2 = engine.d2f(x0);

  const growth = !Number.isFinite(d1) ? 'no está definida en este punto'
    : Math.abs(d1) < 1e-9 ? 'vale 0, así que la función tiene tangente horizontal aquí'
      : d1 > 0 ? `es positiva (${T(d1)}), así que la función está creciendo`
        : `es negativa (${T(d1)}), así que la función está decreciendo`;

  const concav = !Number.isFinite(d2) ? 'no está definida en este punto'
    : Math.abs(d2) < 1e-9 ? 'vale 0: puede haber un cambio de concavidad (punto de inflexión)'
      : d2 > 0 ? `es positiva (${T(d2)}), así que la curva es cóncava hacia arriba, con forma de taza`
        : `es negativa (${T(d2)}), así que la curva es cóncava hacia abajo, con forma de campana`;

  const combo = (Number.isFinite(d1) && Number.isFinite(d2) && Math.abs(d1) < 1e-7)
    ? (d2 > 1e-9 ? ' Como f′ = 0 y f″ > 0, en este punto hay un mínimo local.'
      : d2 < -1e-9 ? ' Como f′ = 0 y f″ < 0, en este punto hay un máximo local.' : '')
    : '';

  const note = engine.derivativeMode === 'numeric'
    ? ' Nota: esta función no admite derivación simbólica, por lo que las derivadas se calculan numéricamente con diferencias centradas.'
    : '';

  return {
    title: 'Primera y segunda derivada',
    body: `La primera derivada f′(x) describe la tasa de cambio de la función: dice hacia dónde y con qué rapidez se mueve. `
      + `En x₀ = ${T(x0)}, f(x₀) = ${T(y)} y f′(x₀) ${growth}. `
      + `La segunda derivada f″(x) mide cómo cambia esa tasa y permite analizar la concavidad. Aquí f″(x₀) ${concav}.${combo}${note}`,
  };
}

export function explainAnalysis(state) {
  const { engine, analysis } = state;
  if (!analysis) return { title: 'Análisis completo', body: 'Calculando el análisis…' };

  const parts = [];
  parts.push(`Este análisis se calcula numéricamente sobre el intervalo visible x ∈ [${T(analysis.range[0])}, ${T(analysis.range[1])}]; si movés o alejás la gráfica, se recalcula.`);

  if (analysis.roots.length) {
    const list = analysis.roots.slice(0, 6).map((r) => `x = ${T(r.x)}`).join(', ');
    parts.push(`Las raíces son los puntos donde la curva corta el eje X, es decir donde f(x) = 0: ${list}${analysis.roots.length > 6 ? ' y algunas más' : ''}.`);
  } else {
    parts.push('En este intervalo la curva no corta el eje X, así que no hay raíces reales visibles.');
  }

  if (analysis.critical.length) {
    const maxs = analysis.critical.filter((c) => c.kind === 'máximo');
    const mins = analysis.critical.filter((c) => c.kind === 'mínimo');
    let s = 'Los puntos críticos son aquellos donde f′(x) = 0, es decir donde la tangente queda horizontal. ';
    if (maxs.length) s += `Hay ${maxs.length === 1 ? 'un máximo' : `${maxs.length} máximos`} en ${maxs.slice(0, 4).map((c) => `x = ${T(c.x)}`).join(', ')}. `;
    if (mins.length) s += `Hay ${mins.length === 1 ? 'un mínimo' : `${mins.length} mínimos`} en ${mins.slice(0, 4).map((c) => `x = ${T(c.x)}`).join(', ')}. `;
    s += 'Para distinguirlos se mira el signo de f″: positiva indica mínimo y negativa, máximo.';
    parts.push(s);
  } else {
    parts.push('No se encontraron puntos críticos: la función no cambia de creciente a decreciente en este intervalo.');
  }

  if (analysis.inflections.length) {
    parts.push(`Los puntos de inflexión son donde la curva cambia de concavidad (f″ cambia de signo): ${analysis.inflections.slice(0, 4).map((p) => `x = ${T(p.x)}`).join(', ')}.`);
  }

  if (analysis.poles.length) {
    parts.push(`La función tiene ${analysis.poles.length === 1 ? 'una asíntota vertical' : `${analysis.poles.length} asíntotas verticales`} en ${analysis.poles.slice(0, 4).map((p) => `x = ${T(p)}`).join(', ')}: al acercarse a esos valores la función se dispara y no está definida.`);
  }

  return { title: 'Análisis completo', body: parts.join(' ') };
}

export function explainParticles(state) {
  return {
    title: 'Campo de partículas',
    body: `Este modo mantiene la interacción original del proyecto: las partículas dibujan tu función y además la hacen girar como un sólido de revolución alrededor del eje X. `
      + `Cerrá el puño y movelo para empujarlas y generar ondas. La función ${state.engine?.ready ? `f(x) = ${state.engine.plain}` : ''} no cambia: sólo estás jugando con su representación.`,
  };
}

export function explainVisual(state) {
  const { engine } = state;
  return {
    title: 'Visualización',
    body: `Modo limpio: se ocultan los paneles para dejar la gráfica y las partículas en primer plano. `
      + `${engine?.ready ? `Estás viendo f(x) = ${engine.plain}.` : ''} `
      + `Podés hacer zoom con la rueda del mouse o con el pellizco de la mano izquierda, y arrastrar para desplazarte.`,
  };
}

const BY_MODE = {
  particles: explainParticles,
  slope: explainSlope,
  quotient: explainQuotient,
  derivatives: explainDerivatives,
  analysis: explainAnalysis,
  visual: explainVisual,
};

export function explainFor(mode, state) {
  const fn = BY_MODE[mode] ?? explainParticles;
  try {
    return fn(state);
  } catch {
    return { title: 'Explicación', body: 'No se pudo generar la explicación para este estado.' };
  }
}
