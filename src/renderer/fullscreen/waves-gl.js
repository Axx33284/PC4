// The PS4-style flowing waves, drawn on the GPU (WebGL) at the screen's full resolution.
// One full-screen shader paints the gradient, the light pool and the glowing ribbons; a second pass draws
// the drifting particles as point sprites. A little dithering keeps the soft gradients free of banding.

const VERT = `attribute vec2 aPos; varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime, uWaves;
uniform vec3 uTop, uMid, uLow, uWave;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// one ribbon: a translucent sheet that is brightest along its top edge, with a thin glowing line on it
vec2 ribbon(vec2 p, float y0, float rise, float bend, float amp, float f, float sp, float ph, float th, float a) {
  float u = (p.x + 0.15) / 1.3;
  float base = y0 - rise * u - bend * u * u + bend * 0.55 * u * u * u;
  float wav = amp * sin(u * 6.28318 * f + uTime * sp * 4.0 + ph) + amp * 0.35 * sin(u * 11.0 - uTime * sp * 2.3 + ph * 1.7);
  float thick = th * (0.55 + 0.45 * sin(u * 5.0 + uTime * 0.35 + ph));
  float d = p.y - (base + wav);                       // below the top edge when > 0
  float px = 1.0 / uRes.y;
  float fade = smoothstep(0.0, 0.35, u) * (1.0 - smoothstep(0.78, 1.02, u)) * (0.75 + 0.25 * smoothstep(0.35, 0.8, u));
  float sheet = smoothstep(-1.5 * px, 1.5 * px, d) * exp(-max(d, 0.0) / (thick * 0.55)) * (1.0 - smoothstep(thick * 0.9, thick * 1.6, d));
  float line = exp(-(d * d) / (2.0 * (1.1 * px) * (1.1 * px)));
  float glow = exp(-(d * d) / (2.0 * (9.0 * px) * (9.0 * px)));
  return vec2(sheet * a, (line * 1.25 + glow * 0.35) * a * 1.6) * fade;
}

void main() {
  vec2 frag = vec2(vUv.x, 1.0 - vUv.y) * uRes;         // pixels, y down
  vec2 p = frag / uRes;                                // 0..1, y down
  // background gradient, along (0.35w, h) like the PS4 theme
  vec2 dir = vec2(0.35 * uRes.x, uRes.y);
  float g = clamp(dot(frag, dir) / dot(dir, dir), 0.0, 1.0);
  vec3 col = g < 0.55 ? mix(uTop, uMid, g / 0.55) : mix(uMid, uLow, (g - 0.55) / 0.45);
  // soft light pool in the lower right
  float r = length((frag - vec2(0.82 * uRes.x, 1.05 * uRes.y)) / uRes.x) / 0.7;
  col += uWave * 0.22 * max(0.0, 1.0 - r) * max(0.0, 1.0 - r);
  if (uWaves > 0.5) {
    vec2 w = vec2(0.0);
    w += ribbon(p, 1.12, 0.62, 0.28, 0.035, 1.4, 0.16, 0.0, 0.07, 0.10);
    w += ribbon(p, 1.02, 0.48, 0.36, 0.045, 1.1, -0.12, 2.1, 0.05, 0.08);
    w += ribbon(p, 1.25, 0.66, 0.20, 0.030, 1.8, 0.09, 4.0, 0.10, 0.07);
    w += ribbon(p, 0.95, 0.30, 0.42, 0.050, 0.9, 0.07, 5.2, 0.035, 0.06);
    w += ribbon(p, 1.18, 0.70, 0.10, 0.025, 2.3, -0.05, 1.3, 0.06, 0.045);
    col += uWave * (w.x * 1.8 + w.y * 1.15);
  }
  col += (hash(frag + fract(uTime)) - 0.5) / 255.0;    // dithering: no banding in the gradients
  gl_FragColor = vec4(col, 1.0);
}`;

const PVERT = `attribute float aId;
uniform vec2 uRes; uniform float uTime, uScale;
varying float vA;
float h(float n) { return fract(sin(n * 91.345) * 47453.5453); }
void main() {
  float vy = 0.012 + h(aId + 1.0) * 0.035, vx = 0.004 + h(aId + 2.0) * 0.012;
  float y = fract(h(aId + 3.0) - uTime * vy);
  float x = fract(h(aId + 4.0) * 0.9 + uTime * vx);
  float tw = h(aId + 5.0) * 6.2832 + uTime * 1.6;
  vA = (0.25 + h(aId + 6.0) * 0.6) * (0.55 + 0.45 * sin(tw)) * smoothstep(0.0, 0.12, y) * smoothstep(1.0, 0.85, y);
  gl_Position = vec4(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  gl_PointSize = (3.6 + h(aId + 7.0) * 14.4) * uScale;
}`;

const PFRAG = `precision mediump float;
varying float vA; uniform vec3 uWave;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = exp(-d * d * 18.0), halo = exp(-d * d * 3.0) * 0.7;
  vec3 c = mix(uWave, vec3(1.0), core);
  gl_FragColor = vec4(c * (core + halo) * vA * (1.0 - smoothstep(0.8, 1.0, d)), 1.0);
}`;

function program(gl, vs, fs) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

export class GLWaves {
  // throws when WebGL isn't available; the caller falls back to the 2D canvas
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('no WebGL');
    this.gl = gl;
    this.canvas = canvas;
    this.bg = program(gl, VERT, FRAG);
    this.pt = program(gl, PVERT, PFRAG);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.count = 110;
    this.ids = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ids);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Array.from({ length: this.count }, (_, i) => i * 7.13 + 1)), gl.STATIC_DRAW);
    const U = (p, n) => gl.getUniformLocation(p, n);
    this.u = { res: U(this.bg, 'uRes'), time: U(this.bg, 'uTime'), waves: U(this.bg, 'uWaves'), top: U(this.bg, 'uTop'), mid: U(this.bg, 'uMid'), low: U(this.bg, 'uLow'), wave: U(this.bg, 'uWave') };
    this.pu = { res: U(this.pt, 'uRes'), time: U(this.pt, 'uTime'), scale: U(this.pt, 'uScale'), wave: U(this.pt, 'uWave') };
    this.aPos = gl.getAttribLocation(this.bg, 'aPos');
    this.aId = gl.getAttribLocation(this.pt, 'aId');
  }

  resize(w, h) { this.canvas.width = w; this.canvas.height = h; }

  // colors: { top, mid, low, wave } as [r, g, b] 0..255
  draw(t, colors, { waves = true, particles = true } = {}) {
    const { gl, canvas } = this;
    const c = v => v.map(x => x / 255);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.bg);
    gl.uniform2f(this.u.res, canvas.width, canvas.height);
    gl.uniform1f(this.u.time, t);
    gl.uniform1f(this.u.waves, waves ? 1 : 0);
    gl.uniform3fv(this.u.top, c(colors.top));
    gl.uniform3fv(this.u.mid, c(colors.mid));
    gl.uniform3fv(this.u.low, c(colors.low));
    gl.uniform3fv(this.u.wave, c(colors.wave));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(this.aPos);
    if (particles) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE); // light adds up, like 'lighter'
      gl.useProgram(this.pt);
      gl.uniform2f(this.pu.res, canvas.width, canvas.height);
      gl.uniform1f(this.pu.time, t);
      gl.uniform1f(this.pu.scale, canvas.height / 1080);
      gl.uniform3fv(this.pu.wave, c(colors.wave));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ids);
      gl.enableVertexAttribArray(this.aId);
      gl.vertexAttribPointer(this.aId, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, this.count);
      gl.disableVertexAttribArray(this.aId);
    }
  }
}
