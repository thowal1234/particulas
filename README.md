# Math Particle Hands

Herramienta matemática interactiva: escribís una función, activás la cámara y
explorás su pendiente, su cociente incremental, sus derivadas y su análisis
completo **moviendo la mano**.

Evolución del proyecto original de partículas: se conservan Three.js, MediaPipe
Hands, el morphing de partículas y la estética, pero ahora los gestos operan
sobre la función que ingresa el usuario.

**Demo:** https://miguejacosta.github.io/particulas/

---

## Gestos

| Gesto | Dedos | Modo | Qué muestra |
|---|---|---|---|
| ✊ | 0 | Partículas | La curva más su sólido de revolución; el puño empuja las partículas y genera ondas |
| ☝ | 1 | Pendiente | Punto P, recta tangente y triángulo Δy/Δx |
| ✌ | 2 | Cociente incremental | Puntos P y Q, recta secante y el límite h → 0 |
| 🤟 | 3 | Derivadas | f(x), f′(x) y f″(x) simultáneas, con animación de la derivación |
| 🖖 | 4 | Análisis completo | Dominio, raíces, extremos, inflexiones, monotonía, concavidad, asíntotas |
| ✋ | 5 | Visualización | Gráfica y partículas a pantalla limpia |

**Controles continuos**

- **Posición horizontal de la mano → x₀.** El punto de análisis se desplaza en tiempo real.
- **Separación entre índice y medio → h.** Juntar los dedos lleva h → 0,01 y la secante
  converge visualmente sobre la tangente. Se eligió esta señal (y no el pellizco)
  porque mantiene los dos dedos extendidos: el conteo del gesto no se rompe mientras
  se ajusta h.
- **Pellizco de la segunda mano → zoom.**
- Rueda del mouse: zoom · arrastrar: desplazar · pellizco táctil: zoom.

**Sin cámara:** todos los modos funcionan con los botones de la izquierda o con las
teclas **0–5**, y x₀ y h tienen deslizadores. La aplicación es 100 % usable sin cámara.

---

## Motor matemático

