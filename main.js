import * as THREE from "three";

// ---------------------------------------------------------------------------
// Config  (1 scene unit = 1000 km, so Earth radius = 6.371)
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const QUALITY = params.get("q") || "high";            // high | low (low = fewer polygons, no clouds)
const MANUAL = params.get("manual") === "1";         // deterministic frame-by-frame (video render) mode
const SIM_SPEED = parseFloat(params.get("speed") || "60");  // simulated seconds per real second
const ALT_EXAG = parseFloat(params.get("exag") || "2.6");   // exaggerate orbit height so shells are visible
const R_E = 6.371;
const R_MOON = 1.737;
const MOON_DIST = 384.4;

// shells: planes, sats/plane, inclination, altitude(km), active fraction  -> sums to 10,000
const SHELLS = [
  [72, 80, 53.0, 550, 0.72],
  [36, 50, 43.0, 540, 0.70],
  [36, 40, 70.0, 570, 0.70],
  [20, 50, 97.6, 560, 0.70],
];
const N = SHELLS.reduce((a, s) => a + s[0] * s[1], 0);

// deterministic RNG so every run looks the same
let seed = 1337;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000004, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.02, 4000);
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const SUN_DIR = new THREE.Vector3(1, 0.25, 0.55).normalize();
const loader = new THREE.TextureLoader();
const tex = (name, srgb = true) => {
  const t = loader.load("./textures/" + name);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

// ---------------------------------------------------------------------------
// Stars + faint Milky Way band
// ---------------------------------------------------------------------------
{
  const n = 7000;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x, y, z;
    if (i < 2200) {   // dense band
      const a = rnd() * Math.PI * 2, spread = (rnd() + rnd() + rnd() - 1.5) * 0.28;
      x = Math.cos(a); z = Math.sin(a); y = spread;
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      // tilt the band
      const ty = y * 0.8 + z * 0.6, tz = -y * 0.6 + z * 0.8; y = ty; z = tz;
    } else {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      x = s * Math.cos(a); y = u; z = s * Math.sin(a);
    }
    pos.set([x * 2500, y * 2500, z * 2500], i * 3);
    const b = 0.25 + Math.pow(rnd(), 3) * 0.9, tint = 0.85 + rnd() * 0.3;
    col.set([b * tint, b * (0.9 + rnd() * 0.1), b * (1.15 - (tint - 0.85))], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false });
  scene.add(new THREE.Points(g, m));
}

// ---------------------------------------------------------------------------
// Earth (custom day/night shader) + clouds + atmosphere
// ---------------------------------------------------------------------------
const seg = QUALITY === "low" ? [64, 48] : [128, 96];
const earthGroup = new THREE.Group();
scene.add(earthGroup);

