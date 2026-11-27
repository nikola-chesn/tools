/*!
 * CandleGlow — "living candle light" effect for a photo (WebGL, no dependencies).
 * Takes a photo with candles / fairy lights and makes the flames glow, flicker
 * and shimmer the air above them. Originally made for the Sparkling Lights site.
 *
 *   <canvas id="hero" style="width:100%;height:100vh"></canvas>
 *   <script src="candle-glow.js"></script>
 *   <script>
 *     const fx = new CandleGlow(document.getElementById('hero'), {
 *       src: 'photo.jpg',
 *       flames: [[0.28, 0.40, 0.026], [0.48, 0.24, 0.026]], // [x, y, size] in 0..1 of the photo
 *     });
 *     // or let it find the flames itself:  flames: 'auto'
 *   </script>
 *
 * Coordinates: x — from the left edge, y — from the top edge, both 0..1 of the image.
 * size — glow radius as a fraction of the image height (0.026 ≈ a tea-light flame on a wide photo).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CandleGlow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX = 32; // max flames per photo

  const DEFAULTS = {
    src: null,          // URL, <img>, <canvas>, ImageBitmap or File/Blob
    flames: [],         // [[x, y, size], ...] or 'auto'
    focus: [0.5, 0.5],  // which part of the photo stays visible when it is cropped (object-position)
    fit: 'cover',       // 'cover' — fill the canvas and crop; 'contain' — show the whole photo
    dark: 0.22,         // 0..1 how much to darken the photo so the flames stand out
    glow: 1,            // halo brightness around flames
    scale: 1,           // multiplier for every flame size
    flicker: 1,         // flame and room-light flicker
    heat: 1,            // shimmer of hot air above flames
    vignette: 1,        // dark edges
    grain: 1,           // film grain
    warm: 1,            // warm colour grading
    zoom: 0.965,        // < 1 crops a little so parallax never shows the edge
    parallax: 1,        // how much the picture follows the mouse (0 = off)
    pixelRatio: 1.5,    // max device pixel ratio for rendering (performance)
    size: null,         // [width, height] — exact render size in pixels (e.g. for saving a big frame); null = follow the canvas
    motion: 'auto',     // 'auto' respects prefers-reduced-motion; true / false to force
    autoDetect: {},     // options for CandleGlow.detect when flames: 'auto'
    onReady: null,      // callback(instance) when the photo is loaded
    onError: null,      // callback(error) — WebGL unavailable or photo failed
  };

  const VS = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';

  const FS = `precision highp float;varying vec2 v;
uniform sampler2D T;uniform vec2 R,I,F,M,SC;
uniform float t,dk,zm,gs,fs,fk,hs,vg,gr,wt;
uniform vec3 L[${MAX}];uniform int N;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+1.),f.x),f.y);}
void main(){
  vec2 s=(v-.5)*zm+.5+M*vec2(.012,-.008);
  float rs=R.x/R.y;
  vec2 uv=(1.-SC)*F+vec2(s.x,1.-s.y)*SC;
  vec2 d=vec2(0.);vec3 g=vec3(0.);float a=I.x/I.y;
  for(int i=0;i<${MAX};i++){
    if(i>=N)break;
    vec3 l=L[i];l.z*=fs;vec2 q=uv-l.xy;q.x*=a;float fi=float(i);
    float fl=1.-fk*.28*(1.-n(vec2(t*7.+fi*17.,fi)));
    vec2 e=q/vec2(l.z*.45,l.z);
    float m=exp(-dot(e,e)*1.2);
    float up=clamp(-q.y/l.z+.6,0.,1.);
    d.x+=(n(vec2(uv.y*90.-t*6.,fi))-.5)*l.z*.32*m*up*hs;
    d.y+=(fl-(1.-fk*.14))*l.z*.18*m*hs;
    float ab=clamp(-q.y/(l.z*9.),0.,1.);
    float col=exp(-q.x*q.x/(l.z*l.z*5.));
    float hz=col*smoothstep(0.,.15,ab)*(1.-ab);
    d+=(vec2(n(uv*vec2(70.,40.)+vec2(0.,t*3.5)),n(uv*vec2(70.,40.)+vec2(7.,t*3.5)))-.5)*.006*hz*hs;
    g+=vec3(1.,.6,.26)*exp(-dot(q,q)/(l.z*l.z*55.))*.42*fl;
    g+=vec3(1.,.78,.45)*exp(-dot(q,q)/(l.z*l.z*2.5))*.25*fl;
  }
  vec3 c=texture2D(T,uv+d).rgb;
  vec2 ed=step(vec2(0.),uv)*step(uv,vec2(1.));c*=ed.x*ed.y;
  float gf=1.-fk*.07*(1.-n(vec2(t*2.6,3.)));
  c*=mix(1.,gf,.8);
  c=pow(c,vec3(1.1))*(1.-dk*.55);
  c=mix(c,c*vec3(1.08,.97,.86),.6*wt);
  vec2 vq=(v-.5)*vec2(rs,1.);
  c*=mix(1.-.72*vg,1.,smoothstep(1.15,.25,length(vq)));
  c+=g*gs*(1.-dk*.4)*gf;
  c+=(h(v*R+fract(t)*91.)-.5)*.055*gr;
  gl_FragColor=vec4(c,1.);
}`;

  const MAX_TEX = 2048;

  // ---------- image helpers ----------
  function loadImage(src) {
    if (src instanceof Blob) {
      const url = URL.createObjectURL(src);
      return loadImage(url).finally(() => URL.revokeObjectURL(url));
    }
    if (typeof src !== 'string') {
      if (src instanceof HTMLImageElement && !src.complete) {
        return new Promise((ok, no) => { src.addEventListener('load', () => ok(src), { once: true }); src.addEventListener('error', no, { once: true }); });
      }
      return Promise.resolve(src);
    }
    return new Promise((ok, no) => {
      const im = new Image();
      if (!/^(blob:|data:)/.test(src)) im.crossOrigin = 'anonymous';
      im.onload = () => ok(im);
      im.onerror = () => no(new Error('CandleGlow: cannot load image ' + src));
      im.src = src;
    });
  }
  const sizeOf = im => [im.naturalWidth || im.videoWidth || im.width, im.naturalHeight || im.videoHeight || im.height];

  function toCanvas(im, maxW) {
    const [w, h] = sizeOf(im);
    const k = Math.min(1, maxW / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c;
  }

  // ---------- flame detection ----------
  // Finds small, bright, warm spots (candle flames, bulbs) on a photo.
  // Returns [[x, y, size], ...] in the same format as `flames`.
  function detectSync(im, o) {
    o = Object.assign({ max: 24, sensitivity: 0.4, size: 1 }, o);
    const sens = Math.min(1, Math.max(0, o.sensitivity));
    const c = toCanvas(im, 480);
    const W = c.width, H = c.height, P = W * H;
    const px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    // brightness with a little bonus for warm colours
    const s = new Float32Array(P);
    for (let i = 0; i < P; i++) {
      const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
      s[i] = Math.min(1, 0.299 * r + 0.587 * g + 0.114 * b + Math.max(0, r - b) * 0.1);
    }
    // local background = box blur (integral image). A flame is a small spot much brighter
    // than its surroundings; light wax, walls or windows are bright but evenly so.
    const rad = Math.max(3, Math.round(Math.max(W, H) * 0.014));
    const S = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) { row += s[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; }
    }
    const top = new Float32Array(P);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - rad), y1 = Math.min(H, y + rad + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - rad), x1 = Math.min(W, x + rad + 1);
        const sum = S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0];
        top[y * W + x] = s[y * W + x] - sum / ((x1 - x0) * (y1 - y0));
      }
    }
    const minTop = 0.16 - sens * 0.1, minLum = 0.8 - sens * 0.25;
    const ok = i => top[i] >= minTop && s[i] >= minLum;

    // peaks: brightest-above-surroundings points, strongest first, each one suppresses its neighbourhood
    const cand = [];
    // score: how much the spot stands out (3×3 sum) × how close it is to pure white (flames burn white-hot)
    const sc = new Float32Array(P);
    for (let i = 0; i < P; i++) {
      if (!ok(i)) continue;
      const x = i % W, y = (i / W) | 0;
      let t = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) t += Math.max(0, top[yy * W + xx]);
      }
      sc[i] = t * Math.pow(s[i], 6);
      cand.push(i);
    }
    cand.sort((a, b) => sc[b] - sc[a]);
    const taken = new Uint8Array(P), out = [], aspect = W / H;
    let best = 0;
    for (const i of cand) {
      if (out.length >= Math.min(o.max, MAX)) break;
      if (taken[i]) continue;
      const x = i % W, y = (i / W) | 0, score = sc[i];
      if (!best) best = score;
      if (score < best * (0.5 - sens * 0.47)) break;
      // spot size: pixels nearby that are at least half as "hot" as the peak; centre = their weighted mean
      let area = 0, cx = 0, cy = 0, cw = 0;
      const R = rad * 2;
      for (let yy = Math.max(0, y - R); yy < Math.min(H, y + R + 1); yy++) {
        for (let xx = Math.max(0, x - R); xx < Math.min(W, x + R + 1); xx++) {
          const j = yy * W + xx;
          if (top[j] >= top[i] * 0.5) { const w = top[j]; area++; cx += xx * w; cy += yy * w; cw += w; }
          taken[j] = 1;
        }
      }
      const fx = (cx / cw + 0.5) / W, fy = (cy / cw + 0.5) / H;
      if (out.some(f => Math.hypot((f[0] - fx) * aspect, f[1] - fy) < 0.025)) continue;
      // weaker spots (distant bulbs, reflections) get a smaller glow than real flames
      const size = Math.min(0.035, Math.max(0.01, (Math.sqrt(area / Math.PI) / H) * 1.1 + 0.008)) * (0.55 + 0.45 * Math.sqrt(score / best)) * o.size;
      out.push([+fx.toFixed(4), +fy.toFixed(4), +size.toFixed(4)]);
    }
    return out;
  }

  // ---------- the effect ----------
  class CandleGlow {
    constructor(canvas, options) {
      if (typeof canvas === 'string') canvas = document.querySelector(canvas);
      if (!(canvas instanceof HTMLCanvasElement)) {
        const host = canvas; canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:100%;height:100%';
        host.appendChild(canvas);
      }
      this.canvas = canvas;
      this.o = Object.assign({}, DEFAULTS, options);
      this.flames = [];
      this.image = null;
      this.ready = false;
      this._m = [0, 0]; this._tm = [0, 0];
      this._visible = true;
      this._t0 = performance.now();

      const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
      this.gl = gl;
      if (!gl || !this._initGL()) { this._fallback(new Error('CandleGlow: WebGL is not available')); }

      this._onMove = e => { this._tm = [e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5]; };
      addEventListener('pointermove', this._onMove, { passive: true });
      this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(canvas);
      this._io = new IntersectionObserver(es => es.forEach(en => { this._visible = en.isIntersecting; })); this._io.observe(canvas);
      this._rm = matchMedia('(prefers-reduced-motion: reduce)');

      this._loop = now => { this._raf = requestAnimationFrame(this._loop); this._frame(now); };
      this._raf = requestAnimationFrame(this._loop);

      if (this.o.src) this.setImage(this.o.src, this.o.flames);
      else this.setFlames(this.o.flames);
    }

    _initGL() {
      const gl = this.gl;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      try {
        const pr = gl.createProgram();
        gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
        gl.useProgram(pr); this._pr = pr;
      } catch (err) { console.warn(err); return false; }
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(this._pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {};
      'T R I F M SC t dk zm gs fs fk hs vg gr wt L N'.split(' ').forEach(k => { this.u[k] = gl.getUniformLocation(this._pr, k); });
      this._tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._tex);
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(p => gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return true;
    }

    _fallback(err) {
      this.failed = true;
      const c = this.canvas;
      c.style.backgroundSize = this.o.fit === 'contain' ? 'contain' : 'cover';
      c.style.backgroundRepeat = 'no-repeat';
      c.style.backgroundPosition = `${this.o.focus[0] * 100}% ${this.o.focus[1] * 100}%`;
      if (typeof this.o.src === 'string') c.style.backgroundImage = `url("${this.o.src}")`;
      if (this.o.onError) this.o.onError(err);
    }

    /** Load a new photo. flames: array, 'auto', or undefined (keep current). Returns a Promise. */
    setImage(src, flames) {
      this.o.src = src;
      this.ready = false;
      const token = (this._token = {});
      return loadImage(src).then(im => {
        if (token !== this._token) return this;
        const [w, h] = sizeOf(im);
        const tex = Math.max(w, h) > MAX_TEX || !(im instanceof HTMLImageElement || im instanceof HTMLCanvasElement) ? toCanvas(im, MAX_TEX) : im;
        this.image = im; this.imageSize = [w, h];
        if (flames !== undefined) this.setFlames(flames);
        else if (this.o.flames === 'auto') this.setFlames('auto');
        if (this.failed) {
          if (typeof src !== 'string') this.canvas.style.backgroundImage = `url("${toCanvas(im, 1600).toDataURL('image/jpeg', 0.9)}")`;
        } else {
          const gl = this.gl;
          gl.bindTexture(gl.TEXTURE_2D, this._tex);
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, tex);
        }
        this.ready = true;
        this._resize();
        if (this.o.onReady) this.o.onReady(this);
        return this;
      }).catch(err => {
        if (this.o.onError) this.o.onError(err); else console.warn(err);
        throw err;
      });
    }

    /** Set flames: [[x, y, size], ...] or 'auto' (detect on the current photo). */
    setFlames(flames, detectOptions) {
      if (flames === 'auto') {
        this.o.flames = 'auto';
        flames = this.image ? detectSync(this.image, Object.assign({}, this.o.autoDetect, detectOptions)) : [];
      }
      this.flames = (flames || []).slice(0, MAX).map(f => [+f[0], +f[1], f[2] == null ? 0.026 : +f[2]]);
      if (this.u) {
        const L = new Float32Array(MAX * 3);
        this.flames.forEach((f, i) => L.set(f, i * 3));
        this.gl.uniform3fv(this.u.L, L);
        this.gl.uniform1i(this.u.N, this.flames.length);
      }
      return this.flames;
    }

    /** Change any options (dark, glow, flicker, ...) on the fly. */
    set(options) {
      const prevRatio = this.o.pixelRatio;
      Object.assign(this.o, options);
      if ('flames' in options) this.setFlames(options.flames);
      if (this.o.pixelRatio !== prevRatio || 'fit' in options || 'size' in options) this._resize();
      return this;
    }

    // crop of the image visible in the canvas (before zoom / parallax)
    _crop() {
      const R = this._R || [1, 1], I = this.imageSize || [1, 1];
      const rs = R[0] / R[1], ri = I[0] / I[1];
      if (this.o.fit === 'contain') return rs > ri ? [rs / ri, 1] : [1, ri / rs];
      return rs > ri ? [1, ri / rs] : [rs / ri, 1];
    }

    /** Canvas point (CSS px, relative to the canvas) → photo coordinates [x, y] 0..1 (ignores parallax). */
    toImage(x, y) {
      const r = this.canvas.getBoundingClientRect(), sc = this._crop(), F = this.o.focus, z = this.o.zoom;
      const sx = (x / r.width - 0.5) * z + 0.5, sy = (y / r.height - 0.5) * z + 0.5;
      return [(1 - sc[0]) * F[0] + sx * sc[0], (1 - sc[1]) * F[1] + sy * sc[1]];
    }

    /** Photo coordinates 0..1 → canvas point in CSS px (ignores parallax). */
    fromImage(u, v) {
      const r = this.canvas.getBoundingClientRect(), sc = this._crop(), F = this.o.focus, z = this.o.zoom;
      const sx = (u - (1 - sc[0]) * F[0]) / sc[0], sy = (v - (1 - sc[1]) * F[1]) / sc[1];
      return [((sx - 0.5) / z + 0.5) * r.width, ((sy - 0.5) / z + 0.5) * r.height];
    }

    _resize() {
      if (!this.gl || this.failed) return;
      const c = this.canvas, d = Math.min(devicePixelRatio || 1, this.o.pixelRatio), fs = this.o.size;
      const w = fs ? Math.round(fs[0]) : Math.max(1, Math.round(c.clientWidth * d));
      const h = fs ? Math.round(fs[1]) : Math.max(1, Math.round(c.clientHeight * d));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      this._R = [w, h];
      this.gl.viewport(0, 0, w, h);
      this._draw(performance.now());
    }

    _frame(now) {
      if (!this.ready || this.failed || this.paused) return;
      if (!this._visible || document.hidden || !this.canvas.isConnected) return;
      this._draw(now);
    }

    _draw(now) {
      if (!this.ready || this.failed) return;
      const gl = this.gl, u = this.u, o = this.o;
      const p = o.parallax;
      this._m[0] += (this._tm[0] * p - this._m[0]) * 0.05;
      this._m[1] += (this._tm[1] * p - this._m[1]) * 0.05;
      const moving = o.motion === 'auto' ? !this._rm.matches : !!o.motion;
      const sc = this._crop(), I = this.imageSize;
      gl.uniform2f(u.R, this._R[0], this._R[1]);
      gl.uniform2f(u.I, I[0], I[1]);
      gl.uniform2f(u.SC, sc[0], sc[1]);
      gl.uniform2f(u.F, o.focus[0], o.focus[1]);
      gl.uniform2f(u.M, this._m[0], this._m[1]);
      gl.uniform1f(u.t, moving ? (now - this._t0) / 1000 : 0);
      gl.uniform1f(u.dk, o.dark); gl.uniform1f(u.zm, o.zoom);
      gl.uniform1f(u.gs, o.glow); gl.uniform1f(u.fs, o.scale);
      gl.uniform1f(u.fk, o.flicker); gl.uniform1f(u.hs, o.heat);
      gl.uniform1f(u.vg, o.vignette); gl.uniform1f(u.gr, o.grain); gl.uniform1f(u.wt, o.warm);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /** Current frame as a data URL (image/png or image/jpeg). */
    snapshot(type, quality) {
      this._draw(performance.now());
      return this.canvas.toDataURL(type || 'image/png', quality);
    }

    pause() { this.paused = true; return this; }
    play() { this.paused = false; return this; }

    destroy() {
      cancelAnimationFrame(this._raf);
      removeEventListener('pointermove', this._onMove);
      this._ro.disconnect(); this._io.disconnect();
      const lose = this.gl && this.gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      this.ready = false; this.gl = null;
    }
  }

  /** Find flames on a photo. Returns a Promise of [[x, y, size], ...]. */
  CandleGlow.detect = (src, options) => loadImage(src).then(im => detectSync(im, options));
  CandleGlow.detectSync = detectSync;
  CandleGlow.MAX_FLAMES = MAX;
  CandleGlow.defaults = DEFAULTS;

  /** Start the effect on every element with data-candle-glow:
   *  <canvas data-candle-glow data-src="photo.jpg" data-flames='[[.3,.4,.026]]' data-dark=".3"></canvas> */
  CandleGlow.auto = (rootEl) => Array.from((rootEl || document).querySelectorAll('[data-candle-glow]')).map(el => {
    const opt = {};
    for (const [k, v] of Object.entries(el.dataset)) {
      if (k === 'candleGlow') continue;
      try { opt[k] = JSON.parse(v); } catch (_) { opt[k] = v; }
    }
    return (el._candleGlow = new CandleGlow(el, opt));
  });

  return CandleGlow;
});
