/**
 * Sistema de partículas.
 *
 * Conserva el mecanismo del proyecto original: cada partícula interpola su
 * posición y su color hacia un objetivo (tgt/tcol), lo que produce el morphing
 * suave entre estados. La novedad es que los objetivos ya no son formas fijas
 * sino la función que escribió el usuario: la curva, su recta tangente, la
 * secante, las derivadas o el sólido de revolución generado al girar f(x)
 * alrededor del eje X — una evolución directa de la forma original.
 *
 * La cámara es ORTOGRÁFICA y su frustum coincide con la View, de modo que una
 * partícula en (x, f(x)) cae exactamente sobre la curva dibujada en el canvas 2D.
 */

import { clamp } from './view.js';

const THREE = () => window.THREE;

const VERT = `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
uniform float uMinPx;
uniform float uMaxPx;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale, uMinPx, uMaxPx);
}`;

const FRAG = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  float a = pow(1.0 - r2, 1.7);
  gl_FragColor = vec4(vColor, a * vAlpha);
}`;

const PALETTE = {
  f: [0.13, 0.88, 1.0],
  df: [0.63, 0.42, 1.0],
  d2f: [1.0, 0.37, 0.77],
  tangent: [1.0, 0.71, 0.34],
  secant: [0.29, 0.91, 0.64],
  point: [1.0, 1.0, 1.0],
  root: [0.5, 0.91, 1.0],
  max: [1.0, 0.62, 0.27],
  min: [0.29, 0.91, 0.64],
};

export class ParticleRenderer {
  constructor(canvas, view) {
    this.view = view;
    this.canvas = canvas;
    this.ok = false;

    const T = THREE();
    if (!T) return;

    this.renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(this.dpr);

    this.scene = new T.Scene();
    this.camera = new T.OrthographicCamera(-10, 10, 10, -10, -500, 500);
    this.scene.add(this.camera);

    this.maxCount = 20000;
    this.count = this.maxCount;

    const N = this.maxCount;
    this.pos = new Float32Array(N * 3);
    this.tgt = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.tcol = new Float32Array(N * 3);
    this.size = new Float32Array(N);
    this.alpha = new Float32Array(N);
    this.talpha = new Float32Array(N);
    this.rand = new Float32Array(N * 3);   // ruido estable por partícula
    for (let i = 0; i < N * 3; i++) this.rand[i] = Math.random();

    this.geo = new T.BufferGeometry();
    this.geo.setAttribute('position', new T.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new T.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new T.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new T.BufferAttribute(this.alpha, 1));
    this.geo.setDrawRange(0, this.count);

    this.mat = new T.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uScale: { value: 60 },
        uMinPx: { value: 1.0 },
        uMaxPx: { value: 22.0 },
      },
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });

    this.points = new T.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Interacción de la mano
    this.push = { active: false, x: 0, y: 0, radius: 1.6, strength: 0.22 };
    this.ripples = [];
    this.rotation = 0;
    this.targetRotation = 0;
    this._colorSettle = 0;
    this._flow = 0;

    this.ok = true;
  }

  setQuality(count) {
    this.count = clamp(Math.round(count), 1500, this.maxCount);
    this.geo.setDrawRange(0, this.count);
  }

  resize() {
    if (!this.ok) return;
    const { view } = this;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(view.width, view.height, false);
    this.syncCamera();
  }

  /** Alinea el frustum ortográfico con la View: mundo = plano cartesiano. */
  syncCamera() {
    if (!this.ok) return;
    const { view, camera } = this;
    camera.left = view.xMin; camera.right = view.xMax;
    camera.top = view.yMax; camera.bottom = view.yMin;
    camera.updateProjectionMatrix();
    this.mat.uniforms.uScale.value = view.pixelsPerUnit * this.dpr;
    this.mat.uniforms.uMaxPx.value = 22 * this.dpr;
    this.mat.uniforms.uMinPx.value = 0.9 * this.dpr;
  }

  // ── Construcción de objetivos ───────────────────────────────────────────────

  /**
   * Recalcula la distribución de partículas para un modo.
   * Es una operación cara (recorre todas las partículas), así que sólo se
   * ejecuta al cambiar de modo, de función o de vista — nunca por frame.
   */
  rebuild(state) {
    if (!this.ok || !state.engine?.ready) return;
    const { engine, mode } = state;
    const { view } = this;
    const N = this.count;

    // Malla de muestreo compartida: evita evaluar la función 20.000 veces
    const gridN = 900;
    const pad = view.spanX * 0.05;
    const gf = engine.sample('f', view.xMin - pad, view.xMax + pad, gridN);
    const gd = (mode === 'derivatives') ? engine.sample('df', view.xMin - pad, view.xMax + pad, gridN) : null;
    const gd2 = (mode === 'derivatives') ? engine.sample('d2f', view.xMin - pad, view.xMax + pad, gridN) : null;

    this.roles = [];
    const span = (frac, kind, extra) => {
      const start = this.roles.length ? this.roles[this.roles.length - 1].end : 0;
      const end = Math.min(N, start + Math.round(N * frac));
      this.roles.push({ start, end, kind, ...extra });
    };

    switch (mode) {
      case 'particles':
        span(0.45, 'curve');
        span(0.55, 'revolution');
        break;
      case 'slope':
        span(0.58, 'curve');
        span(0.36, 'tangent');
        span(0.06, 'pointP');
        break;
      case 'quotient':
        span(0.50, 'curve');
        span(0.34, 'secant');
        span(0.08, 'pointP');
        span(0.08, 'pointQ');
        break;
      case 'derivatives':
        span(0.40, 'curve');
        span(0.30, 'curveD1');
        span(0.30, 'curveD2');
        break;
      case 'analysis':
        span(0.72, 'curve');
        span(0.28, 'features');
        break;
      case 'visual':
      default:
        span(1.0, 'curve');
        break;
    }

    // Rellena la última porción por redondeo
    if (this.roles.length) this.roles[this.roles.length - 1].end = N;

    for (const role of this.roles) {
      switch (role.kind) {
        case 'curve': this._fillCurve(role, gf, PALETTE.f, 1); break;
        case 'curveD1': this._fillCurve(role, gd, PALETTE.df, 0.85); break;
        case 'curveD2': this._fillCurve(role, gd2, PALETTE.d2f, 0.7); break;
        case 'revolution': this._fillRevolution(role, gf); break;
        default: this._fillNeutral(role); break;
      }
    }

    this._colorSettle = 90;
    this.targetRotation = mode === 'particles' ? this.targetRotation : 0;
    this.updateDynamic(state, 0);
  }

  _fillCurve(role, grid, rgb, alpha) {
    const { tgt, tcol, size, talpha, rand } = this;
    if (!grid) { this._fillNeutral(role); return; }
    const { xs, ys, n } = grid;
    const thickness = this.view.spanY * 0.006;

    for (let i = role.start; i < role.end; i++) {
      const t = rand[i * 3];
      const fi = t * (n - 1);
      const i0 = Math.floor(fi);
      const i1 = Math.min(n - 1, i0 + 1);
      const fr = fi - i0;
      const y0 = ys[i0], y1 = ys[i1];
      const x = xs[i0] + (xs[i1] - xs[i0]) * fr;
      let y = NaN;
      if (Number.isFinite(y0) && Number.isFinite(y1)) y = y0 + (y1 - y0) * fr;
      else if (Number.isFinite(y0)) y = y0;

      const j = i * 3;
      const visible = Number.isFinite(y) && Math.abs(y) < 1e6;
      tgt[j] = x;
      tgt[j + 1] = visible ? y + (rand[j + 1] - 0.5) * thickness * 6 : 0;
      tgt[j + 2] = (rand[j + 2] - 0.5) * thickness * 3;
      tcol[j] = rgb[0]; tcol[j + 1] = rgb[1]; tcol[j + 2] = rgb[2];
      size[i] = 0.045 + rand[j + 1] * 0.05;
      talpha[i] = visible ? alpha * (0.5 + rand[j + 2] * 0.5) : 0;
    }
  }

  /**
   * Sólido de revolución al girar y = f(x) alrededor del eje X.
   * Es la forma que abría el proyecto original, ahora generada por la
   * función que escribe el usuario.
   */
  _fillRevolution(role, grid) {
    const { tgt, tcol, size, talpha, rand } = this;
    const { xs, ys, n } = grid;
    const maxR = this.view.spanY * 0.48;

    for (let i = role.start; i < role.end; i++) {
      const j = i * 3;
      const t = rand[j];
      const fi = t * (n - 1);
      const i0 = Math.floor(fi);
      const x = xs[i0];
      const y = ys[i0];
      const theta = rand[j + 1] * Math.PI * 2;
      const visible = Number.isFinite(y);
      const r = visible ? Math.min(Math.abs(y), maxR) : 0;

      tgt[j] = x;
      tgt[j + 1] = r * Math.cos(theta);
      tgt[j + 2] = r * Math.sin(theta);

      // Color por radio: cian en el eje → violeta en la superficie
      const k = maxR > 0 ? clamp(r / maxR, 0, 1) : 0;
      tcol[j] = PALETTE.f[0] + (PALETTE.df[0] - PALETTE.f[0]) * k;
      tcol[j + 1] = PALETTE.f[1] + (PALETTE.df[1] - PALETTE.f[1]) * k;
      tcol[j + 2] = PALETTE.f[2] + (PALETTE.df[2] - PALETTE.f[2]) * k;
      size[i] = 0.04 + rand[j + 2] * 0.04;
      talpha[i] = visible ? 0.35 + rand[j + 2] * 0.35 : 0;
    }
  }

  /**
   * Deja el tramo invisible y en reposo. Lo usan los roles cuyos objetivos
   * calcula updateDynamic() en cada frame (tangente, secante, puntos, features).
   */
  _fillNeutral(role) {
    const { tgt, tcol, size, talpha } = this;
    for (let i = role.start; i < role.end; i++) {
      const j = i * 3;
      tgt[j] = 0; tgt[j + 1] = 0; tgt[j + 2] = 0;
      tcol[j] = PALETTE.point[0]; tcol[j + 1] = PALETTE.point[1]; tcol[j + 2] = PALETTE.point[2];
      size[i] = 0.05;
      talpha[i] = 0;
    }
  }

  // ── Objetivos dependientes de x₀ / h (sí se recalculan por frame) ───────────

  /**
   * Sólo aritmética simple sobre las porciones móviles (rectas y puntos).
   * No evalúa derivadas simbólicas ni vuelve a muestrear la función.
   */
  updateDynamic(state, dt) {
    if (!this.ok || !this.roles || !state.engine?.ready) return;
    const { engine, x0, h, mode } = state;
    const { view, tgt, tcol, talpha, size, rand } = this;

    this._flow = (this._flow + dt * 0.35) % 1;

    const y0 = engine.f(x0);
    const m = engine.df(x0);

    for (const role of this.roles) {
      if (role.kind === 'tangent') {
        const valid = Number.isFinite(y0) && Number.isFinite(m);
        const xa = view.xMin, xb = view.xMax;
        for (let i = role.start; i < role.end; i++) {
          const j = i * 3;
          if (!valid) { talpha[i] = 0; continue; }
          const u = (rand[j] + this._flow) % 1;
          const x = xa + (xb - xa) * u;
          const y = y0 + m * (x - x0);
          tgt[j] = x;
          tgt[j + 1] = y;
          tgt[j + 2] = (rand[j + 2] - 0.5) * view.spanY * 0.008;
          tcol[j] = PALETTE.tangent[0]; tcol[j + 1] = PALETTE.tangent[1]; tcol[j + 2] = PALETTE.tangent[2];
          size[i] = 0.05 + rand[j + 1] * 0.03;
          // Se desvanece en los extremos: el flujo "nace" y "muere" suavemente
          talpha[i] = Math.abs(y) < view.spanY * 6 ? 0.55 * Math.sin(u * Math.PI) + 0.25 : 0;
        }
      } else if (role.kind === 'secant') {
        const x1 = x0 + h;
        const y1 = engine.f(x1);
        const valid = Number.isFinite(y0) && Number.isFinite(y1);
        for (let i = role.start; i < role.end; i++) {
          const j = i * 3;
          if (!valid) { talpha[i] = 0; continue; }
          // Las partículas viajan de P a Q, mostrando la dirección de la secante
          const u = (rand[j] + this._flow * 1.6) % 1;
          tgt[j] = x0 + (x1 - x0) * u;
          tgt[j + 1] = y0 + (y1 - y0) * u;
          tgt[j + 2] = (rand[j + 2] - 0.5) * view.spanY * 0.008;
          tcol[j] = PALETTE.secant[0]; tcol[j + 1] = PALETTE.secant[1]; tcol[j + 2] = PALETTE.secant[2];
          size[i] = 0.055 + rand[j + 1] * 0.035;
          talpha[i] = 0.85;
        }
      } else if (role.kind === 'pointP' || role.kind === 'pointQ') {
        const isP = role.kind === 'pointP';
        const px = isP ? x0 : x0 + h;
        const py = isP ? y0 : engine.f(px);
        const valid = Number.isFinite(py);
        const rgb = mode === 'quotient' ? PALETTE.secant : PALETTE.tangent;
        const rad = view.spanY * 0.02;
        for (let i = role.start; i < role.end; i++) {
          const j = i * 3;
          if (!valid) { talpha[i] = 0; continue; }
          // Halo orbitando el punto
          const a = rand[j] * Math.PI * 2 + this._flow * Math.PI * 2;
          const r = rad * (0.35 + rand[j + 1]);
          tgt[j] = px + Math.cos(a) * r;
          tgt[j + 1] = py + Math.sin(a) * r;
          tgt[j + 2] = 0;
          tcol[j] = rgb[0]; tcol[j + 1] = rgb[1]; tcol[j + 2] = rgb[2];
          size[i] = 0.06 + rand[j + 2] * 0.04;
          talpha[i] = 0.9;
        }
      } else if (role.kind === 'features') {
        this._fillFeatures(role, state);
      }
    }
  }

  /** Cúmulos brillantes sobre raíces, extremos e inflexiones. */
  _fillFeatures(role, state) {
    const { tgt, tcol, talpha, size, rand } = this;
    const a = state.analysis;
    const spots = [];
    if (a) {
      for (const r of a.roots) spots.push([r.x, 0, PALETTE.root]);
      for (const c of a.critical) spots.push([c.x, c.y, c.kind === 'máximo' ? PALETTE.max : PALETTE.min]);
      for (const p of a.inflections) spots.push([p.x, p.y, PALETTE.d2f]);
    }
    if (!spots.length) {
      for (let i = role.start; i < role.end; i++) talpha[i] = 0;
      return;
    }
    const rad = this.view.spanY * 0.028;
    for (let i = role.start; i < role.end; i++) {
      const j = i * 3;
      const s = spots[i % spots.length];
      const ang = rand[j] * Math.PI * 2 + this._flow * Math.PI * 2 * (1 + (i % 3) * 0.3);
      const r = rad * (0.3 + rand[j + 1] * 0.9);
      tgt[j] = s[0] + Math.cos(ang) * r;
      tgt[j + 1] = s[1] + Math.sin(ang) * r;
      tgt[j + 2] = 0;
      tcol[j] = s[2][0]; tcol[j + 1] = s[2][1]; tcol[j + 2] = s[2][2];
      size[i] = 0.05 + rand[j + 2] * 0.04;
      talpha[i] = 0.75;
    }
  }

  // ── Interacción ─────────────────────────────────────────────────────────────

  setPush(active, worldX, worldY) {
    this.push.active = active;
    if (active) { this.push.x = worldX; this.push.y = worldY; }
  }

  addRipple(worldX, worldY) {
    if (this.ripples.length > 3) this.ripples.shift();
    this.ripples.push({ x: worldX, y: worldY, t: 0 });
  }

  // ── Bucle ───────────────────────────────────────────────────────────────────

  render(dt) {
    if (!this.ok) return;
    const { pos, tgt, col, tcol, alpha, talpha, geo } = this;
    const N = this.count;
    const posAttr = geo.getAttribute('position');
    const colAttr = geo.getAttribute('aColor');
    const alphaAttr = geo.getAttribute('aAlpha');

    // Coeficientes independientes del framerate
    const kPos = 1 - Math.exp(-9 * dt);
    const kCol = 1 - Math.exp(-5 * dt);

    // Posición y opacidad: siempre
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      pos[j] += (tgt[j] - pos[j]) * kPos;
      pos[j + 1] += (tgt[j + 1] - pos[j + 1]) * kPos;
      pos[j + 2] += (tgt[j + 2] - pos[j + 2]) * kPos;
      alpha[i] += (talpha[i] - alpha[i]) * kCol;
    }

    // Color: sólo mientras no haya convergido tras un cambio de modo
    if (this._colorSettle > 0) {
      this._colorSettle--;
      for (let i = 0; i < N * 3; i++) col[i] += (tcol[i] - col[i]) * kCol;
      colAttr.needsUpdate = true;
    }

    // Empuje del puño y ondas: sólo cuando hay actividad
    if (this.push.active || this.ripples.length) this._applyForces(dt);

    posAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    geo.getAttribute('aSize').needsUpdate = true;

    // Rotación (sólo en modo partículas, alrededor del eje de revolución)
    this.rotation += (this.targetRotation - this.rotation) * (1 - Math.exp(-3 * dt));
    this.points.rotation.x = this.rotation;

    this.syncCamera();
    this.renderer.render(this.scene, this.camera);
  }

  _applyForces(dt) {
    const { pos, push, ripples, view } = this;
    const N = this.count;
    const unit = view.spanX / 20;              // fuerzas proporcionales al zoom
    const pr = push.radius * unit;
    const pr2 = pr * pr;

    for (const r of ripples) r.t += dt;
    while (ripples.length && ripples[0].t > 1.6) ripples.shift();

    for (let i = 0; i < N; i++) {
      const j = i * 3;
      const px = pos[j], py = pos[j + 1];

      if (push.active) {
        const dx = px - push.x, dy = py - push.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < pr2 && d2 > 1e-6) {
          const f = (1 - d2 / pr2) * push.strength;
          pos[j] += dx * f;
          pos[j + 1] += dy * f;
        }
      }

      for (let k = 0; k < ripples.length; k++) {
        const r = ripples[k];
        const dx = px - r.x, dy = py - r.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const front = r.t * 7 * unit;
        const band = 0.9 * unit;
        const diff = d - front;
        if (Math.abs(diff) < band && d > 1e-5) {
          const wave = Math.cos((diff / band) * Math.PI * 0.5);
          const decay = Math.max(0, 1 - r.t / 1.6);
          const f = wave * wave * decay * 0.16 * unit / d;
          pos[j] += dx * f;
          pos[j + 1] += dy * f;
        }
      }
    }
  }

  dispose() {
    if (!this.ok) return;
    this.geo.dispose();
    this.mat.dispose();
    this.renderer.dispose();
  }
}
