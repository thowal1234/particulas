/**
 * Motor matemático determinista.
 *
 * Regla del proyecto: NINGÚN resultado matemático proviene de una IA.
 * Todo se calcula con math.js (simbólico) + métodos numéricos clásicos
 * (bisección, ternaria, diferencias centradas). La IA sólo explica lo que
 * este módulo ya calculó.
 *
 * Detalles verificados contra math.js 12.4.1:
 *   · sqrt(-1) devuelve un objeto Complex, NO NaN  → se descarta como fuera de dominio
 *   · 1/0 devuelve Infinity, no NaN                → se descarta como no finito
 *   · "x(x+1)" se parsea como LLAMADA A FUNCIÓN    → se corrige en el preprocesado
 *   · derivative() cuesta ~2,4 ms                  → se cachea, nunca se llama por frame
 *   · floor/sign/round/ceil/mod no son derivables  → respaldo numérico honesto
 */

const M = () => window.math;

/** Nombres que el usuario puede usar sin que se traten como variable libre. */
const CONSTANTS = new Set(['e', 'pi', 'PI', 'tau', 'phi', 'E']);

/** Funciones conocidas: si un identificador de esta lista precede a "(", es una llamada. */
const KNOWN_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sec', 'csc', 'cot',
  'asec', 'acsc', 'acot', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'sqrt', 'cbrt', 'nthRoot', 'exp', 'log', 'log2', 'log10', 'log1p',
  'abs', 'sign', 'floor', 'ceil', 'round', 'fix', 'mod', 'pow',
  'max', 'min', 'gamma', 'factorial', 'hypot', 'norm', 'square', 'cube'
]);

