/**
 * Gestión de cámara y MediaPipe Hands.
 *
 * Se implementa el bucle de captura con getUserMedia en lugar de usar
 * camera_utils: elimina dos dependencias de CDN y permite desacoplar la
 * detección de manos (~30 fps, costosa) del render (60 fps).
 *
 * Todos los fallos posibles se traducen a un mensaje claro en español; la
 * aplicación nunca se rompe: si la cámara no está disponible se sigue usando
 * con los controles manuales.
 */

export const CAMERA_STATE = {
  OFF: 'off',
  STARTING: 'starting',
  ON: 'on',
  ERROR: 'error',
};

/** Conexiones del esqueleto de la mano (evita depender de drawing_utils). */
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export class CameraManager {
  /**
   * @param {HTMLVideoElement} video
   * @param {HTMLCanvasElement} previewCanvas  vista en miniatura con el esqueleto
   */
  constructor(video, previewCanvas) {
    this.video = video;
    this.preview = previewCanvas;
    this.pctx = previewCanvas?.getContext('2d') ?? null;

    this.state = CAMERA_STATE.OFF;
    this.message = '';
    this.stream = null;
    this.hands = null;
    this.results = null;

    this.onResults = null;
    this.onStateChange = null;

    this._raf = 0;
    this._busy = false;
    this._lastSend = 0;
    this.detectionInterval = 1000 / 30;   // detección a 30 fps
    this._stopped = true;
  }

  _setState(state, message = '') {
    this.state = state;
    this.message = message;
    if (this.onStateChange) this.onStateChange(state, message);
  }

  /** @returns {{ok:boolean, reason?:string}} comprobaciones previas */
  static checkSupport() {
    if (!window.isSecureContext && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      return { ok: false, reason: 'La cámara sólo funciona sobre HTTPS o en localhost. Abrí la página con https://' };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, reason: 'Este navegador no permite acceder a la cámara. Probá con Chrome, Edge o Firefox actualizados.' };
    }
    if (typeof window.Hands === 'undefined') {
      return { ok: false, reason: 'No se pudo cargar MediaPipe Hands. Revisá tu conexión a internet.' };
    }
    return { ok: true };
  }

  async start() {
    if (this.state === CAMERA_STATE.ON || this.state === CAMERA_STATE.STARTING) return true;

    const support = CameraManager.checkSupport();
    if (!support.ok) {
      this._setState(CAMERA_STATE.ERROR, support.reason);
      return false;
    }

    this._setState(CAMERA_STATE.STARTING, 'Iniciando cámara…');
    this._stopped = false;

    try {
      this.stream = await this._openStream();
    } catch (err) {
      this._setState(CAMERA_STATE.ERROR, describeMediaError(err));
      return false;
    }

    if (this._stopped) { this._releaseStream(); return false; }

    this.video.srcObject = this.stream;
    this.video.playsInline = true;
    this.video.muted = true;
    try {
      await this.video.play();
    } catch {
      this._setState(CAMERA_STATE.ERROR, 'El navegador bloqueó la reproducción del video. Volvé a intentarlo.');
      this._releaseStream();
      return false;
    }

    try {
      this.hands = new window.Hands({
        locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}`,
      });
      this.hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6,
        selfieMode: true,
      });
      this.hands.onResults((r) => {
        this.results = r;
        if (this.onResults) this.onResults(r);
        this.drawPreview(r);
      });
    } catch (err) {
      this._setState(CAMERA_STATE.ERROR, 'No se pudo inicializar la detección de manos: ' + (err?.message ?? 'error desconocido'));
      this._releaseStream();
      return false;
    }

    this._setState(CAMERA_STATE.ON, 'Cámara activa');
    this._loop();
    return true;
  }

  async _openStream() {
    const ideal = { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false };
    try {
      return await navigator.mediaDevices.getUserMedia(ideal);
    } catch (err) {
      // Algunas webcams rechazan la resolución pedida: reintento sin restricciones
      if (err?.name === 'OverconstrainedError' || err?.name === 'ConstraintNotSatisfiedError') {
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      throw err;
    }
  }

  _loop() {
    if (this._stopped) return;
    this._raf = requestAnimationFrame(() => this._loop());

    const now = performance.now();
    if (this._busy || now - this._lastSend < this.detectionInterval) return;
    if (this.video.readyState < 2) return;

    this._lastSend = now;
    this._busy = true;
    this.hands.send({ image: this.video })
      .catch(() => { /* un frame perdido no debe romper el bucle */ })
      .finally(() => { this._busy = false; });
  }

  /** Miniatura espejada con el esqueleto de la mano superpuesto. */
  drawPreview(results) {
    const ctx = this.pctx;
    if (!ctx || !this.preview) return;
    const w = this.preview.width, h = this.preview.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w, 0);
    ctx.scale(-1, 1);   // efecto espejo
    try {
      ctx.drawImage(this.video, 0, 0, w, h);
    } catch { /* el video todavía no tiene datos */ }
    ctx.restore();

    const hands = results?.multiHandLandmarks;
    if (!hands?.length) return;

    // Los landmarks ya vienen en el espacio espejado (selfieMode)
    for (const lm of hands) {
      ctx.strokeStyle = 'rgba(34,224,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        ctx.moveTo(lm[a].x * w, lm[a].y * h);
        ctx.lineTo(lm[b].x * w, lm[b].y * h);
      }
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  stop() {
    this._stopped = true;
    cancelAnimationFrame(this._raf);
    this._releaseStream();
    if (this.hands?.close) { try { this.hands.close(); } catch { /* ignorado */ } }
    this.hands = null;
    this.results = null;
    if (this.pctx && this.preview) this.pctx.clearRect(0, 0, this.preview.width, this.preview.height);
    this._setState(CAMERA_STATE.OFF, 'Cámara apagada');
  }

  _releaseStream() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }
}

function describeMediaError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Permiso de cámara denegado. Habilitalo desde el candado de la barra de direcciones y volvé a intentar.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No se encontró ninguna cámara conectada.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'La cámara está siendo usada por otra aplicación. Cerrala y volvé a intentar.';
    case 'OverconstrainedError':
      return 'La cámara no admite la resolución solicitada.';
    case 'SecurityError':
      return 'El navegador bloqueó el acceso a la cámara por seguridad.';
    default:
      return `No se pudo acceder a la cámara${err?.message ? ': ' + err.message : '.'}`;
  }
}
