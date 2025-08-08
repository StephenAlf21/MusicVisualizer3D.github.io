/*
  p5-background.js (revamped)
  - Theme-aware (reads CSS variables, updates when html.tw-light toggles)
  - Long-run stable trails (no color drift)
  - Noise-field motion + wrap-around edges
  - Spatial hashing for connections (better perf)
  - Respects prefers-reduced-motion, pauses when tab hidden
*/

let particles = [];
let grid = null;               // spatial hash grid
let pg;                        // offscreen graphics for trails
let theme = null;              // { bg:[r,g,b], accents:[p5.color,...] }
let reducedMotion = false;

const CONFIG = {
  densityBase: 0.045,          // particles per 1k px (scaled by area)
  radiusMin: 1.2,
  radiusMax: 3.2,
  speed: 0.5,                  // base speed (scaled by noise)
  connectionRadius: 110,
  maxConnectionsPerParticle: 3,
  fadeAlpha: 28,               // trail fade; higher = shorter trail
  frameRate: 60,
  noiseScale: 0.0016,
  noiseStrength: 1.2,
};

class SpatialGrid {
  constructor(cellSize) {
    this.cell = cellSize;
    this.map = new Map();
  }
  key(cx, cy) { return cx + ',' + cy; }
  insert(p) {
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    const k = this.key(cx, cy);
    if (!this.map.has(k)) this.map.set(k, []);
    this.map.get(k).push(p);
    p._cell = [cx, cy];
  }
  neighbors(p) {
    const out = [];
    const [cx, cy] = p._cell || [Math.floor(p.x / this.cell), Math.floor(p.y / this.cell)];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const k = this.key(cx + dx, cy + dy);
        const bucket = this.map.get(k);
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  }
  clear() { this.map.clear(); }
}

function hexToRgbArray(hex, fallback = [255, 255, 255]) {
  if (!hex) return fallback;
  let s = String(hex).trim();
  if (s.startsWith('--')) return fallback;
  // support rgb() as well
  if (s.startsWith('rgb')) {
    const m = s.match(/(\d+(\.\d+)?)/g);
    if (m && m.length >= 3) return [Number(m[0]), Number(m[1]), Number(m[2])];
    return fallback;
  }
  if (s[0] === '#') s = s.slice(1);
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  if (s.length !== 6) return fallback;
  const num = parseInt(s, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function readThemeFromCSS() {
  const cs = getComputedStyle(document.documentElement);
  const bg = hexToRgbArray(cs.getPropertyValue('--bg-primary') || '#121212', [18, 18, 18]);
  const a1 = hexToRgbArray(cs.getPropertyValue('--accent-primary') || '#e53e3e', [229, 62, 62]);
  const a2 = hexToRgbArray(cs.getPropertyValue('--accent-secondary') || '#4299e1', [66, 153, 225]);
  const a3 = hexToRgbArray(cs.getPropertyValue('--accent-tertiary') || '#f6e05e', [246, 224, 94]);
  return {
    bg,
    accents: [color(a1[0], a1[1], a1[2]), color(a2[0], a2[1], a2[2]), color(a3[0], a3[1], a3[2])]
  };
}

class Particle {
  constructor() {
    this.x = random(width);
    this.y = random(height);
    this.r = random(CONFIG.radiusMin, CONFIG.radiusMax);
    this.color = random(theme.accents);
    this.noiseSeed = random(1000);
    this.connections = 0;
  }
  step(t) {
    // noise flow field
    const n = noise(this.x * CONFIG.noiseScale, this.y * CONFIG.noiseScale, this.noiseSeed + t * 0.001);
    const ang = n * TAU * CONFIG.noiseStrength;
    const spd = CONFIG.speed * (reducedMotion ? 0.3 : 1);
    this.x += cos(ang) * spd;
    this.y += sin(ang) * spd;

    // wrap-around edges
    if (this.x < -this.r) this.x = width + this.r;
    if (this.x > width + this.r) this.x = -this.r;
    if (this.y < -this.r) this.y = height + this.r;
    if (this.y > height + this.r) this.y = -this.r;
  }
  draw() {
    pg.noStroke();
    pg.fill(this.color);
    pg.circle(this.x, this.y, this.r);
  }
  resetConnections() { this.connections = 0; }
}

function desiredParticleCount() {
  // ~ densityBase per 1000px², clamp sensible bounds
  const areaK = (windowWidth * windowHeight) / 1000;
  const base = areaK * CONFIG.densityBase;
  return Math.round(constrain(base, 30, 160));
}

function rebuildParticles(count) {
  particles.length = 0;
  for (let i = 0; i < count; i++) particles.push(new Particle());
}

function setup() {
  const cvs = createCanvas(windowWidth, windowHeight);
  cvs.parent('p5-canvas-container');
  // draw trails to offscreen buffer, then blit onto main canvas
  pg = createGraphics(windowWidth, windowHeight);
  pg.pixelDensity(1); // keep buffer cheap

  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  frameRate(reducedMotion ? 30 : CONFIG.frameRate);

  theme = readThemeFromCSS();
  rebuildParticles(desiredParticleCount());
  grid = new SpatialGrid(CONFIG.connectionRadius * 0.8);

  // Pause when hidden to avoid runaway timers/animation glitches
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) noLoop();
    else loop();
  });

  // React to theme changes (html class toggles)
  const mo = new MutationObserver(() => {
    theme = readThemeFromCSS(); // re-read CSS variables
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

function draw() {
  // Fade trails slightly each frame (no color drift)
  pg.noStroke();
  pg.fill(theme.bg[0], theme.bg[1], theme.bg[2], CONFIG.fadeAlpha);
  pg.rect(0, 0, pg.width, pg.height);

  // rebuild grid
  grid.clear();
  for (const p of particles) { p.resetConnections(); grid.insert(p); }

  // animate + draw nodes
  const t = millis();
  for (const p of particles) {
    p.step(t);
    p.draw();
  }

  // connect near neighbors (cap connections for perf/clarity)
  const maxDistSq = CONFIG.connectionRadius * CONFIG.connectionRadius;
  pg.strokeWeight(1);
  for (const p of particles) {
    if (p.connections >= CONFIG.maxConnectionsPerParticle) continue;
    const neighbors = grid.neighbors(p);
    // lightweight pass: check a subset ordered by proximity heuristic
    let made = 0;
    for (let i = 0; i < neighbors.length && made < CONFIG.maxConnectionsPerParticle; i++) {
      const q = neighbors[i];
      if (q === p || q.connections >= CONFIG.maxConnectionsPerParticle) continue;
      const dx = p.x - q.x, dy = p.y - q.y;
      const dsq = dx * dx + dy * dy;
      if (dsq > maxDistSq) continue;

      // line color is a blend; opacity from distance
      const mix = lerpColor(p.color, q.color, 0.5);
      const a = map(sqrt(dsq), 0, CONFIG.connectionRadius, 160, 0);
      mix.setAlpha(a);
      pg.stroke(mix);
      pg.line(p.x, p.y, q.x, q.y);

      p.connections++; q.connections++; made++;
    }
  }

  // blit the trails layer to the visible canvas
  clear();                  // keep page behind visible
  image(pg, 0, 0);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  pg.resizeCanvas(windowWidth, windowHeight);
  rebuildParticles(desiredParticleCount());
  grid = new SpatialGrid(CONFIG.connectionRadius * 0.8);
}
