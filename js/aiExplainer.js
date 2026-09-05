/**
 * Explicación opcional con IA.
 *
 * REGLA DE SEGURIDAD: nunca hay una API key en este archivo ni en ningún otro
 * del frontend. GitHub Pages sirve archivos estáticos y públicos, así que
 * cualquier clave incrustada quedaría expuesta. Este módulo sólo habla con un
 * endpoint propio (serverless) que guarda la clave del lado del servidor.
 * Ver api/explain.js y netlify/functions/explain.js.
 *
 * REGLA MATEMÁTICA: el payload lleva los resultados YA calculados por
 * mathEngine.js. La IA únicamente los redacta; nunca calcula ni corrige.
 * Si no hay endpoint configurado, la aplicación sigue funcionando al 100 %
 * con las explicaciones deterministas de explanations.js.
 */

const STORAGE_KEY = 'mph.aiEndpoint';

export class AiExplainer {
  constructor() {
    this.endpoint = this._load();
    this.pending = false;
  }

  _load() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
  }

  get configured() { return !!this.endpoint; }

  setEndpoint(url) {
    const clean = String(url || '').trim();
    if (clean && !/^https?:\/\//i.test(clean)) {
      return { ok: false, error: 'La dirección debe empezar con http:// o https://' };
    }
    this.endpoint = clean;
    try {
      if (clean) localStorage.setItem(STORAGE_KEY, clean);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* modo privado: queda sólo en memoria */ }
    return { ok: true };
  }

  /**
   * Construye el payload. Todos los valores numéricos provienen del motor.
   */
  static buildPayload(state) {
    const { engine, mode, x0, h, analysis } = state;
    const num = (v) => (Number.isFinite(v) ? Number(v.toFixed(6)) : null);

    const payload = {
      function: engine.plain,
      functionTex: engine.tex,
      operation: mode,
      derivativeMode: engine.derivativeMode,
      x0: num(x0),
      values: {
        'f(x0)': num(engine.f(x0)),
        "f'(x0)": num(engine.df(x0)),
        "f''(x0)": num(engine.d2f(x0)),
      },
    };

    if (engine.derivativeMode === 'symbolic') {
      payload.firstDerivative = engine.dPlain;
      payload.secondDerivative = engine.d2Plain;
    }
    if (engine.isLinear) payload.linear = engine.linear;

    if (mode === 'quotient') {
      const q = engine.differenceQuotient(x0, h);
      payload.h = num(h);
      payload.differenceQuotient = {
        'f(x0)': num(q.fx0),
        'f(x0+h)': num(q.fx0h),
        value: num(q.value),
        exactDerivative: num(q.exact),
      };
    }

    if (mode === 'analysis' && analysis) {
      payload.analysis = {
        interval: analysis.range.map(num),
        domain: analysis.domain.text,
        roots: analysis.roots.slice(0, 8).map((r) => num(r.x)),
        yIntercept: num(analysis.yIntercept),
        criticalPoints: analysis.critical.slice(0, 8).map((c) => ({ x: num(c.x), y: num(c.y), kind: c.kind })),
        inflectionPoints: analysis.inflections.slice(0, 8).map((p) => num(p.x)),
        verticalAsymptotes: analysis.poles.slice(0, 8).map(num),
        monotonic: analysis.monotonic.slice(0, 8).map((i) => ({ from: num(i.from), to: num(i.to), label: i.label })),
        concavity: analysis.concavity.slice(0, 8).map((i) => ({ from: num(i.from), to: num(i.to), label: i.label })),
      };
    }

    return payload;
  }

  /**
   * @returns {Promise<{ok:boolean, text?:string, error?:string}>}
   */
  async explain(state, { signal } = {}) {
    if (!this.configured) {
      return { ok: false, error: 'not-configured' };
    }
    const payload = AiExplainer.buildPayload(state);
    this.pending = true;
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return { ok: false, error: `El servidor respondió ${res.status}. ${detail.slice(0, 180)}` };
      }
      const data = await res.json().catch(() => null);
      const text = data?.explanation ?? data?.text ?? data?.content;
      if (typeof text !== 'string' || !text.trim()) {
        return { ok: false, error: 'La respuesta del servidor no contenía una explicación.' };
      }
      return { ok: true, text: text.trim() };
    } catch (err) {
      if (err?.name === 'AbortError') return { ok: false, error: 'cancelled' };
      return { ok: false, error: `No se pudo contactar al servidor: ${err?.message ?? 'error de red'}` };
    } finally {
      this.pending = false;
    }
  }
}
