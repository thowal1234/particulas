/**
 * Endpoint serverless para «Explicar con IA» — versión Vercel.
 * Ruta pública resultante:  https://TU-PROYECTO.vercel.app/api/explain
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * GitHub Pages sirve archivos estáticos y públicos: cualquier API key escrita
 * en el JavaScript del navegador quedaría a la vista de todo el mundo. La clave
 * vive únicamente acá, en una variable de entorno del servidor.
 *
 * DESPLIEGUE
 *   1. Subí este repositorio a Vercel (vercel.com → Add New → Project).
 *   2. Settings → Environment Variables → agregá  ANTHROPIC_API_KEY
 *      y, opcionalmente, ALLOWED_ORIGINS con tu dominio de GitHub Pages.
 *   3. Deploy. Pegá la URL resultante en el botón «Explicar con IA» de la app.
 *
 * CONTRATO CON EL FRONTEND
 * El cuerpo del pedido trae resultados YA calculados por mathEngine.js.
 * El modelo sólo los redacta: tiene prohibido calcular o corregir.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

const SYSTEM_PROMPT = `Sos un profesor de análisis matemático que explica en español rioplatense, con claridad y calidez, a estudiantes de secundaria y primeros años de universidad.

REGLAS ABSOLUTAS:
1. Los valores numéricos y las expresiones simbólicas del JSON ya fueron calculados por un motor matemático determinista (math.js). Son correctos. NO los recalcules, NO los corrijas y NO los contradigas.
2. Nunca inventes valores que no estén en el JSON. Si algo no aparece, no lo menciones.
3. Tu tarea es explicar QUÉ SIGNIFICAN esos resultados y por qué importan, no producirlos.
4. Escribí de 3 a 5 oraciones, en texto plano y corrido, sin Markdown, sin títulos y sin viñetas.
5. Priorizá la intuición geométrica: qué se ve en el gráfico y qué representa.`;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  applyCors(res, origin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usá POST.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' });
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }
  const validation = validatePayload(payload);
  if (!validation.ok) return res.status(400).json({ error: validation.error });

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(payload) }],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('Error del proveedor:', upstream.status, detail.slice(0, 500));
      return res.status(502).json({ error: `El proveedor de IA respondió ${upstream.status}.` });
    }

    const data = await upstream.json();
    const explanation = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!explanation) return res.status(502).json({ error: 'El proveedor no devolvió texto.' });
    return res.status(200).json({ explanation });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error inesperado al generar la explicación.' });
  }
}

// ── Auxiliares ────────────────────────────────────────────────────────────────

/**
 * CORS. Por defecto se acepta cualquier origen porque el endpoint no maneja
 * datos personales ni credenciales del usuario. Si preferís restringirlo,
 * definí ALLOWED_ORIGINS como una lista separada por comas.
 */
function applyCors(res, origin) {
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const value = allowed.length === 0 ? '*' : (allowed.includes(origin) ? origin : allowed[0]);
  res.setHeader('Access-Control-Allow-Origin', value);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (allowed.length) res.setHeader('Vary', 'Origin');
}

const OPERATIONS = new Set(['particles', 'slope', 'quotient', 'derivatives', 'analysis', 'visual']);

function validatePayload(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'Cuerpo JSON inválido.' };
  if (typeof p.function !== 'string' || !p.function.trim()) return { ok: false, error: 'Falta la función.' };
  if (p.function.length > 400) return { ok: false, error: 'La función es demasiado larga.' };
  if (!OPERATIONS.has(p.operation)) return { ok: false, error: 'Operación desconocida.' };
  if (JSON.stringify(p).length > 20000) return { ok: false, error: 'El payload es demasiado grande.' };
  return { ok: true };
}

const TITLES = {
  slope: 'la pendiente de la función en un punto',
  quotient: 'el cociente incremental y su límite cuando h tiende a cero',
  derivatives: 'la primera y la segunda derivada',
  analysis: 'el análisis completo de la función',
  particles: 'la representación de la función como campo de partículas',
  visual: 'la visualización de la función',
};

function buildUserMessage(p) {
  return `El estudiante está explorando ${TITLES[p.operation]}.

Resultados calculados por el motor matemático (son correctos, explicalos tal cual):

${JSON.stringify(p, null, 2)}

Explicá en español qué significan estos resultados.`;
}
