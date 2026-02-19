/**
 * Gerador de Tileset Grama/Terra - Originals World
 * Pixel art 32x32 estilo Tibia clássico com transições
 * 
 * Layout do tileset (16 tiles, 4 colunas x 4 linhas):
 *  0: Grama cheia (var A)      1: Grama cheia (var B)      2: Grama cheia (var C)      3: Terra cheia
 *  4: Borda terra no topo      5: Borda terra embaixo      6: Borda terra esquerda     7: Borda terra direita
 *  8: Canto ext TL             9: Canto ext TR            10: Canto ext BL            11: Canto ext BR
 * 12: Canto int TL            13: Canto int TR            14: Canto int BL            15: Canto int BR
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const tilesetsDir = path.join(__dirname, 'public', 'assets', 'tilesets');
if (!fs.existsSync(tilesetsDir)) fs.mkdirSync(tilesetsDir, { recursive: true });

const S = 32; // tile size

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
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

function lerpColor(hex1, hex2, t) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

// ===================== PALETTE =====================
const GRASS_COLORS = ['#2d6b1e', '#347a22', '#3a8228', '#2a6418', '#327624', '#3e8a2e', '#286010', '#368030'];
const GRASS_HIGHLIGHT = ['#4a9a3a', '#52a442', '#46923a', '#4ea040'];
const GRASS_SHADOW = ['#1e5510', '#225a14', '#1a4e0c', '#205212'];
const GRASS_BLADE = ['#4ea844', '#56b04a', '#48a03e', '#5ab850', '#44963a'];
const DIRT_COLORS = ['#7a6040', '#6a5030', '#8a7050', '#705838', '#846c48', '#7e6444', '#72603c', '#685030'];
const DIRT_HIGHLIGHT = ['#9a8060', '#947a58', '#a08868'];
const DIRT_SHADOW = ['#5a4428', '#4e3a20', '#544028'];
const DIRT_PEBBLE = ['#5e5040', '#6a6050', '#525040', '#585448'];

// ===================== GRASS TILE BASE =====================
function fillGrass(ctx, ox, oy, rng) {
  // Rich green base
  ctx.fillStyle = '#2e6e1e';
  ctx.fillRect(ox, oy, S, S);

  // Dense ground noise
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      if (rng() < 0.72) {
        ctx.fillStyle = GRASS_COLORS[Math.floor(rng() * GRASS_COLORS.length)];
        ctx.fillRect(ox + px, oy + py, 1, 1);
      }
    }
  }

  // Shadow patches (soft, subtle)
  for (let i = 0; i < 2; i++) {
    const sx = Math.floor(rng() * S * 0.6);
    const sy = Math.floor(rng() * S * 0.6);
    const sw = Math.floor(rng() * 8) + 4;
    const sh = Math.floor(rng() * 6) + 3;
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        if (rng() < 0.35) {
          ctx.fillStyle = GRASS_SHADOW[Math.floor(rng() * GRASS_SHADOW.length)];
          ctx.fillRect(ox + sx + px, oy + sy + py, 1, 1);
        }
      }
    }
  }

  // Highlight patches (top-left light)
  for (let i = 0; i < 2; i++) {
    const hx = Math.floor(rng() * S * 0.5);
    const hy = Math.floor(rng() * S * 0.4);
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < 5; px++) {
        if (rng() < 0.25) {
          ctx.fillStyle = GRASS_HIGHLIGHT[Math.floor(rng() * GRASS_HIGHLIGHT.length)];
          ctx.fillRect(ox + hx + px, oy + hy + py, 1, 1);
        }
      }
    }
  }

  // Grass blades (vertical strands)
  const nBlades = 8 + Math.floor(rng() * 6);
  for (let i = 0; i < nBlades; i++) {
    const bx = Math.floor(rng() * S);
    const bh = Math.floor(rng() * 4) + 2;
    const by = Math.floor(rng() * (S - bh));
    ctx.fillStyle = GRASS_BLADE[Math.floor(rng() * GRASS_BLADE.length)];
    for (let j = 0; j < bh; j++) {
      ctx.fillRect(ox + bx, oy + by + j, 1, 1);
    }
  }

  // Tiny dirt specks
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      if (rng() < 0.02) {
        ctx.fillStyle = '#5a5030';
        ctx.fillRect(ox + px, oy + py, 1, 1);
      }
    }
  }
}

// ===================== DIRT TILE BASE =====================
function fillDirt(ctx, ox, oy, rng) {
  ctx.fillStyle = '#7a6040';
  ctx.fillRect(ox, oy, S, S);

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      if (rng() < 0.75) {
        ctx.fillStyle = DIRT_COLORS[Math.floor(rng() * DIRT_COLORS.length)];
        ctx.fillRect(ox + px, oy + py, 1, 1);
      }
    }
  }

  // Lighter patches
  for (let i = 0; i < 3; i++) {
    const hx = Math.floor(rng() * S * 0.7);
    const hy = Math.floor(rng() * S * 0.7);
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < 5; px++) {
        if (rng() < 0.2) {
          ctx.fillStyle = DIRT_HIGHLIGHT[Math.floor(rng() * DIRT_HIGHLIGHT.length)];
          ctx.fillRect(ox + hx + px, oy + hy + py, 1, 1);
        }
      }
    }
  }

  // Darker crevices
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      if (rng() < 0.04) {
        ctx.fillStyle = DIRT_SHADOW[Math.floor(rng() * DIRT_SHADOW.length)];
        ctx.fillRect(ox + px, oy + py, 1, 1);
      }
    }
  }

  // Small pebbles
  const nPebbles = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < nPebbles; i++) {
    const px = Math.floor(rng() * (S - 2));
    const py = Math.floor(rng() * (S - 2));
    ctx.fillStyle = DIRT_PEBBLE[Math.floor(rng() * DIRT_PEBBLE.length)];
    ctx.fillRect(ox + px, oy + py, 2, 2);
    ctx.fillStyle = DIRT_HIGHLIGHT[Math.floor(rng() * DIRT_HIGHLIGHT.length)];
    ctx.fillRect(ox + px, oy + py, 2, 1);
  }
}

// ===================== TRANSITION EDGE MAKER =====================
// Creates irregular grass-to-dirt transition along one side
// side: 'top', 'bottom', 'left', 'right'
// depth: how far the dirt intrudes (in pixels)
function drawEdge(ctx, ox, oy, rng, side) {
  // First fill the whole tile with grass
  fillGrass(ctx, ox, oy, rng);

  const depth = 10; // how deep the dirt band is
  const jitter = 4;  // irregularity of the border line

  // Generate irregular border line
  const borderLine = [];
  for (let i = 0; i < S; i++) {
    // Perlin-like: smoothed random
    const base = depth;
    const noise = Math.floor((rng() - 0.5) * jitter * 2);
    borderLine.push(Math.max(2, Math.min(S - 2, base + noise)));
  }
  // Smooth the line
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < S - 1; i++) {
      borderLine[i] = Math.round((borderLine[i - 1] + borderLine[i] + borderLine[i + 1]) / 3);
    }
  }

  // Draw dirt in the border area
  for (let i = 0; i < S; i++) {
    const d = borderLine[i];
    for (let j = 0; j < d; j++) {
      let px, py;
      if (side === 'top') { px = i; py = j; }
      else if (side === 'bottom') { px = i; py = S - 1 - j; }
      else if (side === 'left') { px = j; py = i; }
      else { px = S - 1 - j; py = i; } // right

      ctx.fillStyle = DIRT_COLORS[Math.floor(rng() * DIRT_COLORS.length)];
      ctx.fillRect(ox + px, oy + py, 1, 1);
    }

    // Transition pixels at the border (blend zone, 2-3px)
    for (let j = Math.max(0, d - 3); j < d + 2 && j < S; j++) {
      let px, py;
      if (side === 'top') { px = i; py = j; }
      else if (side === 'bottom') { px = i; py = S - 1 - j; }
      else if (side === 'left') { px = j; py = i; }
      else { px = S - 1 - j; py = i; }

      if (rng() < 0.4) {
        const t = (j - d + 3) / 5;
        ctx.fillStyle = lerpColor(
          DIRT_COLORS[Math.floor(rng() * DIRT_COLORS.length)],
          GRASS_COLORS[Math.floor(rng() * GRASS_COLORS.length)],
          Math.max(0, Math.min(1, t))
        );
        ctx.fillRect(ox + px, oy + py, 1, 1);
      }
    }
  }

  // Add some dirt pebbles in the dirt portion
  for (let i = 0; i < 2; i++) {
    let px, py;
    if (side === 'top') { px = Math.floor(rng() * S); py = Math.floor(rng() * (depth - 2)); }
    else if (side === 'bottom') { px = Math.floor(rng() * S); py = S - 1 - Math.floor(rng() * (depth - 2)); }
    else if (side === 'left') { px = Math.floor(rng() * (depth - 2)); py = Math.floor(rng() * S); }
    else { px = S - 1 - Math.floor(rng() * (depth - 2)); py = Math.floor(rng() * S); }
    ctx.fillStyle = DIRT_PEBBLE[Math.floor(rng() * DIRT_PEBBLE.length)];
    if (px >= 0 && px < S - 1 && py >= 0 && py < S - 1) {
      ctx.fillRect(ox + px, oy + py, 2, 1);
    }
  }
}

// ===================== CORNER TILES =====================
// External corners: dirt in one corner, grass fills the rest
function drawCornerExt(ctx, ox, oy, rng, corner) {
  fillGrass(ctx, ox, oy, rng);

  const radius = 12;
  // Determine the corner origin
  let cx, cy;
  if (corner === 'TL') { cx = 0; cy = 0; }
  else if (corner === 'TR') { cx = S; cy = 0; }
  else if (corner === 'BL') { cx = 0; cy = S; }
  else { cx = S; cy = S; }

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const jitter = (rng() - 0.5) * 3;
      if (dist < radius + jitter) {
        ctx.fillStyle = DIRT_COLORS[Math.floor(rng() * DIRT_COLORS.length)];
        ctx.fillRect(ox + px, oy + py, 1, 1);
      } else if (dist < radius + jitter + 3) {
        // Blend zone
        if (rng() < 0.4) {
          const t = (dist - radius) / 5;
          ctx.fillStyle = lerpColor(
            DIRT_COLORS[Math.floor(rng() * DIRT_COLORS.length)],
            GRASS_COLORS[Math.floor(rng() * GRASS_COLORS.length)],
            Math.max(0, Math.min(1, t))
          );
          ctx.fillRect(ox + px, oy + py, 1, 1);
        }
      }
    }
  }
}

// Internal corners: mostly dirt, grass pokes into one corner
function drawCornerInt(ctx, ox, oy, rng, corner) {
  fillDirt(ctx, ox, oy, rng);

  const radius = 14;
  let cx, cy;
  if (corner === 'TL') { cx = 0; cy = 0; }
  else if (corner === 'TR') { cx = S; cy = 0; }
  else if (corner === 'BL') { cx = 0; cy = S; }
  else { cx = S; cy = S; }

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const jitter = (rng() - 0.5) * 3;
      if (dist < radius + jitter) {
        ctx.fillStyle = GRASS_COLORS[Math.floor(rng() * GRASS_COLORS.length)];
        ctx.fillRect(ox + px, oy + py, 1, 1);
        // Grass blades in the green part
        if (rng() < 0.15) {
          ctx.fillStyle = GRASS_BLADE[Math.floor(rng() * GRASS_BLADE.length)];
          ctx.fillRect(ox + px, oy + py, 1, 1);
        }
      } else if (dist < radius + jitter + 3) {
        if (rng() < 0.4) {
          const t = (dist - radius) / 5;
          ctx.fillStyle = lerpColor(
            GRASS_COLORS[Math.floor(rng() * GRASS_COLORS.length)],
            DIRT_COLORS[Math.floor(rng() * DIRT_COLORS.length)],
            Math.max(0, Math.min(1, t))
          );
          ctx.fillRect(ox + px, oy + py, 1, 1);
        }
      }
    }
  }
}

// ===================== GENERATE TILESET =====================
function generate() {
  const COLS = 4;
  const ROWS = 4;
  const canvas = createCanvas(COLS * S, ROWS * S);
  const ctx = canvas.getContext('2d');

  // Black background (transparent tiles would also work)
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, COLS * S, ROWS * S);

  const tileFuncs = [
    // Row 0: Grass variations + dirt
    (ox, oy) => fillGrass(ctx, ox, oy, seededRand(1001)),
    (ox, oy) => fillGrass(ctx, ox, oy, seededRand(2002)),
    (ox, oy) => fillGrass(ctx, ox, oy, seededRand(3003)),
    (ox, oy) => fillDirt(ctx, ox, oy, seededRand(4004)),

    // Row 1: Edge transitions (dirt intrudes from one side into grass)
    (ox, oy) => drawEdge(ctx, ox, oy, seededRand(5005), 'top'),
    (ox, oy) => drawEdge(ctx, ox, oy, seededRand(6006), 'bottom'),
    (ox, oy) => drawEdge(ctx, ox, oy, seededRand(7007), 'left'),
    (ox, oy) => drawEdge(ctx, ox, oy, seededRand(8008), 'right'),

    // Row 2: External corners (small dirt patch in corner, rest is grass)
    (ox, oy) => drawCornerExt(ctx, ox, oy, seededRand(9009), 'TL'),
    (ox, oy) => drawCornerExt(ctx, ox, oy, seededRand(10010), 'TR'),
    (ox, oy) => drawCornerExt(ctx, ox, oy, seededRand(11011), 'BL'),
    (ox, oy) => drawCornerExt(ctx, ox, oy, seededRand(12012), 'BR'),

    // Row 3: Internal corners (mostly dirt, grass pokes into corner)
    (ox, oy) => drawCornerInt(ctx, ox, oy, seededRand(13013), 'TL'),
    (ox, oy) => drawCornerInt(ctx, ox, oy, seededRand(14014), 'TR'),
    (ox, oy) => drawCornerInt(ctx, ox, oy, seededRand(15015), 'BL'),
    (ox, oy) => drawCornerInt(ctx, ox, oy, seededRand(16016), 'BR'),
  ];

  for (let i = 0; i < tileFuncs.length; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    tileFuncs[i](col * S, row * S);
  }

  const buffer = canvas.toBuffer('image/png');
  const filepath = path.join(tilesetsDir, 'grass-dirt.png');
  fs.writeFileSync(filepath, buffer);
  console.log(`Tileset criado: grass-dirt.png (${COLS * S}x${ROWS * S}, ${tileFuncs.length} tiles)`);
  console.log('Layout:');
  console.log('  Row 0: Grama A | Grama B | Grama C | Terra');
  console.log('  Row 1: Borda T | Borda B | Borda L | Borda R');
  console.log('  Row 2: Ext TL  | Ext TR  | Ext BL  | Ext BR');
  console.log('  Row 3: Int TL  | Int TR  | Int BL  | Int BR');
}

generate();