const earthMat = new THREE.ShaderMaterial({
  uniforms: {
    dayMap: { value: tex("earth_atmos_2048.jpg") },
    nightMap: { value: tex("earth_lights_2048.png") },
    specMap: { value: tex("earth_specular_2048.jpg", false) },
    cloudMap: { value: (() => { const t = tex("earth_clouds_1024.png", false); t.wrapS = THREE.RepeatWrapping; return t; })() },
    uSun: { value: SUN_DIR },
    uCloudShift: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv; varying vec3 vN; varying vec3 vP;
    void main(){
      vUv = uv;
      vN = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position,1.0);
      vP = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    uniform sampler2D dayMap, nightMap, specMap, cloudMap;
    uniform vec3 uSun; uniform float uCloudShift;
    varying vec2 vUv; varying vec3 vN; varying vec3 vP;
    void main(){
      vec3 N = normalize(vN), L = normalize(uSun), V = normalize(cameraPosition - vP);
      float ndl = dot(N, L);
      float dayAmt = smoothstep(-0.14, 0.22, ndl);
      vec3 day = texture2D(dayMap, vUv).rgb;
      vec3 night = texture2D(nightMap, vUv).rgb;
      float spec = texture2D(specMap, vUv).r;
      float cl = texture2D(cloudMap, vUv + vec2(uCloudShift, 0.0)).a;
      vec3 dayCol = day * (0.03 + max(ndl, 0.0) * 1.25);
      dayCol = mix(dayCol, vec3(1.0) * (0.03 + max(ndl,0.0) * 0.95), cl * 0.62);
      vec3 nightCol = night * vec3(1.35, 1.0, 0.6) * 1.5 * (1.0 - cl * 0.6) + day * 0.012;
      vec3 H = normalize(L + V);
      float glint = pow(max(dot(N, H), 0.0), 420.0) * spec * dayAmt * 0.55 * (1.0 - cl);
      float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      vec3 rim = vec3(0.25, 0.55, 1.0) * fres * (0.25 + 0.9 * dayAmt) * 1.2;
      vec3 col = mix(nightCol, dayCol, dayAmt) + glint * vec3(0.8, 0.9, 1.0) + rim;
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
});
const earth = new THREE.Mesh(new THREE.SphereGeometry(R_E, seg[0], seg[1]), earthMat);
earthGroup.add(earth);

// atmosphere halo
const atmo = new THREE.Mesh(
  new THREE.SphereGeometry(R_E * 1.035, 96, 64),
  new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vN; varying vec3 vW;
      void main(){ vN = normalize(normalMatrix * normal); vW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vW;
      void main(){
        float i = pow(max(0.62 - dot(vN, vec3(0.0,0.0,1.0)), 0.0), 3.2) * 2.4;
        float lit = 0.35 + 0.65 * smoothstep(-0.35, 0.45, dot(vW, normalize(uSun)));
        gl_FragColor = vec4(vec3(0.28, 0.58, 1.0) * i * lit, i * lit);
      }`,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  })
);
scene.add(atmo);

// ---------------------------------------------------------------------------
// Moon (real distance and size) + orbit line
// ---------------------------------------------------------------------------
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(R_MOON, 48, 32),
  new THREE.MeshStandardMaterial({ map: tex("moon_1024.jpg"), roughness: 1, metalness: 0 })
);
scene.add(moon);
scene.add(new THREE.AmbientLight(0x6a7894, 1.1));
const sunLight = new THREE.DirectionalLight(0xfff4e6, 3.2);
sunLight.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sunLight);

const MOON_INC = THREE.MathUtils.degToRad(5.1);
const moonPos = (simT) => {
  const a = (simT / (27.32 * 86400)) * Math.PI * 2 + 0.8;
  return new THREE.Vector3(Math.cos(a) * MOON_DIST, Math.sin(a) * Math.sin(MOON_INC) * MOON_DIST, Math.sin(a) * Math.cos(MOON_INC) * MOON_DIST);
};
{
  const pts = [];
  for (let i = 0; i <= 256; i++) pts.push(moonPos(i / 256 * 27.32 * 86400));
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0x7c8aa8, dashSize: 4, gapSize: 4, transparent: true, opacity: 0.7 }));
  l.computeLineDistances();
  scene.add(l);
}

// ---------------------------------------------------------------------------
// Satellites: positions computed on the GPU from orbital elements
// ---------------------------------------------------------------------------
const aElem = new Float32Array(N * 4);   // raan, inc, radius, u0
const aRate = new Float32Array(N);
const aAct = new Float32Array(N);
{
  let k = 0;
  for (const [planes, per, incl, alt, act] of SHELLS) {
    for (let p = 0; p < planes; p++) {
      const raan = (2 * Math.PI * p) / planes, phase = rnd();
      for (let s = 0; s < per; s++) {
        aElem.set([raan, THREE.MathUtils.degToRad(incl), R_E + (alt * ALT_EXAG) / 1000 + (rnd() - 0.5) * 0.06, 2 * Math.PI * ((s + phase) / per)], k * 4);
        aRate[k] = (2 * Math.PI) / (95 * 60) * (1 + 0.01 * (incl - 53) / 40);
        aAct[k] = rnd() < act ? 1 : 0;
        k++;
      }
    }
  }
}
const satGeom = new THREE.BufferGeometry();
satGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));  // dummy
satGeom.setAttribute("aElem", new THREE.BufferAttribute(aElem, 4));
satGeom.setAttribute("aRate", new THREE.BufferAttribute(aRate, 1));
satGeom.setAttribute("aAct", new THREE.BufferAttribute(aAct, 1));
const satMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uSize: { value: 52 }, uHi: { value: -1 } },
  vertexShader: `
    attribute vec4 aElem; attribute float aRate; attribute float aAct;
    uniform float uTime, uSize; varying float vAct;
    void main(){
      float u = aElem.w + aRate * uTime, r = aElem.z;
      float xo = r * cos(u), yo = r * sin(u);
      float ci = cos(aElem.y), si = sin(aElem.y), co = cos(aElem.x), so = sin(aElem.x);
      vec3 p = vec3(xo*co - yo*ci*so, yo*si, xo*so + yo*ci*co);   // y is north
      vec4 mv = viewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(uSize / max(-mv.z, 0.01), 1.5, 5.0);
      vAct = aAct;
    }`,
  fragmentShader: `
    varying float vAct;
    void main(){
      vec2 c = gl_PointCoord - 0.5; float d = length(c);
      if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.05, d);
      vec3 col = vAct > 0.5 ? vec3(1.0) : vec3(0.25, 0.55, 1.0);
      gl_FragColor = vec4(col * (0.35 + 0.65 * a), a * 0.9);
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const sats = new THREE.Points(satGeom, satMat);
sats.frustumCulled = false;
scene.add(sats);

// same maths on the CPU for camera chase / labels / counts
const _p = new THREE.Vector3();
function satPos(i, simT, out = _p) {
  const raan = aElem[i * 4], inc = aElem[i * 4 + 1], r = aElem[i * 4 + 2];
  const u = aElem[i * 4 + 3] + aRate[i] * simT;
  const xo = r * Math.cos(u), yo = r * Math.sin(u);
  const ci = Math.cos(inc), si = Math.sin(inc), co = Math.cos(raan), so = Math.sin(raan);
  return out.set(xo * co - yo * ci * so, yo * si, xo * so + yo * ci * co);
}

// faint orbit rings
{
  const verts = [];
  const tmp = new THREE.Vector3();
  let base = 0;
  for (const [planes, per, incl, alt] of SHELLS) {
    const step = planes > 40 ? 6 : 4;
    for (let p = 0; p < planes; p += step) {
      const raan = (2 * Math.PI * p) / planes, inc = THREE.MathUtils.degToRad(incl), r = R_E + (alt * ALT_EXAG) / 1000;
      const ci = Math.cos(inc), si = Math.sin(inc), co = Math.cos(raan), so = Math.sin(raan);
      let prev = null;
      for (let s = 0; s <= 160; s++) {
        const u = (s / 160) * Math.PI * 2, xo = r * Math.cos(u), yo = r * Math.sin(u);
        tmp.set(xo * co - yo * ci * so, yo * si, xo * so + yo * ci * co);
        if (prev) verts.push(prev.x, prev.y, prev.z, tmp.x, tmp.y, tmp.z);
        prev = tmp.clone();
      }
    }
    base++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2f6bff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })));
}

// ---------------------------------------------------------------------------
// Cinematic camera director ("game" style shots)
// ---------------------------------------------------------------------------
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ease = (t) => { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); };
const D2R = Math.PI / 180;
const earthRot = (simT) => simT * (Math.PI * 2 / 86164) - 3.78;
const SUN_AZ = Math.atan2(SUN_DIR.z, SUN_DIR.x);
const CH = [101, 1234, 3333, 4567, 6200, 7001, 8100, 8800, 9500, 2345, 5678, 9900];

