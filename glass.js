'use strict';
/* Local optical approximation, not Apple's native Liquid Glass.
   Rasterize visible artwork into a small, origin-clean texture; refract it
   through a rounded lens. CSS supplies the live DOM backdrop underneath.
   No continuous animation loop, network capture, or external dependency. */
(() => {
  const dock = document.querySelector('.tabs');
  if (!dock || matchMedia('(prefers-reduced-transparency: reduce)').matches) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const scene = document.createElement('canvas');
  const ctx = scene.getContext('2d');
  const canvas = document.createElement('canvas');
  canvas.className = 'glass-optics';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', premultipliedAlpha: false });
  if (!gl || !ctx) return; // The normal CSS dock remains fully usable.
  const shaders = [];
  let program, buffer, texture, stopped = false, frame = 0;
  function compile(type, source) {
    const shader = gl.createShader(type);
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Glass shader compilation');
    return shader;
  }
  function dispose() {
    stopped = true;
    cancelAnimationFrame(frame);
    dock.classList.remove('has-glass-optics');
    canvas.remove();
    if (!gl.isContextLost()) {
      if (texture) gl.deleteTexture(texture);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      shaders.forEach(s => gl.deleteShader(s));
    }
  }
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() { v_uv = a_position * .5 + .5; gl_Position = vec4(a_position, 0., 1.); }
    `));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 v_uv;
      uniform sampler2D u_scene;
      uniform vec2 u_size;
      uniform vec2 u_pointer;
      uniform float u_press;
      uniform float u_pad;
      float roundedBox(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return min(max(q.x, q.y), 0.) + length(max(q, 0.)) - r;
      }
      vec3 sampleScene(vec2 pixel) {
        vec2 uv = (pixel + u_pad) / (u_size + 2. * u_pad);
        return texture2D(u_scene, clamp(uv, .001, .999)).rgb;
      }
      void main() {
        vec2 uv = vec2(v_uv.x, 1. - v_uv.y);
        vec2 p = (uv - .5) * u_size;
        float radius = 28.;
        float d = roundedBox(p, u_size * .5 - 1., radius);
        float mask = 1. - smoothstep(-.8, .6, d);
        if (mask < .01) discard;
        float dx = roundedBox(p + vec2(.5, 0.), u_size * .5 - 1., radius) - d;
        float dy = roundedBox(p + vec2(0., .5), u_size * .5 - 1., radius) - d;
        vec2 normal = normalize(vec2(dx, dy) + vec2(.0001));
        float edge = exp(min(d, 0.) / 7.);
        vec2 pointer = (u_pointer - .5) * u_size;
        float touch = exp(-length(p - pointer) / 70.) * u_press;
        // A convex edge displaces the scene inward, rather than tinting it.
        vec2 bend = -normal * edge * edge * (8. + touch * 3.);
        vec2 pixel = uv * u_size + bend;
        vec3 color = sampleScene(pixel) * .4;
        color += sampleScene(pixel + vec2(1.5, 0.)) * .15;
        color += sampleScene(pixel - vec2(1.5, 0.)) * .15;
        color += sampleScene(pixel + vec2(0., 1.5)) * .15;
        color += sampleScene(pixel - vec2(0., 1.5)) * .15;
        color = mix(color, vec3(.15, .15, .17), .18);
        vec2 light = normalize(vec2(-.6, -1.) + (u_pointer - .5) * .8);
        float rim = exp(-abs(d + 1.2) / .85);
        float specular = pow(max(dot(normal, light), 0.), 3.);
        color += vec3(.7, .76, .84) * rim * (.1 + specular * .48);
        color += vec3(.14, .16, .18) * edge * specular * .24;
        color += vec3(.08) * touch;
        float alpha = mix(.24, .82, edge) * mask;
        gl_FragColor = vec4(color, alpha);
      }
    `));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Glass shader linking');
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, 'u_scene'), 0);
  } catch { dispose(); return; }
  dock.prepend(canvas);
  const sizeLoc = gl.getUniformLocation(program, 'u_size');
  const pointerLoc = gl.getUniformLocation(program, 'u_pointer');
  const pressLoc = gl.getUniformLocation(program, 'u_press');
  const padLoc = gl.getUniformLocation(program, 'u_pad');
  const pad = 24;
  let pointer = [.3, .05], press = 0, releaseAt = 0;
  let lastPaint = 0, sceneDirty = true;
  const safeImages = new Map();
  function requestPaint() {
    if (stopped || document.hidden || frame) return;
    frame = requestAnimationFrame(paint);
  }
  function invalidate() { sceneDirty = true; requestPaint(); }
  function originCleanImage(img) {
    const src = img.currentSrc || img.src;
    if (!src || !img.complete || !img.naturalWidth) return null;
    if (src.startsWith('blob:') || src.startsWith('data:') || new URL(src, location.href).origin === location.origin) return img;
    // Never upload a cross-origin image without CORS approval to WebGL.
    // Keep distant artwork in the CSS backdrop when approval is unavailable.
    const cached = safeImages.get(src);
    if (cached) return cached.complete && cached.naturalWidth ? cached : null;
    if (safeImages.size >= 24) return null;
    const copy = new Image();
    copy.crossOrigin = 'anonymous';
    copy.onload = invalidate;
    copy.src = src;
    safeImages.set(src, copy);
    return null;
  }
  function rasterize(bounds) {
    const w = Math.ceil(bounds.width + pad * 2), h = Math.ceil(bounds.height + pad * 2);
    if (scene.width !== w || scene.height !== h) { scene.width = w; scene.height = h; }
    ctx.fillStyle = '#101012'; ctx.fillRect(0, 0, w, h);
    const x0 = bounds.left - pad, y0 = bounds.top - pad;
    // Restrict the scene to visible app artwork and labels, never form fields.
    for (const el of document.querySelectorAll('#view .card-art, #view .art, #view .card .t, #view .card .a, #view h2, #view .recent-tile .t')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < y0 || r.top > y0 + h || r.right < x0 || r.left > x0 + w) continue;
      const x = r.left - x0, y = r.top - y0;
      const style = getComputedStyle(el);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, r.width, r.height, parseFloat(style.borderRadius) || 0);
      ctx.clip();
      if (el.tagName === 'IMG') {
        const image = originCleanImage(el);
        if (image) {
          const scale = Math.max(r.width / image.naturalWidth, r.height / image.naturalHeight);
          const dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
          ctx.drawImage(image, x + (r.width - dw) / 2, y + (r.height - dh) / 2, dw, dh);
        } else { ctx.fillStyle = '#29292e'; ctx.fillRect(x, y, r.width, r.height); }
      } else if (el.classList.contains('ph')) {
        const hue = style.getPropertyValue('--h').trim() || '0';
        const gradient = ctx.createLinearGradient(x, y, x + r.width, y + r.height);
        gradient.addColorStop(0, `hsl(${hue} 13% 28%)`); gradient.addColorStop(1, `hsl(${hue} 10% 18%)`);
        ctx.fillStyle = gradient; ctx.fillRect(x, y, r.width, r.height);
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        ctx.fillStyle = '#e7e2e9'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(el.textContent, x + r.width / 2, y + r.height / 2);
      } else {
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        ctx.fillStyle = style.color; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(el.childNodes[0]?.textContent || el.textContent, x, y + 2);
      }
      ctx.restore();
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
  }
  function paint(now) {
    frame = 0;
    if (stopped || document.hidden) return;
    if (now - lastPaint < 30) { requestPaint(); return; }
    lastPaint = now;
    const bounds = dock.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.round(bounds.width * dpr), h = Math.round(bounds.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; sceneDirty = true; }
    try {
      if (sceneDirty) { rasterize(bounds); sceneDirty = false; }
      if (releaseAt) { press = reduce.matches ? 0 : Math.max(0, 1 - (now - releaseAt) / 220); if (!press) releaseAt = 0; }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(sizeLoc, bounds.width, bounds.height);
      gl.uniform2f(pointerLoc, pointer[0], pointer[1]);
      gl.uniform1f(pressLoc, press);
      gl.uniform1f(padLoc, pad);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      dock.classList.add('has-glass-optics');
    } catch { dispose(); return; }
    if (releaseAt) requestPaint();
  }
  dock.addEventListener('pointerdown', e => {
    const b = dock.getBoundingClientRect();
    pointer = [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height];
    press = reduce.matches ? 0 : 1; releaseAt = 0; requestPaint();
  }, { passive: true });
  function release() { if (!press) return; releaseAt = performance.now(); requestPaint(); }
  window.addEventListener('pointerup', release, { passive: true });
  window.addEventListener('pointercancel', release, { passive: true });
  window.addEventListener('scroll', invalidate, { passive: true });
  window.addEventListener('resize', invalidate, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); });
  document.querySelector('#view').addEventListener('load', invalidate, true);
  new MutationObserver(invalidate).observe(document.querySelector('#view'), { childList: true, subtree: true, characterData: true });
  new ResizeObserver(invalidate).observe(dock);
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); dispose(); });
  requestPaint();
})();