/** Alias en español y notación habitual de secundaria. */
const ALIASES = [
  [/\bsen\s*\(/gi, 'sin('],
  [/\btg\s*\(/gi, 'tan('],
  [/\bctg\s*\(/gi, 'cot('],
  [/\barcsen\s*\(/gi, 'asin('],
  [/\barctg\s*\(/gi, 'atan('],
  [/\bra[ií]z\s*\(/gi, 'sqrt('],
  [/\bln\s*\(/gi, 'log('],
];

const SUPERSCRIPTS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };

/**
 * Convierte cualquier valor devuelto por math.js a un número real utilizable.
 * Complejos, infinitos y booleanos se consideran "fuera de dominio" (NaN).
 */
export function toReal(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (v == null || typeof v === 'boolean') return NaN;
  if (typeof v === 'object') {
    // math.js Complex → sólo válido si la parte imaginaria es despreciable
    if (typeof v.re === 'number' && typeof v.im === 'number') {
      return Math.abs(v.im) < 1e-12 ? toReal(v.re) : NaN;
    }
    if (typeof v.toNumber === 'function') {
      try { return toReal(v.toNumber()); } catch { return NaN; }
    }
  }
  return NaN;
}

// ── Preprocesado de la entrada del usuario ────────────────────────────────────

export function normalizeInput(raw) {
  let s = String(raw ?? '');
  const notes = [];

  // Unicode → ASCII
  s = s.replace(/[−–—]/g, '-')
       .replace(/[×·∙*]/g, '*')
       .replace(/[÷]/g, '/')
       .replace(/[，]/g, ',')
       .replace(/√/g, 'sqrt')
       .replace(/π/g, 'pi')
       .replace(/[""]/g, '"');

  // Exponentes en superíndice: x²  →  x^2 ; x¹²  →  x^(12)
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (run) => {
    const digits = [...run].map((c) => SUPERSCRIPTS[c] ?? '').join('');
    return digits.length > 1 ? `^(${digits})` : `^${digits}`;
  });

  // Coma decimal entre dígitos: 2,5 → 2.5  (no toca separadores de argumentos)
  s = s.replace(/(\d),(\d)/g, '$1.$2');

  // Encabezado "f(x) =", "y =", "g(t) ="
  let declaredVar = null;
  const header = s.match(/^\s*([a-zA-Z]\w*)\s*\(\s*([a-zA-Z]\w*)\s*\)\s*=\s*/);
  if (header) {
    declaredVar = header[2];
    s = s.slice(header[0].length);
  } else {
    const simple = s.match(/^\s*([yfg])\s*=\s*/i);
    if (simple) s = s.slice(simple[0].length);
  }

  for (const [re, to] of ALIASES) s = s.replace(re, to);

  // Un identificador seguido de "(" que no es función conocida:
  //   · de una sola letra  → multiplicación implícita real:  x(x+1) → x*(x+1)
  //   · de varias letras   → casi siempre una función mal escrita: "fooo(x)"
  // math.js parsearía "x(x+1)" como llamada a función y fallaría al evaluar.
  const unknownFunctions = [];
  s = s.replace(/([A-Za-z_]\w*)\s*\(/g, (m0, name) => {
    if (KNOWN_FUNCTIONS.has(name)) return m0;
    if (name.length > 1 && !unknownFunctions.includes(name)) unknownFunctions.push(name);
    return `${name}*(`;
  });

  s = s.trim();
  return { expr: s, declaredVar, notes, unknownFunctions };
}

/** Propone la función conocida más parecida ("cosen" → "¿Quisiste decir cos?"). */
function suggestFunction(name) {
  const target = name.toLowerCase();
  let best = null, bestDistance = Infinity;
  for (const candidate of KNOWN_FUNCTIONS) {
    const d = editDistance(target, candidate.toLowerCase());
    if (d < bestDistance) { bestDistance = d; best = candidate; }
  }
  return (best && bestDistance <= Math.max(2, Math.floor(target.length / 2)))
    ? `¿Quisiste decir ${best}? `
    : '';
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,                                   // borrar
        prev[j - 1] + 1,                               // insertar
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),    // sustituir
      );
      diagonal = temp;
    }
  }
  return prev[b.length];
}

/** Variables libres reales (excluye nombres de función y constantes). */
function freeSymbols(node) {
  const found = new Set();
  node.traverse((n, path, parent) => {
    if (n.isSymbolNode && !(parent && parent.isFunctionNode && path === 'fn')) {
      if (!CONSTANTS.has(n.name)) found.add(n.name);
    }
  });
  return [...found];
}

/** Limpia el TeX de math.js, que emite `2~ x` y `{ x}`. */
function cleanTex(tex) {
  return String(tex)
    .replace(/~/g, '\\,')
    .replace(/\{\s+/g, '{')
    .replace(/\\cdot\\,/g, '\\cdot ');
}

// ── Núcleo ────────────────────────────────────────────────────────────────────

export class MathEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.ready = false;
    this.source = '';        // lo que escribió el usuario
    this.expr = '';          // expresión normalizada para math.js
    this.node = null;
    this._compiled = null;
    this._scope = { x: 0 };

    this.derivativeMode = 'symbolic'; // 'symbolic' | 'numeric'
    this.dNode = null; this._dCompiled = null;
    this.d2Node = null; this._d2Compiled = null;

    this.tex = ''; this.dTex = ''; this.d2Tex = '';
    this.plain = ''; this.dPlain = ''; this.d2Plain = '';
    this.isLinear = false;
    this.linear = null;      // {m, b} si la función es de la forma mx + b

    this._sampleCache = new Map();
    this._analysisCache = new Map();
  }

  /**
   * Valida y carga una expresión.
   * @returns {{ok:boolean, error?:string, hint?:string, note?:string}}
   */
  setExpression(raw) {
    const math = M();
    if (!math) return { ok: false, error: 'La librería matemática no se pudo cargar.', hint: 'Revisá tu conexión a internet y recargá la página.' };

    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return { ok: false, error: 'Escribí una función para comenzar.', hint: 'Por ejemplo: x^2 + 3*x - 4' };

    const { expr, declaredVar, unknownFunctions } = normalizeInput(trimmed);
    if (!expr) return { ok: false, error: 'No pudimos interpretar esta función.', hint: 'Escribí la parte derecha del igual, por ejemplo: x^2 + 3*x - 4' };

    if (unknownFunctions.length) {
      const name = unknownFunctions[0];
      return {
        ok: false,
        error: `No conocemos la función «${name}».`,
        hint: `${suggestFunction(name)}Disponibles: sin, cos, tan, sqrt, cbrt, log (natural), log10, exp, abs.`,
      };
    }

    let node;
    try {
      node = math.parse(expr);
    } catch (err) {
      return {
        ok: false,
        error: 'No pudimos interpretar esta función.',
        hint: this._syntaxHint(expr, err),
      };
    }

    // Resolver la variable: se admite una sola, y si no es x se renombra.
    let vars = freeSymbols(node);
    let note = null;
    if (vars.length > 1) {
      return {
        ok: false,
        error: `Hay más de una variable: ${vars.join(', ')}.`,
        hint: 'Esta herramienta trabaja con funciones de una variable. Usá sólo x.',
      };
    }
    if (vars.length === 1 && vars[0] !== 'x') {
      const other = vars[0];
      try {
        node = node.transform((n) => (n.isSymbolNode && n.name === other ? new math.SymbolNode('x') : n));
        note = `Se interpretó «${other}» como la variable x.`;
        if (declaredVar && declaredVar !== other) note = `Se interpretó «${other}» como la variable x.`;
      } catch {
        return { ok: false, error: `No pudimos interpretar la variable «${other}».`, hint: 'Usá x como variable.' };
      }
      vars = ['x'];
    }

    // Compilar y comprobar que evalúa a números reales en algún punto.
    let compiled;
    try {
      compiled = node.compile();
    } catch (err) {
      return { ok: false, error: 'No pudimos interpretar esta función.', hint: this._syntaxHint(expr, err) };
    }

    const scope = { x: 0 };
    let anyFinite = false;
    let firstError = null;
    for (const probe of [0, 1, 2, 0.5, -1, -2, 3.7, 10, -10, 0.1]) {
      scope.x = probe;
      try {
        if (Number.isFinite(toReal(compiled.evaluate(scope)))) { anyFinite = true; break; }
      } catch (err) { firstError = err; }
    }
    if (!anyFinite) {
      if (firstError) {
        return {
          ok: false,
          error: 'No pudimos evaluar esta función.',
          hint: /is not a function/.test(firstError.message)
            ? 'Para multiplicar usá *, por ejemplo 2*x en lugar de 2x(...).'
            : 'Revisá los nombres de las funciones. Disponibles: sin, cos, tan, sqrt, cbrt, log (natural), log10, exp, abs.',
        };
      }
      return {
        ok: false,
        error: 'La función no toma valores reales en ningún punto de prueba.',
        hint: 'Verificá el dominio: por ejemplo sqrt(x) sólo existe para x ≥ 0.',
      };
    }

    // Estado válido → confirmar
    this.reset();
    this.ready = true;
    this.source = trimmed;
    this.expr = node.toString();
    this.node = node;
    this._compiled = compiled;
    this.plain = this.expr;
    this.tex = cleanTex(node.toTex());

    this._buildDerivatives();
    this._detectLinear();

    return { ok: true, note };
  }

  _syntaxHint(expr, err) {
    const msg = String(err?.message || '');
    const opens = (expr.match(/\(/g) || []).length;
    const closes = (expr.match(/\)/g) || []).length;
    if (opens !== closes) return `Faltan paréntesis: hay ${opens} de apertura y ${closes} de cierre.`;
    if (/Value expected/i.test(msg)) return 'Parece que falta un término. Usá el formato: x^2 + 3*x - 4';
    if (/Unexpected/i.test(msg)) return 'Hay un símbolo que no reconocemos. Usá + - * / ^ y paréntesis.';
    return 'Usá el formato: x^2 + 3*x - 4  ·  Para potencias usá ^ y para multiplicar usá *';
  }

  /** Derivadas simbólicas con respaldo numérico honesto si math.js no puede. */
  _buildDerivatives() {
    const math = M();
    try {
      const d1 = math.derivative(this.node, 'x');
      const d1s = this._trySimplify(d1);
      const d2 = math.derivative(d1s, 'x');
      const d2s = this._trySimplify(d2);

      this.dNode = d1s; this._dCompiled = d1s.compile();
      this.d2Node = d2s; this._d2Compiled = d2s.compile();
      this.dPlain = d1s.toString(); this.d2Plain = d2s.toString();
      this.dTex = cleanTex(d1s.toTex()); this.d2Tex = cleanTex(d2s.toTex());
      this.derivativeMode = 'symbolic';
    } catch {
      // floor, sign, round, mod, gamma… → diferencias centradas
      this.derivativeMode = 'numeric';
      this.dNode = this.d2Node = null;
      this._dCompiled = this._d2Compiled = null;
      this.dPlain = this.d2Plain = null;
      this.dTex = this.d2Tex = null;
    }
  }

  _trySimplify(node) {
    try { return M().simplify(node); } catch { return node; }
  }

  /** Detecta si f es exactamente mx + b (para el modo PENDIENTE). */
  _detectLinear() {
    if (this.derivativeMode !== 'symbolic') { this.isLinear = false; return; }
    // f es lineal ⟺ f'' ≡ 0 y f' es constante
    const samples = [-7.3, -2.1, 0, 1.7, 4.9, 11.2];
    let m = null;
    for (const x of samples) {
      const d1 = this.df(x);
      const d2 = this.d2f(x);
      if (!Number.isFinite(d1) || !Number.isFinite(d2)) { this.isLinear = false; return; }
      if (Math.abs(d2) > 1e-9) { this.isLinear = false; return; }
      if (m === null) m = d1;
      else if (Math.abs(d1 - m) > 1e-9) { this.isLinear = false; return; }
    }
    const b = this.f(0);
    if (m === null || !Number.isFinite(b)) { this.isLinear = false; return; }
    this.isLinear = true;
    this.linear = { m: roundNoise(m), b: roundNoise(b) };
  }

  // ── Evaluación ──────────────────────────────────────────────────────────────

  f(x) {
    if (!this._compiled) return NaN;
    this._scope.x = x;
    try { return toReal(this._compiled.evaluate(this._scope)); } catch { return NaN; }
  }

  df(x) {
    if (this._dCompiled) {
      this._scope.x = x;
      try {
        const v = toReal(this._dCompiled.evaluate(this._scope));
        if (Number.isFinite(v)) return v;
      } catch { /* cae al método numérico */ }
    }
    return this.numericDf(x);
  }

  d2f(x) {
    if (this._d2Compiled) {
      this._scope.x = x;
      try {
        const v = toReal(this._d2Compiled.evaluate(this._scope));
        if (Number.isFinite(v)) return v;
      } catch { /* cae al método numérico */ }
    }
    return this.numericD2f(x);
  }

  /** Diferencia centrada con extrapolación de Richardson (orden 4). */
  numericDf(x) {
    const h = Math.max(1e-6, Math.abs(x) * 1e-6) * 100;
    const d = (s) => {
      const a = this.f(x + s), b = this.f(x - s);
      return (Number.isFinite(a) && Number.isFinite(b)) ? (a - b) / (2 * s) : NaN;
    };
    const d1 = d(h), d2 = d(h / 2);
    if (Number.isFinite(d1) && Number.isFinite(d2)) return (4 * d2 - d1) / 3;
    if (Number.isFinite(d2)) return d2;
    return d1;
  }

  numericD2f(x) {
    const h = Math.max(1e-4, Math.abs(x) * 1e-4) * 10;
    const a = this.f(x + h), b = this.f(x), c = this.f(x - h);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return NaN;
    return (a - 2 * b + c) / (h * h);
  }

  /** Cociente incremental [f(x₀+h) − f(x₀)] / h. */
  differenceQuotient(x0, h) {
    const fa = this.f(x0);
    const fb = this.f(x0 + h);
    const value = (Number.isFinite(fa) && Number.isFinite(fb) && h !== 0) ? (fb - fa) / h : NaN;
    return { x0, h, fx0: fa, fx0h: fb, value, exact: this.df(x0) };
  }

  // ── Muestreo de curvas ──────────────────────────────────────────────────────

  /**
   * Muestrea f, f' o f'' sobre un intervalo. Resultado cacheado por rango.
   * @param {'f'|'df'|'d2f'} which
   * @returns {{xs:Float64Array, ys:Float64Array, n:number}}
   */
  sample(which, xMin, xMax, n) {
    const key = `${which}|${xMin.toFixed(6)}|${xMax.toFixed(6)}|${n}`;
    const hit = this._sampleCache.get(key);
    if (hit) return hit;

    const fn = which === 'f' ? (x) => this.f(x)
      : which === 'df' ? (x) => this.df(x)
        : (x) => this.d2f(x);

    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const step = (xMax - xMin) / (n - 1);
    for (let i = 0; i < n; i++) {
      const x = xMin + i * step;
      xs[i] = x;
      ys[i] = fn(x);
    }
    const out = { xs, ys, n };
    if (this._sampleCache.size > 24) this._sampleCache.clear();
    this._sampleCache.set(key, out);
    return out;
  }

  /**
   * Parte una curva muestreada en tramos continuos.
   * Corta en valores no finitos y en saltos mayores que `maxJump`
   * (asíntotas verticales: 1/x, tan(x)…).
   */
  static segments(xs, ys, maxJump) {
    const out = [];
    let cur = null;
    for (let i = 0; i < ys.length; i++) {
      const y = ys[i];
      if (!Number.isFinite(y)) { cur = null; continue; }
      if (cur && Math.abs(y - cur.ys[cur.ys.length - 1]) > maxJump) cur = null;
      if (!cur) { cur = { xs: [], ys: [] }; out.push(cur); }
      cur.xs.push(xs[i]);
      cur.ys.push(y);
    }
    return out.filter((s) => s.xs.length > 1);
  }

  // ── Búsqueda de raíces ──────────────────────────────────────────────────────

  /**
   * Raíces de `fn` en [a,b] por cambio de signo + bisección, más mínimos
   * tangentes de |fn| (raíces dobles como x²).
   * Rechaza cruces provocados por asíntotas (1/x en 0).
   */
  _rootsOf(fn, a, b, samples = 1400) {
    const roots = [];
    const step = (b - a) / samples;
    let prevX = a, prevY = fn(a);

    const accept = (r) => {
      if (!Number.isFinite(r) || r < a - 1e-9 || r > b + 1e-9) return;
      const v = fn(r);
      if (!Number.isFinite(v) || Math.abs(v) > 1e-6) return;   // asíntota, no raíz
      const eps = Math.max(1e-7, Math.abs(r) * 1e-7);
      if (!Number.isFinite(fn(r - eps)) || !Number.isFinite(fn(r + eps))) return;
      if (roots.some((q) => Math.abs(q - r) < Math.max(1e-6, Math.abs(r) * 1e-9 + 1e-6))) return;
      roots.push(r);
    };

    for (let i = 1; i <= samples; i++) {
      const x = a + i * step;
      const y = fn(x);
      if (Number.isFinite(prevY) && Number.isFinite(y)) {
        if (prevY === 0) accept(prevX);
        else if (y === 0) accept(x);
        else if ((prevY < 0) !== (y < 0)) accept(bisect(fn, prevX, x));
        else if (i >= 2) {
          // posible raíz tangente: mínimo local de |f| muy próximo a cero
          const yPrev2 = fn(x - 2 * step);
          if (Number.isFinite(yPrev2) && Math.abs(prevY) < Math.abs(yPrev2) && Math.abs(prevY) < Math.abs(y)) {
            const scale = Math.max(1, Math.abs(yPrev2), Math.abs(y));
            if (Math.abs(prevY) < 1e-2 * scale) accept(minimizeAbs(fn, x - 2 * step, x));
          }
        }
      }
      prevX = x; prevY = y;
    }
    return roots.sort((p, q) => p - q);
  }

  // ── Análisis completo ───────────────────────────────────────────────────────

  /**
   * Análisis numérico sobre el intervalo visible. Todo lo que no se puede
   * determinar con certeza se devuelve como null y la interfaz lo informa.
   */
  analyze(xMin, xMax) {
    const key = `${xMin.toFixed(4)}|${xMax.toFixed(4)}`;
    const hit = this._analysisCache.get(key);
    if (hit) return hit;

    const f = (x) => this.f(x);
    const df = (x) => this.df(x);
    const d2f = (x) => this.d2f(x);

    // 1) Dominio y polos
    const N = 2400;
    const step = (xMax - xMin) / (N - 1);
    const defined = new Uint8Array(N);
    const vals = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const x = xMin + i * step;
      const y = f(x);
      vals[i] = y;
      defined[i] = Number.isFinite(y) ? 1 : 0;
    }

    const at = (i) => xMin + i * step;
    const gaps = [];         // intervalos donde f no está definida
    for (let i = 0; i < N;) {
      if (defined[i]) { i++; continue; }
      let j = i;
      while (j < N && !defined[j]) j++;
      // Frontera izquierda: transición definida(i−1) → indefinida(i)
      const left = i === 0 ? xMin : refineBoundary(f, at(i), at(i - 1));
      // Frontera derecha: transición indefinida(j−1) → definida(j)
      const right = j >= N ? xMax : refineBoundary(f, at(j - 1), at(j));
      gaps.push({ from: left, to: right, openLeft: i === 0, openRight: j >= N });
      i = j;
    }

    // Polos (asíntotas verticales). Dos patrones entre muestras contiguas:
    //   A) cambio de signo con AMBOS valores muy grandes respecto de la escala típica  → 1/x, tan(x)
    //   B) explosión del mismo signo muy por encima de la escala típica                → 1/x²
    // Un cruce por cero normal tiene valores pequeños a ambos lados y nunca dispara A.
    const scale = robustScale(vals);
    const signFlipLimit = 20 * scale;
    const blowUpLimit = 1e4 * scale;
    const flagged = [];
    for (let i = 1; i < N; i++) {
      if (!defined[i] || !defined[i - 1]) continue;
      const a = vals[i - 1], b = vals[i];
      const lo = Math.min(Math.abs(a), Math.abs(b));
      const hi = Math.max(Math.abs(a), Math.abs(b));
      const signFlip = (a < 0) !== (b < 0) && lo > signFlipLimit;
      if (signFlip || hi > blowUpLimit) flagged.push(i);
    }

    // Cerca de un polo se disparan varios pares contiguos. Se agrupan en una
    // sola región y se busca el máximo de |f| sobre ella completa: buscar dentro
    // de cada par por separado daría varias estimaciones desplazadas del polo real.
    const poles = [];
    for (let k = 0; k < flagged.length;) {
      let end = k;
      while (end + 1 < flagged.length && flagged[end + 1] - flagged[end] <= 3) end++;
      const p = locatePole(f, at(flagged[k] - 1), at(flagged[end]));
      if (Number.isFinite(p) && !poles.some((q) => Math.abs(q - p) < step * 4)) poles.push(p);
      k = end + 1;
    }

    // 2) Raíces, puntos críticos, inflexiones
    const roots = this._rootsOf(f, xMin, xMax);
    const criticalXs = this._rootsOf(df, xMin, xMax);
    const inflectionXs = this._rootsOf(d2f, xMin, xMax);

    const critical = criticalXs.map((x) => {
      const y = f(x);
      const s = d2f(x);
      let kind = 'indeterminado';
      if (Number.isFinite(s) && Math.abs(s) > 1e-7) kind = s > 0 ? 'mínimo' : 'máximo';
      else {
        const eps = Math.max(1e-4, Math.abs(x) * 1e-4);
        const l = df(x - eps), r = df(x + eps);
        if (Number.isFinite(l) && Number.isFinite(r)) {
          if (l < 0 && r > 0) kind = 'mínimo';
          else if (l > 0 && r < 0) kind = 'máximo';
          else kind = 'punto de silla';
        }
      }
      return { x, y, kind };
    }).filter((p) => Number.isFinite(p.y));

    const inflections = inflectionXs.map((x) => ({ x, y: f(x) }))
      .filter((p) => {
        if (!Number.isFinite(p.y)) return false;
        const eps = Math.max(1e-4, Math.abs(p.x) * 1e-4);
        const l = d2f(p.x - eps), r = d2f(p.x + eps);
        return Number.isFinite(l) && Number.isFinite(r) && (l < 0) !== (r < 0);
      });

    // 3) Intervalos de monotonía y concavidad
    const breaks = [xMin, ...criticalXs, ...poles, ...gaps.flatMap((g) => [g.from, g.to]), xMax]
      .filter((v) => Number.isFinite(v) && v >= xMin && v <= xMax)
      .sort((a, b) => a - b);
    const monotonic = buildIntervals(breaks, df, ['creciente', 'decreciente']);

    const breaks2 = [xMin, ...inflectionXs, ...poles, ...gaps.flatMap((g) => [g.from, g.to]), xMax]
      .filter((v) => Number.isFinite(v) && v >= xMin && v <= xMax)
      .sort((a, b) => a - b);
    const concavity = buildIntervals(breaks2, d2f, ['cóncava hacia arriba', 'cóncava hacia abajo']);

    const yIntercept = (xMin <= 0 && xMax >= 0) ? f(0) : NaN;

    const result = {
      range: [xMin, xMax],
      domain: describeDomain(gaps, poles, xMin, xMax),
      domainGaps: gaps,
      poles,
      roots: roots.map((x) => ({ x, y: 0 })),
      yIntercept: Number.isFinite(yIntercept) ? yIntercept : null,
      critical,
      inflections,
      monotonic,
      concavity,
      derivativeMode: this.derivativeMode,
    };

    if (this._analysisCache.size > 12) this._analysisCache.clear();
    this._analysisCache.set(key, result);
    return result;
  }
}

