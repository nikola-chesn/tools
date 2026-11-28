/*!
 * DepthParallax — 3D parallax for a photo using its depth map (WebGL, no dependencies).
 * Near parts stay put, far parts slide the other way when the mouse moves,
 * so a flat photo feels like a window into a real scene.
 * Optional soft candle glow (flicker, halo, heat shimmer) from CandleGlow.
 *
 *   <canvas id="scene" style="width:100%;height:100vh"></canvas>
 *   <script src="depth-parallax.js"></script>
 *   <script>
 *     new DepthParallax(document.getElementById('scene'), {
 *       src: 'photo.jpg',
 *       depth: 'photo-depth.png',   // white = near, black = far
 *     });
 *   </script>
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DepthParallax = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX = 32;   // max flames
  const STEPS = 10; // parallax refinement steps

  const DEFAULTS = {
    src: null,          // photo: URL, <img>, <canvas>, File/Blob
    depth: null,        // depth map of the same photo: white = near, black = far
    invert: false,      // true if the map is the other way round (black = near)
    strength: 0.05,     // how far the scene moves (fraction of the photo width)
    focus: 1,           // which depth stays still: 1 = the nearest, 0 = the farthest, 0.5 = middle
    vertical: 0.6,      // vertical movement relative to horizontal
    smooth: 4,          // depth map blur in px (removes jagged edges)
    ease: 0.06,         // how softly the camera follows the mouse (0..1, smaller = softer)
    sway: 0,            // 0..1 — slow automatic movement (for videos, or when the mouse is idle)
    swayPeriod: 6,      // seconds per sway loop
    idleSway: 0.35,     // sway that starts by itself after 3 s without mouse movement (0 = off)
    pointer: 'window',  // 'window' — mouse anywhere on the page; 'element' — only over the canvas
    focusPoint: [0.5, 0.5], // object-position for cover crop
    fit: 'cover',       // 'cover' | 'contain'
    zoom: 1,            // extra zoom (the needed zoom for edges is added automatically)
    // light & atmosphere (from CandleGlow; all 0 = plain photo)
    flames: [],         // [[x, y, size], ...] in 0..1 of the photo
    glow: 1, scale: 1, flicker: 1, heat: 0.6,
    dark: 0.12, vignette: 0.6, grain: 0.5, warm: 0.5,
    showDepth: false,   // debug: show the depth map instead of the photo
    pixelRatio: 1.5,
    size: null,         // exact render size [w, h] in px (for saving), null = follow the canvas
    motion: 'auto',     // 'auto' respects prefers-reduced-motion
    onReady: null, onError: null,
  };

  const VS = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';

  const FS = `precision highp float;varying vec2 v;
uniform sampler2D T,D;uniform vec2 R,I,SC,F,O;
uniform float t,zm,fc,inv,sd,dk,gs,fs,fk,hs,vg,gr,wt;
uniform vec3 L[${MAX}];uniform int N;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+1.),f.x),f.y);}
float dep(vec2 p){float d=texture2D(D,clamp(p,0.,1.)).r;return mix(d,1.-d,inv);}
void main(){
  vec2 s=(v-.5)*zm+.5;
  float rs=R.x/R.y,a=I.x/I.y;
  vec2 uv=(1.-SC)*F+vec2(s.x,1.-s.y)*SC;
  // candle light: flicker, halo and heat shimmer (d = distortion)
  vec2 d=vec2(0.);vec3 g=vec3(0.);
  for(int i=0;i<${MAX};i++){
    if(i>=N)break;
    vec3 l=L[i];l.z*=fs;float fi=float(i);
    vec2 lp=l.xy-O*(fc-dep(l.xy));       // where this flame is on screen now
    vec2 q=uv-lp;q.x*=a;
    float fl=1.-fk*.28*(1.-n(vec2(t*7.+fi*17.,fi)));
    vec2 e=q/vec2(l.z*.45,l.z);
    float m=exp(-dot(e,e)*1.2);
    float up=clamp(-q.y/l.z+.6,0.,1.);
    d.x+=(n(vec2(uv.y*90.-t*6.,fi))-.5)*l.z*.32*m*up*hs;
    d.y+=(fl-(1.-fk*.14))*l.z*.18*m*hs;
    float ab=clamp(-q.y/(l.z*9.),0.,1.);
    float col=exp(-q.x*q.x/(l.z*l.z*5.));
    d+=(vec2(n(uv*vec2(70.,40.)+vec2(0.,t*3.5)),n(uv*vec2(70.,40.)+vec2(7.,t*3.5)))-.5)*.006*col*smoothstep(0.,.15,ab)*(1.-ab)*hs;
    g+=vec3(1.,.6,.26)*exp(-dot(q,q)/(l.z*l.z*55.))*.42*fl;
    g+=vec3(1.,.78,.45)*exp(-dot(q,q)/(l.z*l.z*2.5))*.25*fl;
  }
  // parallax: find the photo point that lands here after shifting by depth.
  // The heat shimmer is applied first, so the photo AND its depth map wobble together
  // (otherwise the flame moves on the photo while its shape in the depth map stays put).
  vec2 ud=uv+d,p=ud;
  for(int i=0;i<${STEPS};i++){p=mix(p,ud+O*(fc-dep(p)),.6);}
  vec3 c=texture2D(T,p).rgb;
  if(sd>.5)c=vec3(dep(p));
  vec2 ed=step(vec2(0.),uv)*step(uv,vec2(1.));c*=ed.x*ed.y;
  float gf=1.-fk*.07*(1.-n(vec2(t*2.6,3.)))*step(.5,float(N));
  if(sd<.5){
    c*=mix(1.,gf,.8);
    c=pow(c,vec3(1.+.1*dk/.22))*(1.-dk*.55);
    c=mix(c,c*vec3(1.08,.97,.86),.6*wt);
    vec2 vq=(v-.5)*vec2(rs,1.);
    c*=mix(1.-.72*vg,1.,smoothstep(1.15,.25,length(vq)));
    c+=g*gs*(1.-dk*.4)*gf;
    c+=(h(v*R+fract(t)*91.)-.5)*.055*gr;
  }
  gl_FragColor=vec4(c,1.);
}`;

  const MAX_TEX = 2048, MAX_DEPTH = 1024;

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
      im.onerror = () => no(new Error('DepthParallax: cannot load image ' + src));
      im.src = src;
    });
  }
  const sizeOf = im => [im.naturalWidth || im.width, im.naturalHeight || im.height];
  function toCanvas(im, maxSide) {
    const [w, h] = sizeOf(im), k = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c;
  }

  // depth map → single-channel bytes, blurred (3 box passes ≈ gaussian) to soften edges
  function prepareDepth(im, blurPx) {
    const c = toCanvas(im, MAX_DEPTH), W = c.width, H = c.height;
    const px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    let a = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) a[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    const r = Math.round(blurPx * W / Math.max(1, sizeOf(im)[0]));
    if (r > 0) {
      let b = new Float32Array(W * H);
      const pass = (src, dst, horiz) => {
        const len = horiz ? W : H, lines = horiz ? H : W;
        for (let l = 0; l < lines; l++) {
          let sum = 0;
          const at = k => horiz ? l * W + Math.min(len - 1, Math.max(0, k)) : Math.min(len - 1, Math.max(0, k)) * W + l;
          for (let k = -r; k <= r; k++) sum += src[at(k)];
          for (let k = 0; k < len; k++) {
            dst[horiz ? l * W + k : k * W + l] = sum / (2 * r + 1);
            sum += src[at(k + r + 1)] - src[at(k - r)];
          }
        }
      };
      for (let i = 0; i < 3; i++) { pass(a, b, true); pass(b, a, false); }
    }
    const out = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = Math.max(0, Math.min(255, Math.round(a[i])));
    return { data: out, w: W, h: H };
  }

  class DepthParallax {
    constructor(canvas, options) {
      if (typeof canvas === 'string') canvas = document.querySelector(canvas);
      if (!(canvas instanceof HTMLCanvasElement)) {
        const host = canvas; canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:100%;height:100%';
        host.appendChild(canvas);
      }
      this.canvas = canvas;
      this.o = Object.assign({}, DEFAULTS, options);
      this.ready = false;
      this._m = [0, 0]; this._tm = [0, 0]; this._lastMove = -1e9;
      this._visible = true; this._t0 = performance.now();

      const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
      this.gl = gl;
      if (!gl || !this._initGL()) this._fallback(new Error('DepthParallax: WebGL is not available'));

      this._onMove = e => {
        let x, y;
        if (this.o.pointer === 'element') {
          const r = this.canvas.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
          x = (e.clientX - r.left) / r.width - 0.5; y = (e.clientY - r.top) / r.height - 0.5;
        } else { x = e.clientX / innerWidth - 0.5; y = e.clientY / innerHeight - 0.5; }
        this._tm = [x, y]; this._lastMove = performance.now();
      };
      this._onLeave = () => { if (this.o.pointer === 'element') this._tm = [0, 0]; };
      addEventListener('pointermove', this._onMove, { passive: true });
      canvas.addEventListener('pointerleave', this._onLeave);
      this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(canvas);
      this._io = new IntersectionObserver(es => es.forEach(en => { this._visible = en.isIntersecting; })); this._io.observe(canvas);
      this._rm = matchMedia('(prefers-reduced-motion: reduce)');

      this._loop = now => { this._raf = requestAnimationFrame(this._loop); this._frame(now); };
      this._raf = requestAnimationFrame(this._loop);

      this.setFlames(this.o.flames);
      if (this.o.src) this.setImage(this.o.src, this.o.depth);
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
      'T D R I SC F O t zm fc inv sd dk gs fs fk hs vg gr wt L N'.split(' ').forEach(k => { this.u[k] = gl.getUniformLocation(this._pr, k); });
      const mk = unit => {
        const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
        [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(p => gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return t;
      };
      this._texPhoto = mk(0); this._texDepth = mk(1);
      gl.uniform1i(this.u.T, 0); gl.uniform1i(this.u.D, 1);
      // flat grey depth until a map is loaded
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([255]));
      return true;
    }

    _fallback(err) {
      this.failed = true;
      const c = this.canvas;
      c.style.backgroundSize = this.o.fit === 'contain' ? 'contain' : 'cover';
      c.style.backgroundRepeat = 'no-repeat';
      c.style.backgroundPosition = `${this.o.focusPoint[0] * 100}% ${this.o.focusPoint[1] * 100}%`;
      if (typeof this.o.src === 'string') c.style.backgroundImage = `url("${this.o.src}")`;
      if (this.o.onError) this.o.onError(err);
    }

    /** Load a photo and (optionally) its depth map. Returns a Promise. */
    setImage(src, depth) {
      this.o.src = src;
      if (depth !== undefined) this.o.depth = depth;
      this.ready = false;
      const token = (this._token = {});
      return Promise.all([loadImage(src), this.o.depth ? loadImage(this.o.depth) : null]).then(([im, dm]) => {
        if (token !== this._token) return this;
        this.image = im; this.imageSize = sizeOf(im);
        if (this.failed) {
          if (typeof src !== 'string') this.canvas.style.backgroundImage = `url("${toCanvas(im, 1600).toDataURL('image/jpeg', 0.9)}")`;
        } else {
          const gl = this.gl, [w, h] = this.imageSize;
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._texPhoto);
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, Math.max(w, h) > MAX_TEX ? toCanvas(im, MAX_TEX) : im);
          this._depthImage = dm;
          this._uploadDepth();
        }
        this.ready = true;
        this._resize();
        if (this.o.onReady) this.o.onReady(this);
        return this;
      }).catch(err => { if (this.o.onError) this.o.onError(err); else console.warn(err); throw err; });
    }

    /** Replace only the depth map. */
    setDepth(depth) {
      this.o.depth = depth;
      return loadImage(depth).then(dm => { this._depthImage = dm; this._uploadDepth(); this._draw(performance.now()); return this; });
    }

    _uploadDepth() {
      if (this.failed || !this.gl) return;
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._texDepth);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      if (!this._depthImage) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([255]));
        this._depthSmooth = null; return;
      }
      const d = prepareDepth(this._depthImage, this.o.smooth);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, d.w, d.h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, d.data);
      this._depthSmooth = this.o.smooth;
    }

    /** Flames: [[x, y, size], ...] in 0..1 of the photo. */
    setFlames(flames) {
      this.flames = (flames || []).slice(0, MAX).map(f => [+f[0], +f[1], f[2] == null ? 0.026 : +f[2]]);
      this.o.flames = this.flames;
      if (this.u) {
        const L = new Float32Array(MAX * 3);
        this.flames.forEach((f, i) => L.set(f, i * 3));
        this.gl.uniform3fv(this.u.L, L); this.gl.uniform1i(this.u.N, this.flames.length);
      }
      return this.flames;
    }

    /** Change options on the fly. */
    set(options) {
      Object.assign(this.o, options);
      if ('flames' in options) this.setFlames(options.flames);
      if ('smooth' in options && options.smooth !== this._depthSmooth) this._uploadDepth();
      if ('pixelRatio' in options || 'fit' in options || 'size' in options) this._resize();
      return this;
    }

    _crop() {
      const R = this._R || [1, 1], I = this.imageSize || [1, 1], rs = R[0] / R[1], ri = I[0] / I[1];
      if (this.o.fit === 'contain') return rs > ri ? [rs / ri, 1] : [1, ri / rs];
      return rs > ri ? [1, ri / rs] : [rs / ri, 1];
    }
    // zoom that hides the edges at the largest shift
    _zoom() {
      const o = this.o, I = this.imageSize || [1, 1];
      const amp = Math.max(o.focus, 1 - o.focus) * o.strength * 0.5 * Math.max(1, o.vertical * I[0] / I[1]);
      return Math.max(0.3, (1 - 2 * amp) / o.zoom);
    }

    /** Canvas point (CSS px) ↔ photo coordinates 0..1, in the resting position (no shift). */
    toImage(x, y) {
      const r = this.canvas.getBoundingClientRect(), sc = this._crop(), F = this.o.focusPoint, z = this._zoom();
      const sx = (x / r.width - 0.5) * z + 0.5, sy = (y / r.height - 0.5) * z + 0.5;
      return [(1 - sc[0]) * F[0] + sx * sc[0], (1 - sc[1]) * F[1] + sy * sc[1]];
    }
    fromImage(u, v) {
      const r = this.canvas.getBoundingClientRect(), sc = this._crop(), F = this.o.focusPoint, z = this._zoom();
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

    // current camera offset target in -0.5..0.5
    _target(now) {
      const o = this.o, ts = (now - this._t0) / 1000;
      const idle = o.idleSway > 0 && now - this._lastMove > 3000;
      const amt = Math.max(o.sway, idle ? o.idleSway : 0);
      if (!amt) return this._tm;
      const ph = ts / o.swayPeriod * Math.PI * 2;
      const auto = [0.5 * Math.sin(ph), 0.3 * Math.sin(ph * 2)];
      if (o.sway > 0) return [auto[0] * o.sway, auto[1] * o.sway];
      // idle: blend slowly from the last mouse position into the sway
      const k = Math.min(1, (now - this._lastMove - 3000) / 2500);
      return [this._tm[0] * (1 - k) + auto[0] * amt * k, this._tm[1] * (1 - k) + auto[1] * amt * k];
    }

    _draw(now) {
      if (!this.ready || this.failed) return;
      const gl = this.gl, u = this.u, o = this.o;
      const moving = o.motion === 'auto' ? !this._rm.matches : !!o.motion;
      const tg = moving ? this._target(now) : [0, 0];
      const e = o.sway > 0 ? 1 : o.ease;
      this._m[0] += (tg[0] - this._m[0]) * e;
      this._m[1] += (tg[1] - this._m[1]) * e;
      const I = this.imageSize, sc = this._crop(), a = I[0] / I[1];
      // shift in photo uv: horizontal in width units, vertical scaled to keep pixels square
      const ox = this._m[0] * o.strength, oy = this._m[1] * o.strength * o.vertical * a;
      gl.uniform2f(u.R, this._R[0], this._R[1]);
      gl.uniform2f(u.I, I[0], I[1]);
      gl.uniform2f(u.SC, sc[0], sc[1]);
      gl.uniform2f(u.F, o.focusPoint[0], o.focusPoint[1]);
      gl.uniform2f(u.O, ox, oy);
      gl.uniform1f(u.t, moving ? (now - this._t0) / 1000 : 0);
      gl.uniform1f(u.zm, this._zoom());
      gl.uniform1f(u.fc, o.focus); gl.uniform1f(u.inv, o.invert ? 1 : 0); gl.uniform1f(u.sd, o.showDepth ? 1 : 0);
      gl.uniform1f(u.dk, o.dark); gl.uniform1f(u.gs, o.glow); gl.uniform1f(u.fs, o.scale);
      gl.uniform1f(u.fk, o.flicker); gl.uniform1f(u.hs, o.heat);
      gl.uniform1f(u.vg, o.vignette); gl.uniform1f(u.gr, o.grain); gl.uniform1f(u.wt, o.warm);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /** Current frame as a data URL. */
    snapshot(type, quality) { this._draw(performance.now()); return this.canvas.toDataURL(type || 'image/png', quality); }
    pause() { this.paused = true; return this; }
    play() { this.paused = false; return this; }
    /** Restart the sway loop from its beginning (handy before recording a video). */
    restart() { this._t0 = performance.now(); this._m = [0, 0]; return this; }

    destroy() {
      cancelAnimationFrame(this._raf);
      removeEventListener('pointermove', this._onMove);
      this.canvas.removeEventListener('pointerleave', this._onLeave);
      this._ro.disconnect(); this._io.disconnect();
      const lose = this.gl && this.gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      this.ready = false; this.gl = null;
    }
  }

  DepthParallax.defaults = DEFAULTS;
  DepthParallax.MAX_FLAMES = MAX;

  /** <canvas data-depth-parallax data-src="a.jpg" data-depth="a-depth.png"></canvas> → DepthParallax.auto() */
  DepthParallax.auto = rootEl => Array.from((rootEl || document).querySelectorAll('[data-depth-parallax]')).map(el => {
    const opt = {};
    for (const [k, v] of Object.entries(el.dataset)) {
      if (k === 'depthParallax') continue;
      try { opt[k] = JSON.parse(v); } catch (_) { opt[k] = v; }
    }
    return (el._depthParallax = new DepthParallax(el, opt));
  });

  return DepthParallax;
});
