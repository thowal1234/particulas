/**
 * Endpoint serverless para «Explicar con IA» — versión Netlify.
 * Ruta pública resultante:  https://TU-SITIO.netlify.app/.netlify/functions/explain
 *
 * Misma lógica que api/explain.js (Vercel), adaptada a la firma de Netlify.
 * La API key vive sólo en el servidor: nunca en el navegador.
 *
 * DESPLIEGUE
 *   1. Conectá el repositorio en Netlify.
 *   2. Site settings → Environment variables → agregá ANTHROPIC_API_KEY.
 *   3. Deploy. Pegá la URL de la función en el botón «Explicar con IA».
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

const OPERATIONS = new Set(['particles', 'slope', 'quotient', 'derivatives', 'analysis', 'visual']);

const TITLES = {
  slope: 'la pendiente de la función en un punto',
  quotient: 'el cociente incremental y su límite cuando h tiende a cero',
  derivatives: 'la primera y la segunda derivada',
  analysis: 'el análisis completo de la función',
  particles: 'la representación de la función como campo de partículas',
  visual: 'la visualización de la función',
};

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const cors = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Usá POST.' }, cors);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' }, cors);

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Cuerpo JSON inválido.' }, cors); }

  const v = validatePayload(payload);
  if (!v.ok) return json(400, { error: v.error }, cors);

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
      return json(502, { error: `El proveedor de IA respondió ${upstream.status}.` }, cors);
    }

    const data = await upstream.json();
    const explanation = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!explanation) return json(502, { error: 'El proveedor no devolvió texto.' }, cors);
    return json(200, { explanation }, cors);
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Error inesperado al generar la explicación.' }, cors);
  }
}

function corsHeaders(origin) {
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const value = allowed.length === 0 ? '*' : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(statusCode, body, headers) {
  return { statusCode, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function validatePayload(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'Cuerpo JSON inválido.' };
  if (typeof p.function !== 'string' || !p.function.trim()) return { ok: false, error: 'Falta la función.' };
  if (p.function.length > 400) return { ok: false, error: 'La función es demasiado larga.' };
  if (!OPERATIONS.has(p.operation)) return { ok: false, error: 'Operación desconocida.' };
  if (JSON.stringify(p).length > 20000) return { ok: false, error: 'El payload es demasiado grande.' };
  return { ok: true };
}

function buildUserMessage(p) {
  return `El estudiante está explorando ${TITLES[p.operation]}.

Resultados calculados por el motor matemático (son correctos, explicalos tal cual):

${JSON.stringify(p, null, 2)}

Explicá en español qué significan estos resultados.`;
}