// ── Auxiliares numéricos ──────────────────────────────────────────────────────

function bisect(fn, a, b, iterations = 80) {
  let fa = fn(a);
  if (!Number.isFinite(fa)) return NaN;
  for (let i = 0; i < iterations; i++) {
    const m = (a + b) / 2;
    const fm = fn(m);
    if (!Number.isFinite(fm)) return NaN;
    if (fm === 0) return m;
    if ((fa < 0) !== (fm < 0)) { b = m; } else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}

/** Búsqueda ternaria del mínimo de |fn| en [a,b] (raíces tangentes). */
function minimizeAbs(fn, a, b, iterations = 90) {
  for (let i = 0; i < iterations; i++) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    const v1 = Math.abs(fn(m1)), v2 = Math.abs(fn(m2));
    if (!Number.isFinite(v1) || !Number.isFinite(v2)) return NaN;
    if (v1 < v2) b = m2; else a = m1;
  }
  return (a + b) / 2;
}

/**
 * Afina la frontera del dominio por bisección entre un punto donde f NO está
 * definida y otro donde SÍ lo está. Converge sobre el lado definido.
 */
function refineBoundary(f, undefinedX, definedX) {
  let lo = undefinedX, hi = definedX;
  for (let i = 0; i < 70; i++) {
    const m = (lo + hi) / 2;
    if (Number.isFinite(f(m))) hi = m; else lo = m;
  }
  return snapToRound(hi, 1e-6);
}

