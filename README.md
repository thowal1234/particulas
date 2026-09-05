# Math Particle Hands

Herramienta matemática interactiva: escribís una función, activás la cámara y
explorás su pendiente, su cociente incremental, sus derivadas y su análisis
completo **moviendo la mano**.

Evolución del proyecto original de partículas: se conservan Three.js, MediaPipe
Hands, el morphing de partículas y la estética, pero ahora los gestos operan
sobre la función que ingresa el usuario.

**Demo:** https://thowal1234.github.io/particulas/

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

## En el teléfono

Funciona en vertical y en horizontal, y es **instalable**: desde Chrome o Safari,
«Agregar a pantalla de inicio» la abre a pantalla completa con su propio icono.

Un teléfono no aguanta los mismos parámetros que una notebook. `js/device.js` decide
el presupuesto una sola vez y, a partir de ahí, la calidad se sigue adaptando sola
según los fps reales:

| | Escritorio | Teléfono |
|---|---|---|
| Partículas (escalón inicial) | 20.000 | 7.000 — o 4.000 si declara pocos núcleos o poca memoria |
| devicePixelRatio máximo | 1,75 | 1,25 |
| Complejidad del modelo de manos | 1 | 0 (bastante más rápido) |
| Detección de manos | 30 fps | 18 fps |
| Captura de cámara | 1280×720 | 640×480 |
| Encuadre inicial | x ∈ [−10, 10] | x ∈ [−6,5 , 6,5] |

Otros detalles pensados para el móvil: se respetan las zonas seguras del notch y del
indicador de inicio (`env(safe-area-inset-*)`); la altura usa `100dvh`, así que la
barra de direcciones al aparecer u ocultarse no descoloca nada; `touch-action` está
desactivado sobre la gráfica —para que arrastrar no haga scroll de la página ni el
pellizco haga zoom del navegador— pero habilitado dentro de los paneles; los objetivos
táctiles suben a 44 px; y al rotar se reencuadra con reintentos, porque iOS dispara
`orientationchange` **antes** de actualizar `innerWidth`.

En horizontal la interfaz cambia de disposición: el selector de modos pasa a la
izquierda y el panel a la derecha, que aprovecha mucho mejor una pantalla ancha y
baja. En teléfonos chicos en horizontal la miniatura de cámara se oculta por falta de
sitio; el gesto detectado se sigue viendo en el indicador.

La barra superior y los paneles nunca se solapan porque ninguno usa alturas fijas
adivinadas: los paneles viven en un contenedor flex y la barra publica su alto real
en la variable CSS `--topbar-h`.

---

## Tipografía y modo proyector

La interfaz usa **Inter variable** con el eje `opsz` activo
(`font-optical-sizing: auto`): la letra se redibuja según el tamaño en vez de
escalar siempre el mismo dibujo, más abierta en los cuerpos chicos y más
ajustada en los títulos.

Todos los valores numéricos van en **cifras tabulares** (`tabular-nums`). No es
un detalle estético: con las cifras proporcionales que Inter trae por defecto
cada dígito tiene un ancho distinto —el `1` mide 5,98 px y el `4`, 9,58— así
que un número de cuatro cifras se corría hasta 14 px al cambiar de valor, y el
panel entero temblaba mientras movías la mano. Con cifras tabulares los diez
dígitos miden exactamente lo mismo y el número queda quieto. `slashed-zero`
distingue el 0 de la O.

El botón **A⁺** de la barra superior activa el **modo proyector**, pensado para
el aula: a cuatro o cinco metros, y con la pérdida de contraste de un proyector,
las versalitas de la interfaz de escritorio se vuelven una mancha. El modo sube
la tipografía un 40 %, refuerza los dos grises de texto, ensancha los paneles y
vuelve el cristal casi opaco. La preferencia se recuerda en `localStorage`.

Está implementado con **una sola variable**: cada `font-size` de la hoja de
estilos es `calc(Npx * var(--fs-scale))`, así que `body.projector` sólo cambia
`--fs-scale` y reescala los 73 tamaños de una vez, sin redefinir ni una regla.

Los grises de texto se subieron a **7,9:1** y **4,5:1** de contraste sobre el
fondo. Los valores anteriores daban 5,4:1 y 2,1:1; este último quedaba muy por
debajo del mínimo AA de 4,5:1.

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
js/device.js                   Presupuesto de rendimiento según el dispositivo
manifest.webmanifest           Instalable como app en el teléfono
icons/                         Iconos (SVG + PNG 180/192/512)
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
