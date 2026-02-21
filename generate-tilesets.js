/**
 * Gerador de Tilesets - Originals World
 * Pixel art 32x32 estilo Tibia clássico com transições limpas
 * 
 * Gera tilesets:
 *   grass-dirt.png   - Grama ↔ Terra
 *   grass-stone.png  - Grama ↔ Pedra
 *   sand-water.png   - Areia ↔ Água
 *   grass-sand.png   - Grama ↔ Areia
 *   overlays.png     - Detalhes (pedrinhas, matinho, rachaduras)
 *
 * Layout de cada tileset (8 colunas x 4 linhas = 32 tiles):
 *  Row 0:  VarA0  VarA1  VarA2  VarA3  VarA4  VarB0  VarB1  VarB2
 *  Row 1:  EdgeT  EdgeB  EdgeL  EdgeR  ExtTL  ExtTR  ExtBL  ExtBR
 *  Row 2:  IntTL  IntTR  IntBL  IntBR  ComboTL ComboTR ComboBL ComboBR
 *  Row 3:  Ov0    Ov1    Ov2    Ov3    Ov4    Ov5    Ov6    Ov7
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const tilesetsDir = path.join(__dirname, 'public', 'assets', 'tilesets');
if (!fs.existsSync(tilesetsDir)) fs.mkdirSync(tilesetsDir, { recursive: true });

const S = 32;
const COLS = 8;
const ROWS = 4;

// ===================== PRNG =====================
function seededRand(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ===================== COLOR HELPERS =====================
function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

function lerpColor(hex1, hex2, t) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  t = Math.max(0, Math.min(1, t));
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

function darken(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

// ===================== PALETTES =====================
const PAL = {
  grass: {
    base:      '#3b8a2e',
    shades:    ['#358226', '#3f9232', '#368428', '#3d8e30', '#33802a'],
    highlight: '#4a9a3a',
    shadow:    '#2a6e1e',
    blade:     ['#4ca83c', '#52b044', '#48a038'],
    accent:    '#2e7420',
  },
  dirt: {
    base:      '#8a7050',
    shades:    ['#826848', '#927858', '#7e6444', '#88704e', '#7a6040'],
    highlight: '#9a8060',
    shadow:    '#6a5030',
    pebble:    ['#6a6050', '#5e5040', '#625848'],
    accent:    '#705838',
  },
  stone: {
    base:      '#8a8a8a',
    shades:    ['#7e7e7e', '#929292', '#868686', '#8e8e8e', '#848484'],
    highlight: '#9e9e9e',
    shadow:    '#6a6a6a',
    mortar:    '#4a4a4a',
    accent:    '#787878',
  },
  sand: {
    base:      '#c8b478',
    shades:    ['#c4b074', '#ccb87c', '#c0ac70', '#cab680', '#c6b276'],
    highlight: '#d8c890',
    shadow:    '#b09860',
    accent:    '#bca868',
  },
  water: {
    base:      '#1a5090',
    shades:    ['#184c88', '#1c5498', '#165088', '#1e5894', '#18508c'],
    highlight: '#2a6aaa',
    shadow:    '#103870',
    wave:      '#2462a0',
    sparkle:   '#4a8ac0',
  },
};

// ===================== CLEAN FILL FUNCTIONS =====================

function fillClean(ctx, ox, oy, rng, palette, variant) {
  const { base, shades, highlight, shadow } = palette;
  ctx.fillStyle = base;
  ctx.fillRect(ox, oy, S, S);

  // Subtle structured variation: patches scaled to tile size
  const numPatches = Math.floor(S * S / 65) + Math.floor(rng() * 3);
  for (let i = 0; i < numPatches; i++) {
    const px = Math.floor(rng() * (S - 1));
    const py = Math.floor(rng() * (S - 1));
    ctx.fillStyle = shades[Math.floor(rng() * shades.length)];
    const pw = rng() < 0.5 ? 2 : 1;
    const ph = rng() < 0.5 ? 2 : 1;
    ctx.fillRect(ox + px, oy + py, pw, ph);
  }

  if (variant % 3 === 0 && highlight) {
    ctx.fillStyle = highlight;
    ctx.fillRect(ox + 1 + Math.floor(rng() * Math.floor(S * 0.2)), oy + 1 + Math.floor(rng() * Math.floor(S * 0.15)), 2, 1);
  }
  if (variant % 3 === 1 && shadow) {
    ctx.fillStyle = shadow;
    ctx.fillRect(ox + Math.floor(S * 0.38) + Math.floor(rng() * Math.floor(S * 0.25)), oy + Math.floor(S * 0.38) + Math.floor(rng() * Math.floor(S * 0.25)), 1, 1);
  }
}

function fillGrass(ctx, ox, oy, rng, variant) {
  fillClean(ctx, ox, oy, rng, PAL.grass, variant);
  const bladeCount = Math.max(1, Math.floor(S / 10)) + (variant % 2);
  const bladeH = Math.max(2, Math.floor(S * 0.1));
  for (let i = 0; i < bladeCount; i++) {
    const bx = 3 + Math.floor(rng() * (S - 6));
    const by = 3 + Math.floor(rng() * (S - 3 - bladeH));
    ctx.fillStyle = PAL.grass.blade[Math.floor(rng() * PAL.grass.blade.length)];
    ctx.fillRect(ox + bx, oy + by, 1, bladeH);
    if (rng() < 0.4) ctx.fillRect(ox + bx + 1, oy + by + 1, 1, bladeH - 1);
  }
  if (variant % 5 < 2) {
    ctx.fillStyle = PAL.grass.accent;
    ctx.fillRect(ox + Math.floor(rng() * S), oy + Math.floor(rng() * S), 2, 1);
  }
}

function fillDirt(ctx, ox, oy, rng, variant) {
  fillClean(ctx, ox, oy, rng, PAL.dirt, variant);
  const pebbleCount = Math.max(1, Math.floor(S / 16)) + (variant % 3 === 0 ? 1 : 0);
  for (let i = 0; i < pebbleCount; i++) {
    const px = 2 + Math.floor(rng() * (S - 4));
    const py = 2 + Math.floor(rng() * (S - 4));
    ctx.fillStyle = PAL.dirt.pebble[Math.floor(rng() * PAL.dirt.pebble.length)];
    ctx.fillRect(ox + px, oy + py, 2, 1);
  }
}

function fillStone(ctx, ox, oy, rng, variant) {
  // Organic packed cobblestone - irregular gray stones with thin mortar
  ctx.fillStyle = PAL.stone.mortar;
  ctx.fillRect(ox, oy, S, S);
  const stColors = PAL.stone.shades;
  // Pre-defined stone layouts (x%, y%, w%, h%)
  const layouts = [
    [[0,0,35,26],[36,0,30,26],[67,0,33,26],
     [5,27,28,24],[34,27,33,24],[68,27,32,24],
     [0,52,33,24],[34,52,30,24],[65,52,35,24],
     [3,77,30,23],[34,77,34,23],[69,77,31,23]],
    [[0,0,32,25],[33,0,35,25],[69,0,31,25],
     [3,26,30,26],[34,26,30,26],[65,26,35,26],
     [0,53,34,24],[35,53,32,24],[68,53,32,24],
     [2,78,31,22],[34,78,34,22],[69,78,31,22]],
    [[0,0,48,25],[49,0,51,25],
     [3,26,30,25],[34,26,32,25],[67,26,33,25],
     [0,52,50,24],[51,52,49,24],
     [3,77,30,23],[34,77,34,23],[69,77,31,23]],
  ];
  const layout = layouts[variant % layouts.length];
  for (let i = 0; i < layout.length; i++) {
    const [px, py, pw, ph] = layout[i];
    const dx = ox + Math.floor(px * S / 100);
    const dy = oy + Math.floor(py * S / 100);
    const dw = Math.floor(pw * S / 100) - 1;
    const dh = Math.floor(ph * S / 100) - 1;
    if (dw < 1 || dh < 1) continue;
    ctx.fillStyle = stColors[(i + variant * 3) % stColors.length];
    ctx.fillRect(dx, dy, dw, dh);
    // Highlight top-left
    ctx.fillStyle = PAL.stone.highlight;
    ctx.fillRect(dx, dy, dw, 1);
    // Shadow bottom-right
    ctx.fillStyle = PAL.stone.shadow;
    ctx.fillRect(dx, dy + dh - 1, dw, 1);
    // Round corners
    ctx.fillStyle = PAL.stone.mortar;
    ctx.fillRect(dx, dy, 1, 1);
    ctx.fillRect(dx + dw - 1, dy, 1, 1);
    ctx.fillRect(dx, dy + dh - 1, 1, 1);
    ctx.fillRect(dx + dw - 1, dy + dh - 1, 1, 1);
  }
}

function fillSand(ctx, ox, oy, rng, variant) {
  fillClean(ctx, ox, oy, rng, PAL.sand, variant);
  if (variant % 3 === 0) {
    ctx.fillStyle = PAL.sand.highlight;
    const ry = 4 + Math.floor(rng() * (S - 8));
    for (let px = 1; px < S - 1; px++) {
      if (rng() < 0.6) ctx.fillRect(ox + px, oy + ry, 1, 1);
    }
  }
  if (variant % 4 === 1) {
    ctx.fillStyle = PAL.sand.shadow;
    ctx.fillRect(ox + Math.floor(rng() * (S - 2)) + 1, oy + Math.floor(rng() * (S - 2)) + 1, 2, 1);
  }
}

function fillWater(ctx, ox, oy, rng, variant) {
  ctx.fillStyle = PAL.water.base;
  ctx.fillRect(ox, oy, S, S);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = PAL.water.shades[Math.floor(rng() * PAL.water.shades.length)];
    ctx.fillRect(ox + Math.floor(rng() * (S - 2)), oy + Math.floor(rng() * (S - 2)), 2, 2);
  }
  ctx.fillStyle = PAL.water.wave;
  const wy = Math.floor(S * 0.35);
  for (let px = 0; px < S; px++) {
    const y = wy + Math.floor(Math.sin(px * 0.7 + variant) * 1.2);
    if (y >= 0 && y < S) ctx.fillRect(ox + px, oy + y, 1, 1);
  }
  ctx.fillStyle = PAL.water.sparkle;
  ctx.fillRect(ox + Math.floor(rng() * S), oy + Math.floor(rng() * S), 1, 1);
}

// ===================== TRANSITION BORDER LINE =====================

function generateBorderLine(rng, length, baseDepth, amplitude) {
  const line = [];
  const freq1 = 0.3 + rng() * 0.3;
  const freq2 = 0.6 + rng() * 0.4;
  const phase1 = rng() * Math.PI * 2;
  const phase2 = rng() * Math.PI * 2;

  for (let i = 0; i < length; i++) {
    const wave = Math.sin(i * freq1 + phase1) * amplitude * 0.6
               + Math.sin(i * freq2 + phase2) * amplitude * 0.4;
    line.push(Math.max(2, Math.min(length - 2, Math.round(baseDepth + wave))));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < length - 1; i++) {
      line[i] = Math.round((line[i - 1] + line[i] * 2 + line[i + 1]) / 4);
    }
  }
  return line;
}

// ===================== EDGE TRANSITIONS =====================

function drawEdge(ctx, ox, oy, rng, fillA, fillB, palA, palB, side) {
  fillA(ctx, ox, oy, seededRand(Math.floor(rng() * 99999)), 0);

  const depth = Math.max(6, Math.floor(S * 0.375));
  const amplitude = Math.max(2, Math.floor(S * 0.125));
  const border = generateBorderLine(rng, S, depth, amplitude);

  for (let i = 0; i < S; i++) {
    const d = border[i];
    for (let j = 0; j < d; j++) {
      let px, py;
      if (side === 'top')         { px = i; py = j; }
      else if (side === 'bottom') { px = i; py = S - 1 - j; }
      else if (side === 'left')   { px = j; py = i; }
      else                        { px = S - 1 - j; py = i; }
      ctx.fillStyle = (rng() < 0.15) ? palB.shades[Math.floor(rng() * palB.shades.length)] : palB.base;
      ctx.fillRect(ox + px, oy + py, 1, 1);
    }

    const bd = border[i];
    let bpx, bpy;
    if (side === 'top')         { bpx = i; bpy = bd; }
    else if (side === 'bottom') { bpx = i; bpy = S - 1 - bd; }
    else if (side === 'left')   { bpx = bd; bpy = i; }
    else                        { bpx = S - 1 - bd; bpy = i; }
    if (bpx >= 0 && bpx < S && bpy >= 0 && bpy < S) {
      ctx.fillStyle = lerpColor(palB.base, palA.base, 0.5);
      ctx.fillRect(ox + bpx, oy + bpy, 1, 1);
    }
  }

  // Shadow on transition edge
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let i = 0; i < S; i++) {
    const d = border[i];
    let spx, spy;
    if (side === 'top')         { spx = i; spy = d + 1; }
    else if (side === 'bottom') { spx = i; spy = S - 2 - d; }
    else if (side === 'left')   { spx = d + 1; spy = i; }
    else                        { spx = S - 2 - d; spy = i; }
    if (spx >= 0 && spx < S && spy >= 0 && spy < S) {
      ctx.fillRect(ox + spx, oy + spy, 1, 1);
    }
  }
}

// ===================== CORNER TRANSITIONS =====================

function drawCornerExt(ctx, ox, oy, rng, fillA, fillB, palA, palB, corner) {
  fillA(ctx, ox, oy, seededRand(Math.floor(rng() * 99999)), 0);

  const radius = Math.floor(S * 0.625) + Math.floor(rng() * Math.floor(S * 0.19));
  let cx, cy;
  if (corner === 'TL')      { cx = 0; cy = 0; }
  else if (corner === 'TR') { cx = S; cy = 0; }
  else if (corner === 'BL') { cx = 0; cy = S; }
  else                       { cx = S; cy = S; }

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const dx = px - cx, dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const jitter = Math.sin(Math.atan2(dy, dx) * 3) * (S / 10);
      if (dist < radius + jitter - 1) {
        ctx.fillStyle = (rng() < 0.15) ? palB.shades[Math.floor(rng() * palB.shades.length)] : palB.base;
        ctx.fillRect(ox + px, oy + py, 1, 1);
      } else if (dist < radius + jitter) {
        ctx.fillStyle = lerpColor(palB.base, palA.base, 0.5);
        ctx.fillRect(ox + px, oy + py, 1, 1);
      } else if (dist < radius + jitter + 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        ctx.fillRect(ox + px, oy + py, 1, 1);
      }
    }
  }
}

function drawCornerInt(ctx, ox, oy, rng, fillA, fillB, palA, palB, corner) {
  fillB(ctx, ox, oy, seededRand(Math.floor(rng() * 99999)), 0);

  const radius = Math.floor(S * 0.75) + Math.floor(rng() * Math.floor(S * 0.125));
  let cx, cy;
  if (corner === 'TL')      { cx = 0; cy = 0; }
  else if (corner === 'TR') { cx = S; cy = 0; }
  else if (corner === 'BL') { cx = 0; cy = S; }
  else                       { cx = S; cy = S; }

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const dx = px - cx, dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const jitter = Math.sin(Math.atan2(dy, dx) * 3) * (S / 10);
      if (dist < radius + jitter - 1) {
        ctx.fillStyle = (rng() < 0.15) ? palA.shades[Math.floor(rng() * palA.shades.length)] : palA.base;
        ctx.fillRect(ox + px, oy + py, 1, 1);
        if (rng() < 0.05 && palA.blade) {
          ctx.fillStyle = palA.blade[Math.floor(rng() * palA.blade.length)];
          ctx.fillRect(ox + px, oy + py, 1, 1);
        }
      } else if (dist < radius + jitter) {
        ctx.fillStyle = lerpColor(palA.base, palB.base, 0.5);
        ctx.fillRect(ox + px, oy + py, 1, 1);
      } else if (dist < radius + jitter + 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        ctx.fillRect(ox + px, oy + py, 1, 1);
      }
    }
  }
}

function drawComboCorner(ctx, ox, oy, rng, fillA, fillB, palA, palB, corner) {
  fillB(ctx, ox, oy, seededRand(Math.floor(rng() * 99999)), 0);

  let ax, ay;
  if (corner === 'TL')      { ax = S; ay = S; }
  else if (corner === 'TR') { ax = 0; ay = S; }
  else if (corner === 'BL') { ax = S; ay = 0; }
  else                       { ax = 0; ay = 0; }

  const radius = Math.floor(S * 0.625) + Math.floor(rng() * Math.floor(S * 0.125));
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const dx = px - ax, dy = py - ay;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const jitter = Math.sin(Math.atan2(dy, dx) * 3) * (S / 13);
      if (dist < radius + jitter - 1) {
        ctx.fillStyle = (rng() < 0.15) ? palA.shades[Math.floor(rng() * palA.shades.length)] : palA.base;
        ctx.fillRect(ox + px, oy + py, 1, 1);
        if (rng() < 0.04 && palA.blade) {
          ctx.fillStyle = palA.blade[Math.floor(rng() * palA.blade.length)];
          ctx.fillRect(ox + px, oy + py, 1, 1);
        }
      } else if (dist < radius + jitter) {
        ctx.fillStyle = lerpColor(palA.base, palB.base, 0.5);
        ctx.fillRect(ox + px, oy + py, 1, 1);
      } else if (dist < radius + jitter + 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        ctx.fillRect(ox + px, oy + py, 1, 1);
      }
    }
  }
}

// ===================== OVERLAY TILES =====================

function drawOverlay(ctx, ox, oy, rng, type) {
  ctx.clearRect(ox, oy, S, S);
  switch (type) {
    case 'stones': {
      const count = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < count; i++) {
        const px = 1 + Math.floor(rng() * (S - 3));
        const py = 1 + Math.floor(rng() * (S - 3));
        const shade = Math.floor(rng() * 3);
        ctx.fillStyle = shade === 0 ? '#7a7a7a' : shade === 1 ? '#6a6a6a' : '#8a8a8a';
        ctx.fillRect(ox + px, oy + py, 2, 1);
        ctx.fillStyle = darken(ctx.fillStyle, 0.15);
        ctx.fillRect(ox + px, oy + py + 1, 2, 1);
      }
      break;
    }
    case 'grass_tuft': {
      const bx = 3 + Math.floor(rng() * (S - 6));
      const by = 3 + Math.floor(rng() * (S - 6));
      ctx.fillStyle = '#4ca83c';
      ctx.fillRect(ox + bx, oy + by, 1, 3);
      ctx.fillRect(ox + bx + 1, oy + by - 1, 1, 3);
      ctx.fillRect(ox + bx - 1, oy + by + 1, 1, 2);
      ctx.fillStyle = '#52b044';
      ctx.fillRect(ox + bx, oy + by, 1, 1);
      break;
    }
    case 'crack': {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      let cx = 2 + Math.floor(rng() * 4);
      let cy = 2 + Math.floor(rng() * 4);
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(ox + cx, oy + cy, 1, 1);
        cx += rng() < 0.5 ? 1 : 0;
        cy += 1;
        if (cx >= S || cy >= S) break;
      }
      break;
    }
    case 'flowers_small': {
      for (let i = 0; i < 1 + Math.floor(rng() * 2); i++) {
        const fx = 2 + Math.floor(rng() * (S - 4));
        const fy = 2 + Math.floor(rng() * (S - 4));
        ctx.fillStyle = '#2e7420';
        ctx.fillRect(ox + fx, oy + fy + 1, 1, 2);
        const colors = ['#ff4466', '#ffaa33', '#ff6688', '#ffdd44', '#ee55aa'];
        ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
        ctx.fillRect(ox + fx, oy + fy, 1, 1);
        ctx.fillRect(ox + fx - 1, oy + fy, 1, 1);
        ctx.fillRect(ox + fx + 1, oy + fy, 1, 1);
      }
      break;
    }
    case 'shadow_tl': {
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(ox, oy, S, 2);
      ctx.fillRect(ox, oy, 2, S);
      ctx.fillStyle = 'rgba(0,0,0,0.03)';
      ctx.fillRect(ox, oy + 2, S, 1);
      ctx.fillRect(ox + 2, oy, 1, S);
      break;
    }
    case 'dirt_patch': {
      const px = 3 + Math.floor(rng() * (S - 7));
      const py = 3 + Math.floor(rng() * (S - 7));
      ctx.fillStyle = '#8a7050';
      ctx.fillRect(ox + px, oy + py, 3, 2);
      ctx.fillStyle = '#7e6444';
      ctx.fillRect(ox + px + 1, oy + py + 1, 2, 1);
      break;
    }
    case 'moss': {
      ctx.fillStyle = '#4a7a3a';
      const mx = Math.floor(rng() * (S - 3));
      const my = S - 3 + Math.floor(rng() * 2);
      ctx.fillRect(ox + mx, oy + my, 3, 1);
      ctx.fillStyle = '#3a6a2a';
      ctx.fillRect(ox + mx + 1, oy + my + 1, 2, 1);
      break;
    }
    case 'sand_ripple': {
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      for (let px = 0; px < S; px++) {
        const ry = Math.floor(S * 0.4 + Math.sin(px * 0.5) * 1.5);
        if (ry >= 0 && ry < S) ctx.fillRect(ox + px, oy + ry, 1, 1);
      }
      break;
    }
  }
}

// ===================== TILESET GENERATION =====================

function generateTileset(name, fillA, fillB, palA, palB) {
  const canvas = createCanvas(COLS * S, ROWS * S);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, COLS * S, ROWS * S);

  let seedBase = name.length * 1000;
  const tiles = [];

  // Row 0: 5 variants of type A + 3 variants of type B
  for (let v = 0; v < 5; v++) {
    tiles.push((ox, oy) => fillA(ctx, ox, oy, seededRand(seedBase + v * 100 + 1), v));
  }
  for (let v = 0; v < 3; v++) {
    tiles.push((ox, oy) => fillB(ctx, ox, oy, seededRand(seedBase + v * 100 + 501), v));
  }

  // Row 1: Edge transitions + External corners
  tiles.push((ox, oy) => drawEdge(ctx, ox, oy, seededRand(seedBase + 1001), fillA, fillB, palA, palB, 'top'));
  tiles.push((ox, oy) => drawEdge(ctx, ox, oy, seededRand(seedBase + 1002), fillA, fillB, palA, palB, 'bottom'));
  tiles.push((ox, oy) => drawEdge(ctx, ox, oy, seededRand(seedBase + 1003), fillA, fillB, palA, palB, 'left'));
  tiles.push((ox, oy) => drawEdge(ctx, ox, oy, seededRand(seedBase + 1004), fillA, fillB, palA, palB, 'right'));
  tiles.push((ox, oy) => drawCornerExt(ctx, ox, oy, seededRand(seedBase + 1005), fillA, fillB, palA, palB, 'TL'));
  tiles.push((ox, oy) => drawCornerExt(ctx, ox, oy, seededRand(seedBase + 1006), fillA, fillB, palA, palB, 'TR'));
  tiles.push((ox, oy) => drawCornerExt(ctx, ox, oy, seededRand(seedBase + 1007), fillA, fillB, palA, palB, 'BL'));
  tiles.push((ox, oy) => drawCornerExt(ctx, ox, oy, seededRand(seedBase + 1008), fillA, fillB, palA, palB, 'BR'));

  // Row 2: Internal corners + Combo corners
  tiles.push((ox, oy) => drawCornerInt(ctx, ox, oy, seededRand(seedBase + 2001), fillA, fillB, palA, palB, 'TL'));
  tiles.push((ox, oy) => drawCornerInt(ctx, ox, oy, seededRand(seedBase + 2002), fillA, fillB, palA, palB, 'TR'));
  tiles.push((ox, oy) => drawCornerInt(ctx, ox, oy, seededRand(seedBase + 2003), fillA, fillB, palA, palB, 'BL'));
  tiles.push((ox, oy) => drawCornerInt(ctx, ox, oy, seededRand(seedBase + 2004), fillA, fillB, palA, palB, 'BR'));
  tiles.push((ox, oy) => drawComboCorner(ctx, ox, oy, seededRand(seedBase + 2005), fillA, fillB, palA, palB, 'TL'));
  tiles.push((ox, oy) => drawComboCorner(ctx, ox, oy, seededRand(seedBase + 2006), fillA, fillB, palA, palB, 'TR'));
  tiles.push((ox, oy) => drawComboCorner(ctx, ox, oy, seededRand(seedBase + 2007), fillA, fillB, palA, palB, 'BL'));
  tiles.push((ox, oy) => drawComboCorner(ctx, ox, oy, seededRand(seedBase + 2008), fillA, fillB, palA, palB, 'BR'));

  // Row 3: Overlays
  const overlayTypes = ['stones', 'grass_tuft', 'crack', 'flowers_small', 'shadow_tl', 'dirt_patch', 'moss', 'sand_ripple'];
  for (let i = 0; i < 8; i++) {
    tiles.push((ox, oy) => drawOverlay(ctx, ox, oy, seededRand(seedBase + 3000 + i), overlayTypes[i]));
  }

  for (let i = 0; i < tiles.length; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    tiles[i](col * S, row * S);
  }

  const buffer = canvas.toBuffer('image/png');
  const filepath = path.join(tilesetsDir, name + '.png');
  fs.writeFileSync(filepath, buffer);
  console.log(`✓ Tileset: ${name}.png (${COLS * S}x${ROWS * S}, ${tiles.length} tiles)`);
}

function generateOverlaySheet() {
  const canvas = createCanvas(COLS * S, 2 * S);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, COLS * S, 2 * S);

  const types = ['stones', 'grass_tuft', 'crack', 'flowers_small', 'shadow_tl', 'dirt_patch', 'moss', 'sand_ripple'];
  for (let i = 0; i < types.length; i++) {
    drawOverlay(ctx, i * S, 0, seededRand(5000 + i), types[i]);
  }
  for (let i = 0; i < types.length; i++) {
    drawOverlay(ctx, i * S, S, seededRand(6000 + i), types[i]);
  }

  const buffer = canvas.toBuffer('image/png');
  const filepath = path.join(tilesetsDir, 'overlays.png');
  fs.writeFileSync(filepath, buffer);
  console.log(`✓ Tileset: overlays.png (${COLS * S}x${2 * S}, ${types.length * 2} tiles)`);
}

function generateAll() {
  console.log('Gerando tilesets...\n');
  generateTileset('grass-dirt', fillGrass, fillDirt, PAL.grass, PAL.dirt);
  generateTileset('grass-stone', fillGrass, fillStone, PAL.grass, PAL.stone);
  generateTileset('sand-water', fillSand, fillWater, PAL.sand, PAL.water);
  generateTileset('grass-sand', fillGrass, fillSand, PAL.grass, PAL.sand);
  generateOverlaySheet();

  console.log('\nLayout de cada tileset (8x4 = 32 tiles):');
  console.log('  Row 0: VarA×5 + VarB×3');
  console.log('  Row 1: EdgeT EdgeB EdgeL EdgeR | ExtTL ExtTR ExtBL ExtBR');
  console.log('  Row 2: IntTL IntTR IntBL IntBR | ComboTL ComboTR ComboBL ComboBR');
  console.log('  Row 3: Overlays (stones, grass, crack, flowers, shadow, dirt, moss, ripple)');
  console.log('\nÍndices:');
  console.log('  0-4:   Variações tipo A (5x)');
  console.log('  5-7:   Variações tipo B (3x)');
  console.log('  8-11:  Bordas (T, B, L, R)');
  console.log('  12-15: Cantos externos (TL, TR, BL, BR)');
  console.log('  16-19: Cantos internos (TL, TR, BL, BR)');
  console.log('  20-23: Cantos combo (TL, TR, BL, BR)');
  console.log('  24-31: Overlays');
}

generateAll();