/** Localiza el polo maximizando |f| por búsqueda ternaria (indefinido = ∞). */
function locatePole(f, a, b) {
  const mag = (x) => { const v = f(x); return Number.isFinite(v) ? Math.abs(v) : Infinity; };
  let lo = a, hi = b;
  for (let i = 0; i < 80; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (mag(m1) > mag(m2)) hi = m2; else lo = m1;
  }
  return snapToRound((lo + hi) / 2, 1e-5);
}

/** Redondea a entero si está lo bastante cerca (evita 1.0000000003 y −4e−17). */
function snapToRound(v, tol) {
  if (!Number.isFinite(v)) return v;
  const r = Math.round(v);
  return Math.abs(v - r) < tol ? r : v;
}

/** Escala típica de la función, robusta frente a asíntotas. */
function robustScale(vals) {
  const finite = [];
  for (let i = 0; i < vals.length; i++) if (Number.isFinite(vals[i])) finite.push(Math.abs(vals[i]));
  if (!finite.length) return 1;
  finite.sort((a, b) => a - b);
  return Math.max(1e-6, finite[Math.floor(finite.length * 0.75)]);
}

function buildIntervals(breaks, testFn, [positiveLabel, negativeLabel]) {
  const out = [];
  for (let i = 0; i < breaks.length - 1; i++) {
    const a = breaks[i], b = breaks[i + 1];
    if (!(b - a > 1e-6)) continue;
    let v = NaN;
    // Probar varios puntos internos: el punto medio puede caer en un hueco
    for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      v = testFn(a + (b - a) * t);
      if (Number.isFinite(v) && Math.abs(v) > 1e-12) break;
    }
    if (!Number.isFinite(v)) continue;
    const label = v > 0 ? positiveLabel : negativeLabel;
    const last = out[out.length - 1];
    if (last && last.label === label && Math.abs(last.to - a) < 1e-6) last.to = b;
    else out.push({ from: a, to: b, label });
  }
  return out;
}