const orbitPose = (az, el, d) => ({ pos: V(Math.cos(az) * Math.cos(el) * d, Math.sin(el) * d, Math.sin(az) * Math.cos(el) * d), look: V(), fov: 50 });
const dayShot = (name, off, el, dist, dur) => ({ type: "orbit", name, dur, pose: (t) =>
  orbitPose(SUN_AZ + off + t * 0.03, el + 0.1 * Math.sin(t * 0.13), dist - 1.3 * Math.sin(t * 0.1)) });
const nightShot = (off, dur) => ({ type: "orbit", name: "NIGHT SIDE · CITY LIGHTS", dur, pose: (t) =>
  orbitPose(SUN_AZ + Math.PI + off + t * 0.03, 0.22 + 0.1 * Math.sin(t * 0.11), 18 - 1.0 * Math.sin(t * 0.1)) });
const polarShot = (dur, flip) => ({ type: "orbit", name: "POLAR VIEW", dur, pose: (t) =>
  orbitPose(SUN_AZ + 0.4 + t * 0.05, (flip ? -1 : 1) * (1.12 + 0.05 * Math.sin(t * 0.1)), 19) });
const chaseShot = (idx, dur, side) => ({ type: "chase", name: "SATELLITE CHASE CAM", dur, idx, pose: (t, simT) => {
  const p = satPos(idx, simT, V()), p2 = satPos(idx, simT + 4, V());
  const vel = p2.clone().sub(p).normalize(), up = p.clone().normalize(), rt = up.clone().cross(vel).normalize();
  const pos = p.clone().addScaledVector(vel, -0.75).addScaledVector(up, 0.32).addScaledVector(rt, side * 0.35 + 0.18 * Math.sin(t * 0.3));
  return { pos, look: p.clone().addScaledVector(vel, 2.5), fov: 62 };
} });
const moonShot = (dur) => ({ type: "moon", name: "EARTH – MOON (REAL SCALE)", dur, pose: (t, simT) => {
  const m = moonPos(simT), mid = m.clone().multiplyScalar(0.5);
  const k = ease(t / (dur * 0.42)) * (1 - ease((t - dur * 0.64) / (dur * 0.36)));
  const side = V(-m.z, 0, m.x).normalize();
  const farPos = mid.clone().addScaledVector(side, 600).add(V(0, 110, 0));
  return { pos: V(17, 7, 15).lerp(farPos, k), look: mid.clone().multiplyScalar(k), fov: 50 };
} });
const flybyShot = (tiltDeg, node, speed, dur) => ({ type: "flyby", name: "LOW ORBIT FLYBY", dur, pose: (t) => {
  const tilt = tiltDeg * D2R, ang = t * speed + 1.0, r = R_E + 2.6 + 0.4 * Math.sin(t * 0.4);
  const at = (a, rr) => V(Math.cos(a) * rr, Math.sin(a) * rr * Math.sin(tilt), Math.sin(a) * rr * Math.cos(tilt)).applyAxisAngle(V(0, 1, 0), node);
  return { pos: at(ang, r), look: at(ang + 0.16, R_E + 0.2), fov: 68 };
} });

