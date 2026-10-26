/**
 * Redraws the desk behind the app in WebGL. The CSS gradients in index.html step one 8-bit level at
 * a time across the dark vignettes, which shows as stripes on large screens; here the same layers
 * are computed in floats and dithered by one level as the last step, so the steps disappear. The
 * CSS layers paint first and stay wherever WebGL isn't available. The shader must match them (side
 * vignette, bottom fade, moonlit bloom), or the desk shifts when the canvas takes over.
 */

/** oklch to gamma-encoded sRGB (0–1): browsers blend these layers in that space */
const oklchToSrgb = (l: number, c: number, h: number): [number, number, number] => {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (linear: number) => {
    const v = Math.min(1, Math.max(0, linear));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return [
    encode(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
    encode(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
    encode(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc),
  ];
};

const VERTEX = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 size;
uniform vec3 ink, dusk, moon;
float hash(vec2 q) {
  q = fract(q * vec2(443.897, 441.423));
  q += dot(q, q.yx + 19.19);
  return fract((q.x + q.y) * q.x);
}
vec3 over(vec3 base, vec3 c, float a) { return base * (1.0 - a) + c * a; }
void main() {
  vec2 uv = vec2(gl_FragCoord.x / size.x, 1.0 - gl_FragCoord.y / size.y);
  vec3 col = ink;
  col = over(col, vec3(0.0), max(0.0, 1.0 - min(uv.x, 1.0 - uv.x) / 0.2) * 0.25);
  float t = clamp((uv.y - 0.4) / 0.6, 0.0, 1.0);
  col = over(col, dusk, 0.8 * t * t * t);
  col = over(col, moon, 0.75 * max(0.0, 1.0 - length(vec2((uv.x - 0.5) / 0.5, uv.y))));
  float n = hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 17.31) - 1.0;
  gl_FragColor = vec4(col + n / 255.0, 1.0);
}`;

const setUp = (gl: WebGLRenderingContext) => {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined;
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  gl.uniform3fv(gl.getUniformLocation(program, "ink"), oklchToSrgb(0.165, 0.02, 262));
  gl.uniform3fv(gl.getUniformLocation(program, "dusk"), oklchToSrgb(0.1, 0.02, 265));
  gl.uniform3fv(gl.getUniformLocation(program, "moon"), oklchToSrgb(0.23, 0.035, 258));
  return gl.getUniformLocation(program, "size");
};

export const paintDesk = () => {
  const cssLayers = document.querySelectorAll("[data-desk-css]");
  const canvas = document.createElement("canvas");
  canvas.dataset.desk = "";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: "-2",
    pointerEvents: "none",
  });
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false });
  if (!gl) return;
  let size = setUp(gl);
  if (!size) return;

  document.body.prepend(canvas);
  const draw = () => {
    if (!size || gl.isContextLost()) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(size, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  draw();
  for (const layer of cssLayers) layer.remove();

  let frame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  });
  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", () => {
    size = setUp(gl);
    draw();
  });
};