function describeDomain(gaps, poles, xMin, xMax) {
  const excluded = [];
  for (const g of gaps) excluded.push({ from: g.from, to: g.to });
  for (const p of poles) excluded.push({ from: p, to: p });
  if (!excluded.length) return { text: 'ℝ (todos los reales del rango visible)', excluded: [] };

  excluded.sort((a, b) => a.from - b.from);
  const parts = [];
  let cursor = xMin;
  for (const ex of excluded) {
    if (ex.from > cursor + 1e-9) parts.push([cursor, ex.from]);
    cursor = Math.max(cursor, ex.to);
  }
  if (cursor < xMax - 1e-9) parts.push([cursor, xMax]);

  const text = parts.length
    ? parts.map(([a, b], i) => {
      const left = (i === 0 && Math.abs(a - xMin) < 1e-9) ? '(−∞' : `(${fmtNum(a)}`;
      const right = (i === parts.length - 1 && Math.abs(b - xMax) < 1e-9) ? '+∞)' : `${fmtNum(b)})`;
      return `${left}, ${right}`;
    }).join(' ∪ ')
    : 'no definida en el rango visible';
  return { text, excluded };
}

export function fmtNum(v, digits = 4) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '+∞' : '−∞';
  const r = roundNoise(v);
  if (Math.abs(r) < 1e-12) return '0';
  if (Math.abs(r) >= 1e6 || (Math.abs(r) < 1e-4 && r !== 0)) return r.toExponential(2).replace('e', '·10^');
  const s = r.toFixed(digits);
  return s.replace(/\.?0+$/, '').replace('-', '−');
}

/**
 * Envuelve los negativos en paréntesis para escribir restas correctamente:
 * "−1,974 − (−2)" en lugar del ambiguo "−1,974 − −2".
 */
export function fmtSigned(v, digits = 4) {
  const s = fmtNum(v, digits);
  return s.startsWith('−') ? `(${s})` : s;
}

/** Limpia ruido de punto flotante: 1.9999999999997 → 2 */
export function roundNoise(v) {
  if (!Number.isFinite(v)) return v;
  const r = Math.round(v);
  if (Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(v))) return r;
  const r4 = Math.round(v * 1e4) / 1e4;
  if (Math.abs(v - r4) < 1e-10 * Math.max(1, Math.abs(v))) return r4;
  return v;
}