// Build the ~15 minute programme from a repeating pattern with varied parameters
const SHOTS = [];
{
  const TARGET = 900;
  let sum = 0, c = 0;
  while (sum < TARGET - 20) {
    const cyc = [
      dayShot("ORBITAL VIEW", [0.3, -0.7, 0.9, -0.2][c % 4], [0.38, 0.15, 0.5, 0.28][c % 4], [21, 16, 24, 19][c % 4], 36),
      chaseShot(CH[(c * 3) % CH.length], 28, c % 2 ? -1 : 1),
      flybyShot([40, 70, 20, 55][c % 4], c * 1.3, 0.11, 28),
      nightShot(c * 0.5 - 0.3, 34),
      c % 2 === 0 ? moonShot(40) : dayShot("DAY SIDE", -0.4 + c * 0.2, 0.2, 14.5, 34),
      chaseShot(CH[(c * 3 + 1) % CH.length], 28, c % 2 ? 1 : -1),
      polarShot(32, c % 2 === 1),
      flybyShot([30, 62, 48, 25][c % 4], c * 2.1 + 0.7, 0.12, 28),
    ];
    for (const sh of cyc) { if (sum >= TARGET - 20) break; SHOTS.push(sh); sum += sh.dur; }
    c++;
  }
  SHOTS[SHOTS.length - 1].dur += TARGET - sum;     // land exactly on 15:00
}
const TOTAL = SHOTS.reduce((a, s) => a + s.dur, 0);
const BLEND = 4;
const camPose = { pos: V(), look: V(), fov: 50 };
let chaseIdx = CH[0];
function directCamera(T, simT) {
  let t = T % TOTAL, k = 0;
  while (t >= SHOTS[k].dur) { t -= SHOTS[k].dur; k++; }
  const cur = SHOTS[k].pose(t, simT);
  let pos = cur.pos, look = cur.look, fov = cur.fov;
  if (t < BLEND) {
    const pk = (k + SHOTS.length - 1) % SHOTS.length, prev = SHOTS[pk].pose(SHOTS[pk].dur + t, simT);
    const w = ease(t / BLEND);
    pos = prev.pos.clone().lerp(cur.pos, w); look = prev.look.clone().lerp(cur.look, w); fov = prev.fov + (cur.fov - prev.fov) * w;
  }
  camPose.pos.copy(pos); camPose.look.copy(look); camPose.fov = fov;
  camera.position.copy(pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(look);
  camera.updateMatrixWorld(true);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  if (SHOTS[k].type === "chase") chaseIdx = SHOTS[k].idx;
  return { k, t, name: SHOTS[k].name, type: SHOTS[k].type };
}


// glow markers so Earth and Moon stay visible at true scale
function glowSprite(rgb) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.18, `rgba(${rgb},0.9)`);
  gr.addColorStop(0.45, `rgba(${rgb},0.25)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sp.visible = false; scene.add(sp); return sp;
}
const earthGlow = glowSprite("90,170,255"), moonGlow = glowSprite("215,220,235");
function updateGlows(simT) {
  const mp = moonPos(simT);
  for (const [sp, pos, rad] of [[earthGlow, V(), R_E], [moonGlow, mp, R_MOON]]) {
    const d = camera.position.distanceTo(pos);
    const on = d > 90;
    sp.visible = on;
    if (on) { sp.position.copy(pos); sp.scale.setScalar(Math.max(rad * 3, d * 0.034)); }
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const FACTS = [
  "Starlink is the largest satellite constellation ever built",
  "Each Starlink satellite circles Earth every ~95 minutes",
  "Starlink satellites travel at about 7.6 km/s (27,000 km/h)",
  "The Moon is ~384,400 km away - about 60x farther than the 3D shells shown here",
  "Starlink orbits at ~550 km in Low Earth Orbit (LEO)",
  "Falcon 9 rockets launch up to ~25 Starlink satellites at a time",
  "Starlink satellites use ion thrusters to raise and lower their orbit",
  "Orbit heights here are exaggerated so the shells are visible",
  "Lower orbit means lower latency: internet from space in ~30 ms",
  "Earth-Moon scene is shown at true distance and size",
  "Starlink satellites have solar panels and use lasers to link to each other in space",
  "A Starlink satellite weighs roughly 300-800 kg depending on the version",
  "Falcon 9 first stages land and are reused - cutting the cost of each launch",
  "Satellites are visible as a bright 'train' shortly after each launch",
  "Starlink dishes find satellites automatically as they cross the sky every few minutes",
  "At 550 km, a satellite sees about 1,000 km of ground in every direction",
  "Every Starlink satellite is built to be deorbited at the end of its life",
  "City lights on the night side are real - captured by satellites from space",
  "The Earth turns once every ~24 hours - 1,670 km/h at the equator",
  "Low Earth Orbit begins about 160 km up and extends to ~2,000 km",
];
let lastShot = "", factIdx = -1;
function projectTag(el, world, show = true) {
  const v = world.clone().project(camera);
  if (!show || v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) { el.style.display = "none"; return false; }
  el.style.display = "block";
  el.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + "px";
  el.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + "px";
  return true;
}
const camDir = new THREE.Vector3();
let inview = 0, hiIdx = 0, hiCycle = -1;
function updateHud(T, simT, shot, frame) {
  if (shot.name !== lastShot) {
    lastShot = shot.name;
    const n = $("shotName");
    if (MANUAL) n.textContent = shot.name;
    else { n.style.opacity = 0; setTimeout(() => { n.textContent = shot.name; n.style.opacity = 1; }, 450); }
  }
  const fi = Math.floor(T / 14) % FACTS.length;
  if (fi !== factIdx) {
    factIdx = fi;
    const t = $("ticker");
    if (MANUAL) $("fact").textContent = FACTS[fi];
    else { t.style.opacity = 0; setTimeout(() => { $("fact").textContent = FACTS[fi]; t.style.opacity = 1; }, 600); }
  }
  if (MANUAL) {
    const ph = (T % 14) / 14, f = Math.min(1, ph * 8, (1 - ph) * 8);
    $("ticker").style.opacity = f;
    const sp = (T % 1) ; $("shotName").style.opacity = Math.min(1, ((T % TOTAL) % 1000) / 0.6);
  }
  if (frame % (MANUAL ? 1 : 10) === 0) {
    const when = MANUAL ? new Date(BASE_MS + simT * 1000) : new Date();
    $("clock").textContent = (MANUAL ? "SIM  " : "UTC   ") + when.toISOString().replace("T", " ").slice(0, 19);
    // satellites above the horizon as seen from the camera (not hidden behind Earth)
    const c = camera.position, cc = c.lengthSq(), lim = R_E * R_E;
    let n = 0;
    for (let i = 0; i < N; i += 1) {
      satPos(i, simT, _p);
      if (_p.dot(c) > lim) n++;
    }
    inview = n;
    $("inview").textContent = "~ " + n.toLocaleString();
  }
  // highlighted satellite tag (orbital + chase shots)
  const cyc = Math.floor(T / 10);
  if (cyc !== hiCycle) { hiCycle = cyc; hiIdx = Math.floor(((cyc * 2654435761) >>> 0) % N); }
  const showSat = shot.type !== "moon";
  const idx = shot.type === "chase" ? chaseIdx : hiIdx;
  satPos(idx, simT, _p);
  const facing = _p.dot(camera.position) > R_E * R_E * 0.98;
  if (showSat && facing && projectTag($("satTag"), _p.clone())) {
    const alt = 540 + ((aElem[idx * 4 + 2] - R_E) / (ALT_EXAG / 1000) - 540) ;
    $("satName").textContent = "STARLINK-" + (4000 + idx);
    $("satInfo").textContent = "Alt " + Math.round(Math.min(570, Math.max(540, alt))) + " km | 7.6 km/s";
  } else $("satTag").style.display = "none";
  // Earth/Moon labels in the real-scale shot
  const far = shot.type === "moon" && camera.position.length() > 120;
  projectTag($("earthTag"), V(0, R_E * 1.8, 0), far);
  const mp = moonPos(simT);
  projectTag($("moonTag"), mp.clone().add(V(0, R_MOON * 2, 0)), far);
  if (far) $("moonDist").textContent = Math.round(mp.length() * 1000).toLocaleString() + " km";
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let frame = 0, fpsAcc = 0, fpsN = 0;
window.__fps = 0; window.__ready = false;
const SIM_EPOCH = 25000;       // start offset so orbits are already spread out
const BASE_MS = Date.UTC(2026, 9, 11, 0, 0, 0);
function renderAt(T) {
  const simT = SIM_EPOCH + T * SIM_SPEED;
  earth.rotation.y = simT * (Math.PI * 2 / 86164) - 3.78;   // starts facing India/Asia
  earthMat.uniforms.uCloudShift.value = -simT * 0.000002;
  satMat.uniforms.uTime.value = simT;
  moon.position.copy(moonPos(simT));
  moon.rotation.y = Math.PI;
  const shot = directCamera(T, simT);
  updateGlows(simT);
  updateHud(T, simT, shot, frame);
  renderer.render(scene, camera);
  frame++;
}
window.renderAt = (T) => { renderAt(T); return true; };
window.__total = TOTAL;
function tick() {
  const dt = clock.getDelta();
  renderAt(clock.elapsedTime);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 2) { window.__fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  requestAnimationFrame(tick);
}
const afterTextures = () => { window.__ready = true; };
THREE.DefaultLoadingManager.onLoad = afterTextures;
if (MANUAL) { renderAt(0); } else requestAnimationFrame(tick);
setTimeout(afterTextures, 4000);
