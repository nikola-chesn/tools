/*!
 * DepthAI — makes a depth map from a single photo right in the browser.
 * Uses the free open model Depth Anything V2 Small through Transformers.js.
 * The photo never leaves the computer; only the model (~25–50 MB) is downloaded
 * once from Hugging Face and then cached by the browser.
 *
 *   <script src="depth-ai.js"></script>
 *   const depthCanvas = await DepthAI.estimate(img, { onProgress: p => console.log(p) });
 *   // white = near, black = far — ready for DepthParallax
 */
(function (root) {
  'use strict';

  const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
  const MODEL = 'onnx-community/depth-anything-v2-small';
  const INPUT_MAX = 1024; // the model works at ~518 px anyway; smaller input = faster

  let loading = null;

  /** Load the model once. onProgress({ stage: 'download', progress: 0..1 }) */
  function load(onProgress) {
    if (loading) return loading;
    loading = (async () => {
      const T = await import(LIB);
      const files = {};
      const progress_callback = p => {
        if (p.status !== 'progress' || !p.file) return;
        files[p.file] = [p.loaded || 0, p.total || 0];
        let l = 0, t = 0;
        for (const [a, b] of Object.values(files)) { l += a; t += b; }
        if (onProgress) onProgress({ stage: 'download', progress: t ? l / t : 0, loaded: l, total: t });
      };
      const make = (device, dtype) => T.pipeline('depth-estimation', MODEL, { device, dtype, progress_callback });
      // WebGPU is several times faster; fall back to the CPU (WASM) if it is not available
      if (navigator.gpu) {
        try { return { pipe: await make('webgpu', 'fp16'), device: 'webgpu' }; }
        catch (err) { console.warn('DepthAI: WebGPU failed, using CPU', err); }
      }
      return { pipe: await make('wasm', 'q8'), device: 'wasm' };
    })();
    loading.catch(() => { loading = null; });
    return loading;
  }

  function sizeOf(im) { return [im.naturalWidth || im.width, im.naturalHeight || im.height]; }

  function toBlobUrl(im) {
    const [w, h] = sizeOf(im), k = Math.min(1, INPUT_MAX / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return new Promise(ok => c.toBlob(b => ok(URL.createObjectURL(b)), 'image/jpeg', 0.95));
  }

  // RawImage (1 channel) → canvas of the photo's size, contrast stretched to 0..255
  function rawToCanvas(raw, w, h) {
    const src = raw.data, n = raw.width * raw.height, ch = raw.channels || 1;
    let lo = 255, hi = 0;
    for (let i = 0; i < n; i++) { const v = src[i * ch]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const k = hi > lo ? 255 / (hi - lo) : 1;
    const small = document.createElement('canvas');
    small.width = raw.width; small.height = raw.height;
    const ctx = small.getContext('2d'), id = ctx.createImageData(raw.width, raw.height);
    for (let i = 0; i < n; i++) {
      const v = (src[i * ch] - lo) * k;
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const o = out.getContext('2d');
    o.imageSmoothingQuality = 'high';
    o.drawImage(small, 0, 0, w, h);
    return out;
  }

  /** Photo (<img>, <canvas>) → depth map canvas of the same size. */
  async function estimate(im, opts) {
    const onProgress = opts && opts.onProgress;
    const { pipe } = await load(onProgress);
    if (onProgress) onProgress({ stage: 'compute' });
    const url = await toBlobUrl(im);
    try {
      const out = await pipe(url);
      const [w, h] = sizeOf(im);
      return rawToCanvas(out.depth, w, h);
    } finally { URL.revokeObjectURL(url); }
  }

  root.DepthAI = { load, estimate, MODEL, LIB };
})(typeof self !== 'undefined' ? self : this);