Los resultados **nunca** provienen de una IA. Se calculan con
[math.js](https://mathjs.org) (parsing, simplificación y derivadas simbólicas) más
métodos numéricos clásicos implementados en `js/mathEngine.js`:

- **Raíces y puntos críticos:** cambio de signo + bisección, y búsqueda ternaria de
  mínimos de |f| para detectar raíces dobles como la de x².
- **Dominio:** muestreo denso y afinado de las fronteras por bisección
  (`sqrt(x)` da exactamente x ≥ 0, no x ≥ 0,0025).
- **Asíntotas verticales:** dos patrones — cambio de signo con magnitudes grandes
  (1/x, tan x) y explosión del mismo signo (1/x²). Los pares de muestras contiguos
  que se disparan se agrupan antes de localizar el polo, para no reportar varios
  polos desplazados en lugar de uno solo.
- **Derivadas:** simbólicas cuando math.js puede; si no (`floor`, `sign`, `mod`…),
  diferencias centradas con extrapolación de Richardson. La interfaz avisa cuándo
  la derivada es numérica en vez de simular una fórmula que no existe.

Tres detalles del comportamiento real de math.js que el motor maneja de forma
explícita: `sqrt(-1)` devuelve un objeto **Complex** (no `NaN`), `1/0` devuelve
**Infinity**, y `x(x+1)` se parsea como **llamada a función**. Los tres se traducen a
"fuera de dominio" o se corrigen en el preprocesado.

### Entrada admitida

`f(x) = x^2 + 3x - 4` · `y = 2x + 5` · `x²` · `sen(x)` · `ln(x)` · `√x` · `2,5x` ·
`x(x+1)` · `(x+1)(x-1)` · `f(t) = t^2` (renombra la variable a x).

Ante un error, el mensaje es específico: paréntesis desbalanceados con el conteo,
variables de más, o la función más parecida (`cosen(x)` → «¿Quisiste decir cos?»).

---

## Ejecutar en local

Los módulos ES requieren `http://`; abrir `index.html` con doble clic (`file://`)
no funciona por las reglas de CORS del navegador. Levantá cualquier servidor estático:

```bash
npx serve .
```

```bash
python -m http.server 8000
```

En Windows sin Node ni Python, con PowerShell:

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Después abrí `http://localhost:8000` (o el puerto que indique el comando).

> La cámara requiere `https://` o `localhost`. En GitHub Pages funciona porque se
> sirve por HTTPS.

### Tests

Abrí `http://localhost:8000/tests/` — 152 verificaciones deterministas del motor
matemático, el reconocimiento de gestos y los mapeos de mano. Todas en verde.

### Depuración

Agregá `?debug=1` a la URL para exponer `window.mphDebug`, con acceso al estado, la
vista, los renderizadores y `mphDebug.step(n)` para avanzar frames a mano.

---

## Desplegar en GitHub Pages

El sitio es estático: no hay build.

```bash
git add -A
git commit -m "Math Particle Hands"
git push origin main
```

En **Settings → Pages**, con *Source: Deploy from a branch*, rama `main` y carpeta
`/ (root)`. En un minuto queda publicado en `https://<usuario>.github.io/particulas/`.

---

## IA opcional

El botón **«Explicar con IA»** es opcional: la aplicación funciona completa sin él,
con explicaciones deterministas escritas a partir de los valores calculados.

**Nunca pongas una API key en el frontend.** Esta página es estática y pública:
cualquier clave incrustada quedaría expuesta. Por eso se incluyen dos endpoints
serverless listos para desplegar, que guardan la clave del lado del servidor:

- `api/explain.js` → Vercel (`https://TU-PROYECTO.vercel.app/api/explain`)
- `netlify/functions/explain.js` → Netlify (`/.netlify/functions/explain`)

Configurá la variable de entorno `ANTHROPIC_API_KEY` (y opcionalmente
`ALLOWED_ORIGINS`) en el panel del proveedor, desplegá y pegá la URL resultante en el
diálogo del botón. Queda guardada en `localStorage`.

El endpoint recibe los resultados **ya calculados** y el prompt del sistema le
prohíbe explícitamente recalcularlos o corregirlos: la IA sólo los redacta.

---

## Estructura

```
index.html                     Estructura y carga de librerías
css/styles.css                 Sistema de diseño y responsive
js/main.js                     Orquestador: estado, bucle de render, cableado
js/view.js                     Coordenadas compartidas gráfica ↔ partículas
js/mathEngine.js               Motor determinista (math.js + métodos numéricos)
js/graphRenderer.js            Gráfica 2D: ejes, curvas, tangente, secante, marcadores
js/particleRenderer.js         Partículas WebGL con shader propio
js/gestureController.js        Conteo de dedos y estabilización de gestos
js/cameraManager.js            getUserMedia + MediaPipe Hands, con manejo de errores
js/uiController.js             Todo el acceso al DOM
js/explanations.js             Explicaciones en español, sin IA
js/aiExplainer.js              Cliente del endpoint opcional
js/audioFx.js                  Sonidos sintetizados con WebAudio
api/explain.js                 Endpoint serverless (Vercel)
netlify/functions/explain.js   Endpoint serverless (Netlify)
tests/index.html               Suite de tests
serve.ps1                      Servidor estático para Windows
```

**Cómo encajan gráfica y partículas.** Las dos comparten el objeto `View`: la cámara
de Three.js es **ortográfica** y su frustum coincide con el rectángulo matemático
visible, con relación de aspecto 1:1. Una partícula en `(x, f(x))` cae exactamente
sobre la curva dibujada en el canvas 2D, y una recta tangente se ve realmente
tangente.

## Rendimiento

Con 20.000 partículas, el coste de CPU por frame va de **0,36 ms** (visualización) a
**1,11 ms** (derivadas), sobre un presupuesto de 16,7 ms para 60 fps. Durante un
arrastre continuo en modo análisis —el caso más pesado— el frame cuesta 2,55 ms.

Las claves: las derivadas simbólicas se calculan una sola vez y se cachean (cada
llamada a `derivative()` cuesta ~2,4 ms, así que llamarla por frame sería fatal); el
muestreo de curvas se cachea por vista y función; el análisis completo está limitado
a un recálculo cada 220 ms; el color de las partículas sólo se interpola durante la
transición entre modos; y la detección de manos corre a 30 fps, desacoplada del
render a 60 fps. Si el equipo no sostiene el framerate, la cantidad de partículas
baja sola (20.000 → 13.000 → 8.000 → 4.500) y vuelve a subir cuando puede.

## Compatibilidad

Chrome, Edge, Firefox y Safari recientes. Si falta WebGL, se desactivan las
partículas y siguen funcionando la gráfica y los cálculos. Si falla la cámara o
MediaPipe, se explica el motivo y quedan los controles manuales. Si no carga KaTeX,
las fórmulas se muestran en texto plano.

## Librerías

math.js 12.4.1 · Three.js r128 · KaTeX 0.16.9 · MediaPipe Hands 0.4 — todas por CDN,
sin instalación ni build.
