// ============================
// ORIGINALS WORLD - GAME CLIENT
// ============================

const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 60000,
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('Conectado ao servidor!');
});

socket.on('disconnect', (reason) => {
  console.log('Desconectado:', reason);
});

socket.on('reconnect', (attempt) => {
  console.log('Reconectado apÃ³s', attempt, 'tentativas');
  // Re-login automÃ¡tico se jÃ¡ estava logado
  if (myChar && myChar.username && lastLoginCredentials) {
    console.log('Tentando re-login automÃ¡tico...');
    socket.emit('login', lastLoginCredentials, (res) => {
      if (res.success) {
        console.log('Re-login automÃ¡tico bem sucedido!');
      } else {
        console.log('Re-login falhou:', res.error);
        // Se falhou por conta jÃ¡ conectada, forÃ§ar refresh
        if (res.error && res.error.includes('jÃ¡ estÃ¡ conectada')) {
          setTimeout(() => {
            socket.emit('login', lastLoginCredentials, (res2) => {
              if (res2.success) console.log('Re-login automÃ¡tico bem sucedido (2a tentativa)');
            });
          }, 2000);
        }
      }
    });
  }
});

socket.on('reconnect_attempt', (attempt) => {
  console.log('Tentativa de reconexÃ£o:', attempt);
});

// ============= CONSTANTS =============
let TILE_SIZE = 32;
const TILE_SIZE_MIN = 16;
const TILE_SIZE_MAX = 64;
const MOVE_SPEED = 0.08; // tiles per frame

// Tile type enum (must match server)
const T = { GRASS:0, DIRT:1, STONE_PATH:2, STONE_WALL:3, WATER:4, TREE:5, WOOD_FLOOR:6, CHURCH_FLOOR:7, WOOD_WALL:8, SAND:9,
  FLOWERS:10, BUSH:11, ROCK:12, RED_CARPET:13, ALTAR:14, ANVIL:15, FURNACE:16, BOOKSHELF:17, TABLE:18, CHAIR:19,
  WELL:20, FENCE:21, ROOF_STONE:22, ROOF_WOOD:23, WINDOW_STONE:24, WINDOW_WOOD:25, CROSS:26, TALL_GRASS:27, MUSHROOM:28,
  BARREL:29, CRATE:30, TORCH_WALL:31, BED:32, RUG:33, CHURCH_PEW:34, DARK_GRASS:35,
  GRAVESTONE:36, DEAD_TREE:37, BONE:38, MUD:39, HAY:40, CHURCH_WALL:41 };
const BLOCKED = new Set([T.STONE_WALL, T.WATER, T.TREE, T.WOOD_WALL, T.BUSH, T.ROCK, T.ANVIL, T.FURNACE,
  T.BOOKSHELF, T.WELL, T.FENCE, T.BARREL, T.CRATE, T.BED, T.TORCH_WALL, T.GRAVESTONE, T.DEAD_TREE, T.HAY, T.CHURCH_WALL]);

// ============= STATE =============
let gameMap = null;
let mapWidth = 0, mapHeight = 0;
let myChar = null;
let otherPlayers = {};
let nearbyEnemies = [];
let npcs = [];
let myInventory = [];
let myQuests = [];
let chatLog = [];
let myChatBubble = null; // { message, time }
let currentDialog = null;
let targetEnemy = null;
let lastAttackTime = 0;
let groundItems = []; // itens no chÃ£o
let npcQuestStatus = {}; // quest status per NPC
let lastLoginCredentials = null; // para re-login automÃ¡tico

// Quadrant system
let currentQuadrant = 'E5';
let currentQuadrantName = 'Cidade de Origens';
let quadrantNeighbors = { left: null, right: null, up: null, down: null };
let transitioning = false;

// Item data map (client-side)
const ITEMS_CLIENT = {
  espada_enferrujada: { name: 'Espada Enferrujada', icon: '/assets/icons/swords/enferrujada.png' },
  pocao_cura: { name: 'PoÃ§Ã£o de Cura', icon: null },
  couro_simples: { name: 'Couro Simples', icon: '/assets/sprites/cow/courosimples.png' },
  tunica_couro_simples: { name: 'TÃºnica de Couro Simples', icon: '/assets/icons/peitorais/tunicacourosimples.png' }
};

// Input
const keys = { up:false, down:false, left:false, right:false };
let mouseX = 0, mouseY = 0;
let mouseWorldX = 0, mouseWorldY = 0;

// Animation
let animFrame = 0;
let animTimer = 0;
let enemyAnimFrame = 0;
let enemyAnimTimer = 0;
let lastFrameTime = 0;
let waterAnimFrame = 0;
let waterTimer = 0;

// Camera
let cameraX = 0, cameraY = 0;

// Canvas
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ============= SPRITE LOADING =============
const sprites = {};
const spriteNames = [
  ['parado', '/assets/sprites/player/parado.png'],
  ['andando', '/assets/sprites/player/andando.png'],
  ['esqueletoparado', '/assets/sprites/skeleton/esqueletoparado.png'],
  ['esqueletoandando', '/assets/sprites/skeleton/esqueletoandando.png'],
  ['slime', '/assets/sprites/slime/slime.png'],
  ['padre', '/assets/sprites/npcs/padre.png'],
  ['paladino', '/assets/sprites/npcs/paladino.png'],
  ['ferreiro', '/assets/sprites/npcs/ferreiro.png'],
  ['artesao', '/assets/sprites/npcs/artesao.png'],
  ['admin', '/assets/sprites/player/admin.png'],
  ['enferrujadaparado', '/assets/sprites/player/itens/enferrujadaparado.png'],
  ['esferrujadaandando', '/assets/sprites/player/itens/esferrujadaandando.png'],
  ['vacaparada', '/assets/sprites/cow/vacaparada.png'],
  ['vacaandando', '/assets/sprites/cow/vacaandando.png'],
  ['vacacomendo', '/assets/sprites/cow/vacacomendo.png'],
  ['tunicasimplesparado', '/assets/sprites/player/itens/tunicasimplesparado.png'],
  ['tunicasimplesandando', '/assets/sprites/player/itens/tunicasimplesandando.png'],
];

// Mapa de item_id -> sprite names [parado, andando]
const WEAPON_SPRITES = {
  espada_enferrujada: ['enferrujadaparado', 'esferrujadaandando'],
};

// Mapa de item_id -> sprite names [parado, andando] para armaduras de peitoral
const CHEST_SPRITES = {
  tunica_couro_simples: ['tunicasimplesparado', 'tunicasimplesandando'],
};

let spritesLoaded = 0;
for (const [name, src] of spriteNames) {
  const img = new Image();
  img.onload = () => { spritesLoaded++; };
  img.onerror = () => { console.warn('Sprite not found:', src); spritesLoaded++; };
  img.src = src;
  sprites[name] = img;
}

// ============= TILE CACHE SYSTEM =============
// Pre-render detailed tiles to offscreen canvases for performance
const tileCanvasCache = {};
let tileCacheSize = 0;
const TILE_VARIANTS = 8; // variants per tile type
let zoomDebounceTimer = null;
let tileCacheGeneration = 0; // increments on each rebuild to cancel stale ones

function seededRand(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function() { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
}

// Noise fill helper: scatter colored pixels for texture
function fillNoise(c, x, y, w, h, colors, density, rng) {
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (rng() < density) {
        c.fillStyle = colors[Math.floor(rng() * colors.length)];
        c.fillRect(x + px, y + py, 1, 1);
      }
    }
  }
}

// Dither helper
function fillDither(c, x, y, w, h, c1, c2, rng) {
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      c.fillStyle = ((px + py) % 2 === 0) ? c1 : c2;
      if (rng() < 0.15) c.fillStyle = rng() < 0.5 ? c1 : c2;
      c.fillRect(x + px, y + py, 1, 1);
    }
  }
}

function initTileCache() {
  // Synchronous build - only used on first load
  const s = TILE_SIZE;
  if (s === tileCacheSize) return;
  tileCacheSize = s;
  for (const k in tileCanvasCache) delete tileCanvasCache[k];

  for (let tileType = 0; tileType <= 41; tileType++) {
    for (let v = 0; v < TILE_VARIANTS; v++) {
      const key = tileType + '_' + v;
      const off = document.createElement('canvas');
      off.width = s; off.height = s;
      const oc = off.getContext('2d');
      renderDetailedTile(oc, tileType, v, s);
      tileCanvasCache[key] = off;
    }
  }
  // water frames
  for (let f = 0; f < 3; f++) {
    for (let v = 0; v < TILE_VARIANTS; v++) {
      const key = 'water_' + f + '_' + v;
      const off = document.createElement('canvas');
      off.width = s; off.height = s;
      const oc = off.getContext('2d');
      renderWaterTile(oc, v, f, s);
      tileCanvasCache[key] = off;
    }
  }
}

// Progressive (async) cache rebuild - used on zoom
function rebuildTileCacheProgressive() {
  const s = TILE_SIZE;
  if (s === tileCacheSize) return;
  tileCacheSize = s;
  tileCacheGeneration++;
  const gen = tileCacheGeneration;

  const tasks = [];
  for (let tileType = 0; tileType <= 41; tileType++) {
    for (let v = 0; v < TILE_VARIANTS; v++) {
      tasks.push({ key: tileType + '_' + v, type: 'tile', tileType, v });
    }
  }
  for (let f = 0; f < 3; f++) {
    for (let v = 0; v < TILE_VARIANTS; v++) {
      tasks.push({ key: 'water_' + f + '_' + v, type: 'water', v, f });
    }
  }

  let idx = 0;
  const BATCH = 30;

  function processBatch() {
    if (tileCacheGeneration !== gen) return; // zoom changed again, abort this rebuild
    const end = Math.min(idx + BATCH, tasks.length);
    for (; idx < end; idx++) {
      const t = tasks[idx];
      const off = document.createElement('canvas');
      off.width = s; off.height = s;
      const oc = off.getContext('2d');
      if (t.type === 'water') {
        renderWaterTile(oc, t.v, t.f, s);
      } else {
        renderDetailedTile(oc, t.tileType, t.v, s);
      }
      tileCanvasCache[t.key] = off;
    }
    if (idx < tasks.length) {
      setTimeout(processBatch, 0);
    }
  }

  processBatch();
}

function renderWaterTile(c, variant, frame, s) {
  const rng = seededRand(variant * 137 + frame * 31 + 999);
  // Deep water base
  c.fillStyle = '#0e3a6e';
  c.fillRect(0, 0, s, s);
  // Depth layers
  fillNoise(c, 0, 0, s, s, ['#0c3260','#103870','#0a2e5c','#124078','#0f3668'], 0.35, rng);
  // Mid tones
  fillNoise(c, 0, 0, s, s, ['#185090','#1a5498','#164c88'], 0.12, rng);
  // Wave highlights based on frame
  const wOff = frame * Math.floor(s / 3);
  c.fillStyle = 'rgba(80,150,220,0.3)';
  for (let px = 0; px < s; px++) {
    const wy = Math.floor(s * 0.3 + Math.sin((px + wOff) * 0.4) * 2);
    c.fillRect(px, wy, 1, 1);
    const wy2 = Math.floor(s * 0.7 + Math.sin((px + wOff + 5) * 0.3) * 2);
    c.fillRect(px, wy2, 1, 1);
  }
  // Sparkle
  c.fillStyle = 'rgba(180,220,255,0.35)';
  for (let i = 0; i < 3; i++) {
    const spx = Math.floor(rng() * s), spy = Math.floor(rng() * s);
    if ((spx + frame) % 3 === 0) c.fillRect(spx, spy, 1, 1);
  }
  // Foam specks
  c.fillStyle = 'rgba(200,230,255,0.15)';
  for (let i = 0; i < 4; i++) {
    c.fillRect(Math.floor(rng()*s), Math.floor(rng()*s), 2, 1);
  }
}

function renderDetailedTile(c, tileType, variant, s) {
  const rng = seededRand(variant * 1000 + tileType * 97 + 42);
  const v = variant;

  switch (tileType) {
    // ===== GRASS =====
    case T.GRASS: {
      // Rich base
      c.fillStyle = '#3a7a2d';
      c.fillRect(0, 0, s, s);
      // Dense noise texture - many shades of green
      fillNoise(c, 0, 0, s, s, [
        '#347228','#3e8232','#2e6a22','#429038','#387830',
        '#2c6420','#44923a','#306c24','#3a7e2e','#367628'
      ], 0.7, rng);
      // Lighter patches
      const px1 = Math.floor(rng()*s*0.6), py1 = Math.floor(rng()*s*0.6);
      fillNoise(c, px1, py1, Math.floor(s*0.4), Math.floor(s*0.4), ['#4a9a40','#4e9e44','#52a248'], 0.3, rng);
      // Darker patches
      const px2 = Math.floor(rng()*s*0.5), py2 = Math.floor(rng()*s*0.5);
      fillNoise(c, px2, py2, Math.floor(s*0.35), Math.floor(s*0.35), ['#265e1a','#1e5214','#2a6a1c'], 0.25, rng);
      // Grass blades - tiny vertical strokes
      for (let i = 0; i < Math.floor(s*0.4); i++) {
        const bx = Math.floor(rng() * s);
        const by = Math.floor(rng() * (s-3));
        const bh = Math.floor(rng()*3)+2;
        c.fillStyle = ['#4ea844','#56b04a','#48a03e','#5ab850'][Math.floor(rng()*4)];
        c.fillRect(bx, by, 1, bh);
      }
      // Tiny dirt/brown specks
      fillNoise(c, 0, 0, s, s, ['#5a5030','#6a6040','#4a4020'], 0.03, rng);
      // Yellow highlights
      fillNoise(c, 0, 0, s, s, ['#6abb55','#72c45a'], 0.02, rng);
      break;
    }

    // ===== DARK GRASS =====
    case T.DARK_GRASS: {
      c.fillStyle = '#1e5514';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, [
        '#1a5010','#225c18','#164a0e','#1e5814','#205a16',
        '#14460c','#266020','#1c5412','#184e10','#245e1c'
      ], 0.7, rng);
      // Dark leaf litter
      fillNoise(c, 0, 0, s, s, ['#3a3018','#2c2410','#342a14'], 0.06, rng);
      // Moss highlights
      fillNoise(c, 0, 0, s, s, ['#2a7020','#328028'], 0.05, rng);
      // Shadow patches
      const dx = Math.floor(rng()*s*0.5), dy = Math.floor(rng()*s*0.5);
      fillNoise(c, dx, dy, Math.floor(s*0.4), Math.floor(s*0.4), ['#103808','#0c3006'], 0.2, rng);
      // Sparse grass blades
      for (let i = 0; i < Math.floor(s*0.25); i++) {
        const bx = Math.floor(rng()*s), by = Math.floor(rng()*(s-3));
        c.fillStyle = ['#2a7820','#328228','#207018'][Math.floor(rng()*3)];
        c.fillRect(bx, by, 1, Math.floor(rng()*3)+1);
      }
      break;
    }

    // ===== TALL GRASS =====
    case T.TALL_GRASS: {
      c.fillStyle = '#347228';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#2e6a22','#3a7e2e','#327028','#3e8232'], 0.5, rng);
      // Many tall grass blades
      for (let i = 0; i < Math.floor(s*0.8); i++) {
        const bx = Math.floor(rng()*s);
        const bh = Math.floor(rng()*s*0.5) + Math.floor(s*0.3);
        const by = s - bh;
        const sway = Math.floor(rng()*3)-1;
        c.fillStyle = ['#4ea844','#56b04a','#48a03e','#5cb850','#44963a','#60c054'][Math.floor(rng()*6)];
        // Draw blade as thin line with slight sway
        for (let j = 0; j < bh; j++) {
          const ox = Math.floor(sway * j / bh);
          c.fillRect(bx + ox, by + j, 1, 1);
        }
      }
      // Tips
      fillNoise(c, 0, 0, s, Math.floor(s*0.3), ['#6abb55','#72c45a','#62b050'], 0.08, rng);
      break;
    }

    // ===== FLOWERS =====
    case T.FLOWERS: {
      // grass base
      c.fillStyle = '#3a7a2d';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#347228','#3e8232','#2e6a22','#429038'], 0.55, rng);
      // Grass blades
      for (let i = 0; i < Math.floor(s*0.3); i++) {
        const bx = Math.floor(rng()*s), by = Math.floor(rng()*(s-2));
        c.fillStyle = ['#4ea844','#48a03e'][Math.floor(rng()*2)];
        c.fillRect(bx, by, 1, 2);
      }
      // Flowers (5-8 per tile)
      const nFlowers = 4 + Math.floor(rng() * 5);
      for (let i = 0; i < nFlowers; i++) {
        const fx = Math.floor(rng()*(s-4))+2;
        const fy = Math.floor(rng()*(s-5))+2;
        // Stem
        c.fillStyle = '#2a6a1c';
        c.fillRect(fx, fy+2, 1, 3);
        // Petals
        const fc = ['#ff4466','#ffaa33','#ff6688','#ffdd44','#ee55aa','#aaddff','#ff8855','#dd44ff'][Math.floor(rng()*8)];
        c.fillStyle = fc;
        c.fillRect(fx-1, fy, 3, 1);
        c.fillRect(fx, fy-1, 1, 3);
        c.fillRect(fx-1, fy+1, 3, 1);
        // Center
        c.fillStyle = '#ffee44';
        c.fillRect(fx, fy, 1, 1);
      }
      break;
    }

    // ===== MUSHROOM =====
    case T.MUSHROOM: {
      c.fillStyle = '#3a7a2d';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#347228','#3e8232','#2e6a22'], 0.45, rng);
      const mx = Math.floor(s*0.3 + rng()*s*0.2);
      const my = Math.floor(s*0.3);
      // Stem
      c.fillStyle = '#e8dcc0';
      c.fillRect(mx+Math.floor(s*0.05),my+Math.floor(s*0.25),Math.floor(s*0.14),Math.floor(s*0.3));
      c.fillStyle = '#ddd0b0';
      c.fillRect(mx+Math.floor(s*0.06),my+Math.floor(s*0.35),Math.floor(s*0.06),Math.floor(s*0.18));
      // Cap
      c.fillStyle = '#cc2020';
      const cw = Math.floor(s*0.35), ch = Math.floor(s*0.18);
      c.fillRect(mx - Math.floor(s*0.06), my, cw, ch);
      c.fillRect(mx - Math.floor(s*0.02), my - Math.floor(s*0.06), cw - Math.floor(s*0.08), Math.floor(s*0.08));
      // Cap shading
      c.fillStyle = '#aa1818';
      c.fillRect(mx - Math.floor(s*0.06), my + ch-2, cw, 2);
      // White dots on cap
      c.fillStyle = '#fff';
      c.fillRect(mx, my+Math.floor(s*0.03), 2, 2);
      c.fillRect(mx+Math.floor(s*0.15), my+Math.floor(s*0.06), 2, 1);
      c.fillRect(mx+Math.floor(s*0.07), my-Math.floor(s*0.02), 1, 1);
      // Shadow
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fillRect(mx-Math.floor(s*0.04), my+Math.floor(s*0.55), Math.floor(s*0.35), Math.floor(s*0.06));
      break;
    }

    // ===== BUSH =====
    case T.BUSH: {
      c.fillStyle = '#3a7a2d';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#347228','#3e8232','#2e6a22'], 0.4, rng);
      // Ground shadow
      c.fillStyle = 'rgba(0,0,0,0.18)';
      const bw = Math.floor(s*0.7), bh = Math.floor(s*0.15);
      c.fillRect(Math.floor(s*0.15), Math.floor(s*0.78), bw, bh);
      // Bush body - dark core
      c.fillStyle = '#145008';
      const bushW = Math.floor(s*0.75), bushH = Math.floor(s*0.55);
      const bushX = Math.floor(s*0.12), bushY = Math.floor(s*0.2);
      c.fillRect(bushX, bushY, bushW, bushH);
      c.fillRect(bushX+Math.floor(s*0.06), bushY-Math.floor(s*0.06), bushW-Math.floor(s*0.12), Math.floor(s*0.08));
      // Leaf texture layers
      fillNoise(c, bushX, bushY, bushW, bushH, ['#1a5c0e','#1e6412','#226a16','#186010'], 0.5, rng);
      fillNoise(c, bushX, bushY, bushW, Math.floor(bushH*0.5), ['#2a7820','#2e7e24','#328228'], 0.3, rng);
      // Bright highlights on top
      fillNoise(c, bushX+2, bushY, bushW-4, Math.floor(bushH*0.3), ['#3a8a2e','#3e9032','#429436'], 0.25, rng);
      // Individual leaf shapes
      for (let i = 0; i < 6; i++) {
        const lx = bushX + Math.floor(rng()*bushW);
        const ly = bushY + Math.floor(rng()*bushH);
        c.fillStyle = ['#2a7820','#3a8a2e','#1e6412'][Math.floor(rng()*3)];
        c.fillRect(lx, ly, 3, 2);
        c.fillRect(lx+1, ly-1, 1, 1);
      }
      break;
    }

    // ===== ROCK =====
    case T.ROCK: {
      c.fillStyle = '#3a7a2d';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#347228','#3e8232','#2e6a22'], 0.4, rng);
      // Shadow
      c.fillStyle = 'rgba(0,0,0,0.2)';
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.72), Math.floor(s*0.76), Math.floor(s*0.15));
      // Rock body
      const rw = Math.floor(s*0.7), rh = Math.floor(s*0.5);
      const rx = Math.floor(s*0.15), ry = Math.floor(s*0.22);
      c.fillStyle = '#7a7a7a';
      c.fillRect(rx, ry, rw, rh);
      c.fillRect(rx+Math.floor(s*0.06), ry-Math.floor(s*0.06), rw-Math.floor(s*0.12), Math.floor(s*0.08));
      // Rock texture
      fillNoise(c, rx, ry, rw, rh, ['#6a6a6a','#808080','#747474','#8a8a8a','#767676','#727272'], 0.6, rng);
      // Top highlight
      fillNoise(c, rx+1, ry, rw-2, Math.floor(rh*0.25), ['#929292','#9a9a9a','#8e8e8e','#a0a0a0'], 0.5, rng);
      // Bottom shadow
      fillNoise(c, rx, ry+Math.floor(rh*0.7), rw, Math.floor(rh*0.3), ['#585858','#525252','#5e5e5e'], 0.4, rng);
      // Cracks
      c.fillStyle = '#4a4a4a';
      const crx = rx + Math.floor(rng()*rw*0.5)+Math.floor(rw*0.2);
      for (let cy = 0; cy < Math.floor(rh*0.6); cy++) {
        c.fillRect(crx + Math.floor(rng()*3)-1, ry+Math.floor(rh*0.15)+cy, 1, 1);
      }
      // Moss
      if (v % 3 === 0) {
        fillNoise(c, rx, ry+Math.floor(rh*0.6), Math.floor(rw*0.4), Math.floor(rh*0.2), ['#4a7a3a','#3a6a2a'], 0.3, rng);
      }
      break;
    }

    // ===== DIRT =====
    case T.DIRT: {
      c.fillStyle = '#7a6040';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, [
        '#6a5030','#7a6040','#8a7050','#705838','#7e6444',
        '#685030','#846c48','#725a3a','#8a7454','#74603e'
      ], 0.75, rng);
      // Lighter patches
      fillNoise(c, 0, 0, s, s, ['#9a8060','#907858'], 0.06, rng);
      // Small pebbles
      for (let i = 0; i < 3+Math.floor(rng()*3); i++) {
        const px = Math.floor(rng()*s), py = Math.floor(rng()*s);
        c.fillStyle = ['#5a4828','#666','#5e5040'][Math.floor(rng()*3)];
        c.fillRect(px, py, 2, 2);
        c.fillStyle = ['#6a5838','#777'][Math.floor(rng()*2)];
        c.fillRect(px, py, 2, 1);
      }
      // Darker cracks/lines
      fillNoise(c, 0, 0, s, s, ['#5a4428','#4e3a20'], 0.04, rng);
      break;
    }

    // ===== STONE PATH =====
    case T.STONE_PATH: {
      c.fillStyle = '#858585';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#7a7a7a','#8a8a8a','#808080','#767676','#888888','#7e7e7e'], 0.65, rng);
      // Mortar/grout lines (brick pattern)
      c.fillStyle = '#606060';
      const half = Math.floor(s/2);
      c.fillRect(0, half-1, s, 2);
      const isEven = v % 2 === 0;
      if (isEven) {
        c.fillRect(half-1, 0, 2, half);
        c.fillRect(Math.floor(s*0.25)-1, half, 2, half);
        c.fillRect(Math.floor(s*0.75)-1, half, 2, half);
      } else {
        c.fillRect(Math.floor(s*0.25)-1, 0, 2, half);
        c.fillRect(Math.floor(s*0.75)-1, 0, 2, half);
        c.fillRect(half-1, half, 2, half);
      }
      // Stone surface highlights
      fillNoise(c, 1, 1, half-2, half-3, ['#949494','#9a9a9a'], 0.08, rng);
      fillNoise(c, half+2, half+2, half-4, half-4, ['#929292','#989898'], 0.08, rng);
      // Wear marks
      fillNoise(c, 0, 0, s, s, ['#6e6e6e','#727272'], 0.04, rng);
      // Moss in crevices
      if (v % 4 === 0) {
        c.fillStyle = '#5a7a4a';
        c.fillRect(Math.floor(rng()*s), half-1, 3, 2);
      }
      break;
    }

    // ===== STONE WALL =====
    case T.STONE_WALL: {
      c.fillStyle = '#606060';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#585858','#666','#5c5c5c','#626262','#6a6a6a','#5e5e5e'], 0.65, rng);
      // 3D top edge highlight
      fillNoise(c, 0, 0, s, Math.floor(s*0.12), ['#808080','#888','#7a7a7a','#8e8e8e'], 0.6, rng);
      // Mortar lines
      c.fillStyle = '#4a4a4a';
      const wh = Math.floor(s/2);
      c.fillRect(0, wh-1, s, 2);
      if (v % 2 === 0) {
        c.fillRect(wh-1, 0, 2, wh);
        c.fillRect(Math.floor(s*0.25)-1, wh, 2, wh);
        c.fillRect(Math.floor(s*0.75)-1, wh, 2, wh);
      } else {
        c.fillRect(Math.floor(s*0.25)-1, 0, 2, wh);
        c.fillRect(Math.floor(s*0.75)-1, 0, 2, wh);
        c.fillRect(wh-1, wh, 2, wh);
      }
      // Dark bottom edge (3D)
      fillNoise(c, 0, s-3, s, 3, ['#3a3a3a','#444','#3e3e3e'], 0.6, rng);
      c.fillStyle = '#3a3a3a';
      c.fillRect(s-1, 0, 1, s);
      // Stone individual texture per brick
      fillNoise(c, 2, 2, wh-4, wh-4, ['#727272','#6c6c6c'], 0.06, rng);
      // Moss/damage
      if (v % 3 === 0) {
        fillNoise(c, 0, Math.floor(s*0.8), Math.floor(s*0.3), Math.floor(s*0.15), ['#4a604a','#3a5a3a'], 0.3, rng);
      }
      break;
    }

    // ===== CHURCH WALL =====
    case T.CHURCH_WALL: {
      c.fillStyle = '#6a6058';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#625a50','#6e6660','#685e56','#726a62','#5e5650','#6c6460'], 0.65, rng);
      // Top highlight
      fillNoise(c, 0, 0, s, Math.floor(s*0.12), ['#868078','#8a847c','#7e7870'], 0.55, rng);
      // Mortar
      c.fillStyle = '#504840';
      const cwh = Math.floor(s/2);
      c.fillRect(0, cwh-1, s, 2);
      if (v%2===0) { c.fillRect(cwh-1,0,2,cwh); c.fillRect(Math.floor(s*0.25)-1,cwh,2,cwh); c.fillRect(Math.floor(s*0.75)-1,cwh,2,cwh); }
      else { c.fillRect(Math.floor(s*0.25)-1,0,2,cwh); c.fillRect(Math.floor(s*0.75)-1,0,2,cwh); c.fillRect(cwh-1,cwh,2,cwh); }
      // Dark bottom
      fillNoise(c, 0, s-3, s, 3, ['#3e3830','#443e38'], 0.5, rng);
      // Warm accent
      fillNoise(c, 0, 0, s, s, ['#7a705e','#82786a'], 0.04, rng);
      break;
    }

    // ===== WINDOW STONE =====
    case T.WINDOW_STONE: {
      // Wall base
      c.fillStyle = '#606060';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#585858','#666','#5c5c5c','#626262'], 0.5, rng);
      // Frame
      c.fillStyle = '#3a2a18';
      const fw = Math.floor(s*0.65), fh = Math.floor(s*0.7);
      const fx = Math.floor(s*0.17), fy = Math.floor(s*0.12);
      c.fillRect(fx, fy, fw, fh);
      // Glass panes (4 sections)
      const gw = Math.floor(fw*0.42), gh = Math.floor(fh*0.42);
      const gx1 = fx+3, gy1 = fy+3;
      const gx2 = fx+fw-gw-2, gy2 = fy+fh-gh-2;
      for (const [gx,gy] of [[gx1,gy1],[gx2,gy1],[gx1,gy2],[gx2,gy2]]) {
        c.fillStyle = '#4a80b8';
        c.fillRect(gx, gy, gw, gh);
        fillNoise(c, gx, gy, gw, gh, ['#5090c8','#4888c0','#5a98d0','#4280b0'], 0.35, rng);
        // Reflection
        c.fillStyle = 'rgba(180,220,255,0.25)';
        c.fillRect(gx+1, gy+1, Math.floor(gw*0.4), Math.floor(gh*0.3));
      }
      // Cross frame
      c.fillStyle = '#3a2a18';
      c.fillRect(fx+Math.floor(fw*0.45), fy, Math.floor(fw*0.1), fh);
      c.fillRect(fx, fy+Math.floor(fh*0.45), fw, Math.floor(fh*0.1));
      break;
    }

    // ===== WINDOW WOOD =====
    case T.WINDOW_WOOD: {
      c.fillStyle = '#6a4828';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#604020','#6e4c2c','#5a3a1a','#725030'], 0.5, rng);
      // Wood grain
      c.fillStyle = '#5a3818';
      c.fillRect(Math.floor(s*0.33), 0, 1, s);
      c.fillRect(Math.floor(s*0.66), 0, 1, s);
      // Frame
      c.fillStyle = '#3a2010';
      const wfw = Math.floor(s*0.65), wfh = Math.floor(s*0.7);
      const wfx = Math.floor(s*0.17), wfy = Math.floor(s*0.12);
      c.fillRect(wfx, wfy, wfw, wfh);
      // Glass with warm light
      const wgw = Math.floor(wfw*0.42), wgh = Math.floor(wfh*0.42);
      for (const [gx,gy] of [[wfx+3,wfy+3],[wfx+wfw-wgw-2,wfy+3],[wfx+3,wfy+wfh-wgh-2],[wfx+wfw-wgw-2,wfy+wfh-wgh-2]]) {
        c.fillStyle = '#6a9ac8';
        c.fillRect(gx, gy, wgw, wgh);
        fillNoise(c, gx, gy, wgw, wgh, ['#70a0d0','#78a8d8','#6898c0'], 0.3, rng);
        c.fillStyle = 'rgba(255,240,200,0.15)';
        c.fillRect(gx, gy+Math.floor(wgh*0.5), wgw, Math.floor(wgh*0.5));
      }
      c.fillStyle = '#3a2010';
      c.fillRect(wfx+Math.floor(wfw*0.45), wfy, Math.floor(wfw*0.1), wfh);
      c.fillRect(wfx, wfy+Math.floor(wfh*0.45), wfw, Math.floor(wfh*0.1));
      break;
    }

    // ===== TORCH WALL =====
    case T.TORCH_WALL: {
      c.fillStyle = '#606060';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#585858','#666','#5c5c5c','#626262'], 0.5, rng);
      // Bracket
      c.fillStyle = '#444';
      c.fillRect(Math.floor(s*0.44), Math.floor(s*0.42), Math.floor(s*0.12), Math.floor(s*0.4));
      // Handle
      c.fillStyle = '#4a3018';
      c.fillRect(Math.floor(s*0.4), Math.floor(s*0.35), Math.floor(s*0.2), Math.floor(s*0.1));
      fillNoise(c, Math.floor(s*0.4), Math.floor(s*0.35), Math.floor(s*0.2), Math.floor(s*0.1), ['#5a4028','#3a2010'], 0.3, rng);
      // Flame layers
      c.fillStyle = '#cc3300';
      c.fillRect(Math.floor(s*0.35), Math.floor(s*0.15), Math.floor(s*0.3), Math.floor(s*0.22));
      c.fillStyle = '#ff6600';
      c.fillRect(Math.floor(s*0.38), Math.floor(s*0.18), Math.floor(s*0.24), Math.floor(s*0.16));
      c.fillStyle = '#ff9900';
      c.fillRect(Math.floor(s*0.42), Math.floor(s*0.2), Math.floor(s*0.16), Math.floor(s*0.12));
      c.fillStyle = '#ffcc00';
      c.fillRect(Math.floor(s*0.45), Math.floor(s*0.22), Math.floor(s*0.1), Math.floor(s*0.08));
      c.fillStyle = '#fff8e0';
      c.fillRect(Math.floor(s*0.47), Math.floor(s*0.24), Math.floor(s*0.06), Math.floor(s*0.04));
      // Flame noise
      fillNoise(c, Math.floor(s*0.35), Math.floor(s*0.12), Math.floor(s*0.3), Math.floor(s*0.1), ['#ff4400','#ff8800'], 0.2, rng);
      // Glow
      c.fillStyle = 'rgba(255,140,30,0.12)';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, Math.floor(s*0.5), ['rgba(255,100,0,0.06)','rgba(255,150,50,0.06)'], 0.1, rng);
      break;
    }

    // ===== TREE =====
    case T.TREE: {
      // Grass base
      c.fillStyle = '#3a7a2d';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#347228','#2e6a22','#3e8232'], 0.45, rng);
      // Ground shadow
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.72), Math.floor(s*0.84), Math.floor(s*0.2));
      // Roots
      c.fillStyle = '#4a3018';
      for (let i = 0; i < 3; i++) {
        const rx = Math.floor(s*0.3) + Math.floor(rng()*s*0.2);
        c.fillRect(rx, Math.floor(s*0.72), Math.floor(rng()*s*0.3)+3, 3);
      }
      // Trunk
      const tw = Math.floor(s*0.28), th = Math.floor(s*0.42);
      const ttx = Math.floor(s*0.36), tty = Math.floor(s*0.38);
      c.fillStyle = '#4a3018';
      c.fillRect(ttx, tty, tw, th);
      // Bark texture
      fillNoise(c, ttx, tty, tw, th, ['#3a2008','#5a4020','#4a3518','#3e2810','#583c1c','#422a0e'], 0.65, rng);
      // Bark highlight (left side)
      fillNoise(c, ttx, tty, Math.floor(tw*0.3), th, ['#6a5030','#5e4428'], 0.2, rng);
      // Bark dark (right side)
      fillNoise(c, ttx+Math.floor(tw*0.7), tty, Math.floor(tw*0.3), th, ['#2a1808','#301e0a'], 0.25, rng);
      // Canopy - multi-layered
      const cx = Math.floor(s*0.06), cy = Math.floor(s*0.04);
      const cww = Math.floor(s*0.88), chh = Math.floor(s*0.5);
      // Canopy dark base
      c.fillStyle = '#0e3a08';
      c.fillRect(cx+2, cy+4, cww-4, chh-4);
      c.fillRect(cx+Math.floor(s*0.06), cy, cww-Math.floor(s*0.12), chh);
      // Leaf texture
      fillNoise(c, cx, cy, cww, chh, [
        '#145008','#1a5c0e','#104a06','#186012','#0e4206',
        '#1c6214','#124c08','#166010','#1e6818'
      ], 0.7, rng);
      // Mid highlights
      fillNoise(c, cx+2, cy+2, cww-4, Math.floor(chh*0.5), [
        '#2a7820','#267420','#2e7e24','#228020'
      ], 0.2, rng);
      // Top highlights (light comes from top)
      fillNoise(c, cx+4, cy, cww-8, Math.floor(chh*0.25), [
        '#3a8a2e','#3e9032','#429436','#369028'
      ], 0.25, rng);
      // Bright leaf spots
      fillNoise(c, cx, cy, cww, chh, ['#4aa040','#50a846','#46983c'], 0.04, rng);
      // Shadow at bottom of canopy
      fillNoise(c, cx+4, cy+Math.floor(chh*0.8), cww-8, Math.floor(chh*0.2), [
        '#083006','#0a3408','#062c04'
      ], 0.35, rng);
      break;
    }

    // ===== WOOD FLOOR =====
    case T.WOOD_FLOOR: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, [
        '#8a5828','#9a6838','#a07040','#8e5c2c','#946230',
        '#885424','#9c6c3c','#926034'
      ], 0.65, rng);
      // Plank gaps
      c.fillStyle = '#5a3818';
      const nPlanks = 4;
      for (let i = 1; i < nPlanks; i++) {
        c.fillRect(0, Math.floor(i*s/nPlanks)-1, s, 2);
      }
      // Board end offsets
      c.fillStyle = '#5a3818';
      for (let i = 0; i < nPlanks; i++) {
        const ox = Math.floor(rng()*s*0.6)+Math.floor(s*0.2);
        c.fillRect(ox, Math.floor(i*s/nPlanks), 1, Math.floor(s/nPlanks));
      }
      // Wood grain (horizontal lines in each plank)
      c.fillStyle = '#7a4820';
      for (let i = 0; i < nPlanks; i++) {
        const py = Math.floor(i*s/nPlanks)+2;
        const ph = Math.floor(s/nPlanks)-3;
        for (let j = 0; j < 2; j++) {
          const gy = py + Math.floor(rng()*ph);
          c.fillRect(0, gy, s, 1);
          c.globalAlpha = 0.5;
          c.fillRect(0, gy, s, 1);
          c.globalAlpha = 1;
        }
      }
      // Highlights
      fillNoise(c, 0, 0, s, s, ['#b08050','#a87848'], 0.04, rng);
      // Knots
      if (v%3===0) {
        const kx = Math.floor(rng()*s*0.7)+Math.floor(s*0.15), ky = Math.floor(rng()*s*0.7)+Math.floor(s*0.15);
        c.fillStyle = '#6a3818';
        c.fillRect(kx, ky, 3, 3);
        c.fillStyle = '#5a2810';
        c.fillRect(kx+1, ky+1, 1, 1);
      }
      break;
    }

    // ===== CHURCH FLOOR =====
    case T.CHURCH_FLOOR: {
      // Marble tiles checkerboard
      if (v % 2 === 0) {
        c.fillStyle = '#d8d0b8';
        c.fillRect(0, 0, s, s);
        fillNoise(c, 0, 0, s, s, ['#d0c8b0','#dcd4bc','#d4ccb4','#e0d8c0'], 0.5, rng);
        // Marble veins
        c.fillStyle = '#c0b8a0';
        for (let i = 0; i < 3; i++) {
          const vy = Math.floor(rng()*s), vx = Math.floor(rng()*s*0.3);
          for (let px = vx; px < s; px++) {
            c.fillRect(px, vy + Math.floor(Math.sin(px*0.3)*2), 1, 1);
            if (rng() > 0.7) vy + 1;
          }
        }
      } else {
        c.fillStyle = '#b8b098';
        c.fillRect(0, 0, s, s);
        fillNoise(c, 0, 0, s, s, ['#b0a890','#bcb49c','#b4ac94','#c0b8a0'], 0.5, rng);
      }
      // Tile border
      c.fillStyle = '#9a9280';
      c.fillRect(0, 0, s, 1); c.fillRect(0, 0, 1, s);
      c.fillRect(s-1, 0, 1, s); c.fillRect(0, s-1, s, 1);
      break;
    }

    // ===== RED CARPET =====
    case T.RED_CARPET: {
      // Floor base
      c.fillStyle = '#d0c8b0';
      c.fillRect(0, 0, s, s);
      // Carpet
      c.fillStyle = '#7a1515';
      c.fillRect(Math.floor(s*0.05), 0, Math.floor(s*0.9), s);
      fillNoise(c, Math.floor(s*0.05), 0, Math.floor(s*0.9), s, [
        '#701010','#7a1515','#841a1a','#6a0e0e','#801818'
      ], 0.55, rng);
      // Gold borders
      c.fillStyle = '#d4a040';
      c.fillRect(Math.floor(s*0.05), 0, 2, s);
      c.fillRect(Math.floor(s*0.9)+1, 0, 2, s);
      fillNoise(c, Math.floor(s*0.05), 0, 2, s, ['#c89838','#dca848'], 0.3, rng);
      fillNoise(c, Math.floor(s*0.9)+1, 0, 2, s, ['#c89838','#dca848'], 0.3, rng);
      // Inner pattern
      c.fillStyle = '#901818';
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.12), Math.floor(s*0.76), Math.floor(s*0.76));
      // Gold inner border
      c.fillStyle = '#c89838';
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.12), Math.floor(s*0.76), 1);
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.86), Math.floor(s*0.76), 1);
      break;
    }

    // ===== ALTAR =====
    case T.ALTAR: {
      // Floor
      c.fillStyle = '#d0c8b0';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#c8c0a8','#d4ccb4'], 0.3, rng);
      // Altar body
      c.fillStyle = '#d8d8d8';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.3), Math.floor(s*0.84), Math.floor(s*0.62));
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.3), Math.floor(s*0.84), Math.floor(s*0.62), ['#d0d0d0','#e0e0e0','#dcdcdc','#cccccc'], 0.4, rng);
      // Top surface
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.3), Math.floor(s*0.84), Math.floor(s*0.1), ['#eaeaea','#f0f0f0','#e4e4e4'], 0.5, rng);
      // Gold trim
      c.fillStyle = '#d4a040';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.29), Math.floor(s*0.84), 2);
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.9), Math.floor(s*0.84), 2);
      // Candles
      for (const cx of [s*0.18, s*0.74]) {
        c.fillStyle = '#f0e8c0';
        c.fillRect(Math.floor(cx), Math.floor(s*0.12), Math.floor(s*0.08), Math.floor(s*0.2));
        c.fillStyle = '#ff8800';
        c.fillRect(Math.floor(cx)+1, Math.floor(s*0.06), Math.floor(s*0.06), Math.floor(s*0.08));
        c.fillStyle = '#ffcc00';
        c.fillRect(Math.floor(cx)+2, Math.floor(s*0.08), Math.floor(s*0.04), Math.floor(s*0.04));
      }
      break;
    }

    // ===== CROSS =====
    case T.CROSS: {
      c.fillStyle = '#d0c8b0';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#c8c0a8','#d4ccb4'], 0.3, rng);
      // Golden cross
      c.fillStyle = '#d4a040';
      const crw = Math.floor(s*0.16), crh = Math.floor(s*0.82);
      c.fillRect(Math.floor(s*0.42), Math.floor(s*0.05), crw, crh);
      c.fillRect(Math.floor(s*0.2), Math.floor(s*0.18), Math.floor(s*0.6), Math.floor(s*0.16));
      fillNoise(c, Math.floor(s*0.42), Math.floor(s*0.05), crw, crh, ['#c89838','#dca848','#d0a040'], 0.3, rng);
      // Highlight
      c.fillStyle = '#e4b858';
      c.fillRect(Math.floor(s*0.42), Math.floor(s*0.05), crw, 2);
      c.fillRect(Math.floor(s*0.2), Math.floor(s*0.18), Math.floor(s*0.6), 2);
      // Shadow
      c.fillStyle = '#a07828';
      c.fillRect(Math.floor(s*0.42), Math.floor(s*0.05)+crh-2, crw, 2);
      c.fillRect(Math.floor(s*0.56), Math.floor(s*0.18), 2, Math.floor(s*0.16));
      break;
    }

    // ===== CHURCH PEW =====
    case T.CHURCH_PEW: {
      c.fillStyle = '#d0c8b0';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#c8c0a8','#d4ccb4'], 0.25, rng);
      c.fillStyle = '#9a9280'; c.fillRect(0,0,s,1); c.fillRect(0,0,1,s);
      // Bench
      c.fillStyle = '#4a2510';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.25), Math.floor(s*0.84), Math.floor(s*0.55));
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.25), Math.floor(s*0.84), Math.floor(s*0.55), ['#3a1808','#5a3520','#4e2c18','#3e1c0a'], 0.5, rng);
      // Top rail
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.25), Math.floor(s*0.84), Math.floor(s*0.08), ['#6a4828','#5e3c1c'], 0.4, rng);
      // Back rest
      c.fillStyle = '#603818';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.12), Math.floor(s*0.84), Math.floor(s*0.15));
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.12), Math.floor(s*0.84), Math.floor(s*0.15), ['#6a4020','#5a3418'], 0.3, rng);
      // Legs
      c.fillStyle = '#3a1808';
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.72), Math.floor(s*0.06), Math.floor(s*0.14));
      c.fillRect(Math.floor(s*0.82), Math.floor(s*0.72), Math.floor(s*0.06), Math.floor(s*0.14));
      break;
    }

    // ===== ANVIL =====
    case T.ANVIL: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#8a5828','#9a6838','#a07040'], 0.4, rng);
      // Shadow
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(Math.floor(s*0.15), Math.floor(s*0.78), Math.floor(s*0.7), Math.floor(s*0.12));
      // Base
      c.fillStyle = '#333';
      c.fillRect(Math.floor(s*0.25), Math.floor(s*0.6), Math.floor(s*0.5), Math.floor(s*0.25));
      fillNoise(c, Math.floor(s*0.25), Math.floor(s*0.6), Math.floor(s*0.5), Math.floor(s*0.25), ['#2a2a2a','#3a3a3a','#303030'], 0.4, rng);
      // Top
      c.fillStyle = '#444';
      c.fillRect(Math.floor(s*0.1), Math.floor(s*0.38), Math.floor(s*0.8), Math.floor(s*0.24));
      fillNoise(c, Math.floor(s*0.1), Math.floor(s*0.38), Math.floor(s*0.8), Math.floor(s*0.24), ['#3a3a3a','#4a4a4a','#404040','#505050'], 0.5, rng);
      // Surface highlight
      fillNoise(c, Math.floor(s*0.12), Math.floor(s*0.38), Math.floor(s*0.76), Math.floor(s*0.06), ['#606060','#6a6a6a','#585858'], 0.6, rng);
      // Horn
      c.fillStyle = '#484848';
      c.fillRect(Math.floor(s*0.04), Math.floor(s*0.42), Math.floor(s*0.08), Math.floor(s*0.14));
      break;
    }

    // ===== FURNACE =====
    case T.FURNACE: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#8a5828','#9a6838'], 0.3, rng);
      // Furnace body
      c.fillStyle = '#3a2828';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.06), Math.floor(s*0.84), Math.floor(s*0.88));
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.06), Math.floor(s*0.84), Math.floor(s*0.88), ['#342424','#3e2c2c','#2e2020','#402e2e','#382828'], 0.55, rng);
      // Stone frame
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.06), Math.floor(s*0.84), Math.floor(s*0.08), ['#4a3838','#524040','#463636'], 0.5, rng);
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.06), Math.floor(s*0.08), Math.floor(s*0.88), ['#4a3838','#524040'], 0.5, rng);
      fillNoise(c, Math.floor(s*0.84), Math.floor(s*0.06), Math.floor(s*0.08), Math.floor(s*0.88), ['#4a3838','#524040'], 0.5, rng);
      // Fire opening
      c.fillStyle = '#141414';
      c.fillRect(Math.floor(s*0.22), Math.floor(s*0.42), Math.floor(s*0.56), Math.floor(s*0.42));
      // Fire
      c.fillStyle = '#aa2200';
      c.fillRect(Math.floor(s*0.26), Math.floor(s*0.56), Math.floor(s*0.48), Math.floor(s*0.24));
      fillNoise(c, Math.floor(s*0.26), Math.floor(s*0.52), Math.floor(s*0.48), Math.floor(s*0.28), ['#cc3300','#ff4400','#dd4400','#aa2200'], 0.45, rng);
      fillNoise(c, Math.floor(s*0.3), Math.floor(s*0.56), Math.floor(s*0.4), Math.floor(s*0.18), ['#ff6600','#ff8800','#ffaa00'], 0.4, rng);
      fillNoise(c, Math.floor(s*0.35), Math.floor(s*0.58), Math.floor(s*0.3), Math.floor(s*0.12), ['#ffcc00','#ffdd44','#ffee66'], 0.35, rng);
      // Glow
      c.fillStyle = 'rgba(255,80,0,0.06)';
      c.fillRect(0, 0, s, s);
      break;
    }

    // ===== BOOKSHELF =====
    case T.BOOKSHELF: {
      c.fillStyle = '#d0c8b0';
      c.fillRect(0, 0, s, s);
      // Shelf frame
      c.fillStyle = '#3a2008';
      c.fillRect(Math.floor(s*0.06), Math.floor(s*0.04), Math.floor(s*0.88), Math.floor(s*0.92));
      fillNoise(c, Math.floor(s*0.06), Math.floor(s*0.04), Math.floor(s*0.88), Math.floor(s*0.92), ['#2e1806','#3e2810','#34200a'], 0.4, rng);
      // 3 shelves
      for (const sy of [0.3, 0.58, 0.86]) {
        c.fillStyle = '#4a3018';
        c.fillRect(Math.floor(s*0.06), Math.floor(s*sy), Math.floor(s*0.88), Math.floor(s*0.04));
      }
      // Books in 3 rows
      const bCol = ['#8b1818','#18408b','#186828','#8b6818','#681868','#186878','#8b3818','#2a5818'];
      for (let row = 0; row < 3; row++) {
        const rowY = Math.floor(s * (0.06 + row * 0.28));
        const rowH = Math.floor(s * 0.24);
        let bx = Math.floor(s*0.1);
        while (bx < s*0.9) {
          const bw = Math.floor(rng()*3)+2;
          c.fillStyle = bCol[Math.floor(rng()*bCol.length)];
          c.fillRect(bx, rowY, bw, rowH);
          // Book spine line
          c.fillStyle = 'rgba(0,0,0,0.15)';
          c.fillRect(bx, rowY, 1, rowH);
          // Book top highlight
          c.fillStyle = 'rgba(255,255,255,0.1)';
          c.fillRect(bx, rowY, bw, 1);
          bx += bw + 1;
        }
      }
      break;
    }

    // ===== TABLE =====
    case T.TABLE: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#8a5828','#9a6838','#a07040'], 0.4, rng);
      // Table surface
      c.fillStyle = '#6a4020';
      c.fillRect(Math.floor(s*0.06), Math.floor(s*0.22), Math.floor(s*0.88), Math.floor(s*0.56));
      fillNoise(c, Math.floor(s*0.06), Math.floor(s*0.22), Math.floor(s*0.88), Math.floor(s*0.56), ['#5a3018','#6a4020','#7a5030','#604020'], 0.55, rng);
      // Top highlight
      fillNoise(c, Math.floor(s*0.06), Math.floor(s*0.22), Math.floor(s*0.88), Math.floor(s*0.08), ['#8a6040','#7a5030','#946a48'], 0.5, rng);
      // Legs
      c.fillStyle = '#4a2810';
      c.fillRect(Math.floor(s*0.1), Math.floor(s*0.78), Math.floor(s*0.08), Math.floor(s*0.18));
      c.fillRect(Math.floor(s*0.82), Math.floor(s*0.78), Math.floor(s*0.08), Math.floor(s*0.18));
      break;
    }

    // ===== CHAIR =====
    case T.CHAIR: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#8a5828','#9a6838'], 0.35, rng);
      // Back
      c.fillStyle = '#4a2510';
      c.fillRect(Math.floor(s*0.2), Math.floor(s*0.1), Math.floor(s*0.6), Math.floor(s*0.32));
      fillNoise(c, Math.floor(s*0.2), Math.floor(s*0.1), Math.floor(s*0.6), Math.floor(s*0.32), ['#3a1808','#5a3520','#4a2810'], 0.45, rng);
      // Back slats
      c.fillStyle = '#5a3520';
      c.fillRect(Math.floor(s*0.25), Math.floor(s*0.15), Math.floor(s*0.5), Math.floor(s*0.06));
      c.fillRect(Math.floor(s*0.25), Math.floor(s*0.28), Math.floor(s*0.5), Math.floor(s*0.06));
      // Seat
      c.fillStyle = '#5a3518';
      c.fillRect(Math.floor(s*0.18), Math.floor(s*0.44), Math.floor(s*0.64), Math.floor(s*0.14));
      fillNoise(c, Math.floor(s*0.18), Math.floor(s*0.44), Math.floor(s*0.64), Math.floor(s*0.14), ['#6a4528','#4e2c14'], 0.35, rng);
      // Legs
      c.fillStyle = '#3a1808';
      c.fillRect(Math.floor(s*0.22), Math.floor(s*0.58), Math.floor(s*0.06), Math.floor(s*0.34));
      c.fillRect(Math.floor(s*0.72), Math.floor(s*0.58), Math.floor(s*0.06), Math.floor(s*0.34));
      break;
    }

    // ===== BED =====
    case T.BED: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#8a5828','#9a6838'], 0.3, rng);
      // Frame
      c.fillStyle = '#4a2510';
      c.fillRect(Math.floor(s*0.04), Math.floor(s*0.12), Math.floor(s*0.92), Math.floor(s*0.8));
      fillNoise(c, Math.floor(s*0.04), Math.floor(s*0.12), Math.floor(s*0.92), Math.floor(s*0.8), ['#3a1808','#4a2810'], 0.35, rng);
      // Mattress
      c.fillStyle = '#e0d8c0';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.18), Math.floor(s*0.84), Math.floor(s*0.68));
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.18), Math.floor(s*0.84), Math.floor(s*0.68), ['#d8d0b8','#e4dcc4','#dcd4bc'], 0.35, rng);
      // Blanket
      c.fillStyle = '#7a1515';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.45), Math.floor(s*0.84), Math.floor(s*0.42));
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.45), Math.floor(s*0.84), Math.floor(s*0.42), ['#701010','#841a1a','#7a1515','#6a0e0e'], 0.45, rng);
      // Fold line
      c.fillStyle = '#8a2525';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.45), Math.floor(s*0.84), Math.floor(s*0.06));
      // Pillow
      c.fillStyle = '#f0ead8';
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.2), Math.floor(s*0.35), Math.floor(s*0.2));
      fillNoise(c, Math.floor(s*0.12), Math.floor(s*0.2), Math.floor(s*0.35), Math.floor(s*0.2), ['#e8e2d0','#f4eee0','#ece6d4'], 0.35, rng);
      c.fillStyle = '#fff';
      c.fillRect(Math.floor(s*0.14), Math.floor(s*0.22), Math.floor(s*0.15), Math.floor(s*0.04));
      break;
    }

    // ===== RUG =====
    case T.RUG: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#8a5828','#9a6838'], 0.3, rng);
      // Rug
      c.fillStyle = '#6a1818';
      c.fillRect(Math.floor(s*0.04), Math.floor(s*0.04), Math.floor(s*0.92), Math.floor(s*0.92));
      fillNoise(c, Math.floor(s*0.04), Math.floor(s*0.04), Math.floor(s*0.92), Math.floor(s*0.92), ['#601010','#701818','#651515','#751a1a'], 0.5, rng);
      // Gold borders
      c.fillStyle = '#d4a040';
      c.fillRect(Math.floor(s*0.04), Math.floor(s*0.04), Math.floor(s*0.92), 2);
      c.fillRect(Math.floor(s*0.04), Math.floor(s*0.92), Math.floor(s*0.92), 2);
      c.fillRect(Math.floor(s*0.04), Math.floor(s*0.04), 2, Math.floor(s*0.92));
      c.fillRect(Math.floor(s*0.92)+1, Math.floor(s*0.04), 2, Math.floor(s*0.92));
      // Inner border
      c.fillStyle = '#c89838';
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.12), Math.floor(s*0.76), 1);
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.86), Math.floor(s*0.76), 1);
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.12), 1, Math.floor(s*0.76));
      c.fillRect(Math.floor(s*0.86)+1, Math.floor(s*0.12), 1, Math.floor(s*0.76));
      // Center diamond pattern
      c.fillStyle = '#801818';
      const mid = Math.floor(s/2);
      for (let d = 0; d < Math.floor(s*0.15); d++) {
        c.fillRect(mid-d, mid-Math.floor(s*0.15)+d, 1, 1);
        c.fillRect(mid+d, mid-Math.floor(s*0.15)+d, 1, 1);
        c.fillRect(mid-d, mid+Math.floor(s*0.15)-d, 1, 1);
        c.fillRect(mid+d, mid+Math.floor(s*0.15)-d, 1, 1);
      }
      break;
    }

    // ===== BARREL =====
    case T.BARREL: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#8a5828','#9a6838'], 0.35, rng);
      // Shadow
      c.fillStyle = 'rgba(0,0,0,0.15)';
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.8), Math.floor(s*0.76), Math.floor(s*0.12));
      // Barrel body
      c.fillStyle = '#5a3818';
      c.fillRect(Math.floor(s*0.18), Math.floor(s*0.1), Math.floor(s*0.64), Math.floor(s*0.76));
      // Wider middle
      c.fillRect(Math.floor(s*0.14), Math.floor(s*0.28), Math.floor(s*0.72), Math.floor(s*0.4));
      fillNoise(c, Math.floor(s*0.14), Math.floor(s*0.1), Math.floor(s*0.72), Math.floor(s*0.76), [
        '#4e2c10','#5a3818','#6a4828','#523018','#5e3c1c'
      ], 0.55, rng);
      // Staves (vertical lines)
      c.fillStyle = '#4a2c10';
      for (const sx of [0.25, 0.38, 0.52, 0.65]) {
        c.fillRect(Math.floor(s*sx), Math.floor(s*0.12), 1, Math.floor(s*0.72));
      }
      // Metal rings
      c.fillStyle = '#505050';
      c.fillRect(Math.floor(s*0.16), Math.floor(s*0.2), Math.floor(s*0.68), 2);
      c.fillRect(Math.floor(s*0.16), Math.floor(s*0.75), Math.floor(s*0.68), 2);
      fillNoise(c, Math.floor(s*0.16), Math.floor(s*0.2), Math.floor(s*0.68), 2, ['#4a4a4a','#5a5a5a','#555'], 0.6, rng);
      fillNoise(c, Math.floor(s*0.16), Math.floor(s*0.75), Math.floor(s*0.68), 2, ['#4a4a4a','#5a5a5a','#555'], 0.6, rng);
      // Top
      fillNoise(c, Math.floor(s*0.2), Math.floor(s*0.08), Math.floor(s*0.6), Math.floor(s*0.06), ['#7a5838','#6a4828','#8a6848'], 0.5, rng);
      // Highlight
      fillNoise(c, Math.floor(s*0.2), Math.floor(s*0.3), Math.floor(s*0.12), Math.floor(s*0.15), ['#7a5838','#8a6848'], 0.25, rng);
      break;
    }

    // ===== CRATE =====
    case T.CRATE: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#8a5828','#9a6838'], 0.3, rng);
      // Crate body
      c.fillStyle = '#7a5830';
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.12), Math.floor(s*0.76), Math.floor(s*0.76));
      fillNoise(c, Math.floor(s*0.12), Math.floor(s*0.12), Math.floor(s*0.76), Math.floor(s*0.76), [
        '#6a4820','#7a5830','#8a6840','#725028','#846038'
      ], 0.55, rng);
      // Top highlight
      fillNoise(c, Math.floor(s*0.12), Math.floor(s*0.12), Math.floor(s*0.76), Math.floor(s*0.08), ['#947048','#9a7850'], 0.4, rng);
      // Cross beams
      c.fillStyle = '#5a3818';
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.48), Math.floor(s*0.76), 2);
      c.fillRect(Math.floor(s*0.48), Math.floor(s*0.12), 2, Math.floor(s*0.76));
      // Nails
      c.fillStyle = '#999';
      c.fillRect(Math.floor(s*0.48), Math.floor(s*0.48), 2, 2);
      c.fillRect(Math.floor(s*0.48), Math.floor(s*0.14), 2, 2);
      c.fillRect(Math.floor(s*0.48), Math.floor(s*0.82), 2, 2);
      c.fillRect(Math.floor(s*0.14), Math.floor(s*0.48), 2, 2);
      c.fillRect(Math.floor(s*0.82), Math.floor(s*0.48), 2, 2);
      break;
    }

    // ===== WELL =====
    case T.WELL: {
      c.fillStyle = '#858585';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#7a7a7a','#8a8a8a','#808080'], 0.45, rng);
      // Well wall
      c.fillStyle = '#5a5a5a';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.25), Math.floor(s*0.84), Math.floor(s*0.68));
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.25), Math.floor(s*0.84), Math.floor(s*0.68), ['#505050','#606060','#5a5a5a','#545454'], 0.5, rng);
      // Well wall top
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.25), Math.floor(s*0.84), Math.floor(s*0.1), ['#6a6a6a','#747474','#707070'], 0.5, rng);
      // Water
      c.fillStyle = '#1a4a90';
      c.fillRect(Math.floor(s*0.18), Math.floor(s*0.38), Math.floor(s*0.64), Math.floor(s*0.44));
      fillNoise(c, Math.floor(s*0.18), Math.floor(s*0.38), Math.floor(s*0.64), Math.floor(s*0.44), ['#164080','#1e5298','#1a4890'], 0.35, rng);
      // Posts
      c.fillStyle = '#4a3018';
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.06), Math.floor(s*0.08), Math.floor(s*0.55));
      c.fillRect(Math.floor(s*0.8), Math.floor(s*0.06), Math.floor(s*0.08), Math.floor(s*0.55));
      fillNoise(c, Math.floor(s*0.12), Math.floor(s*0.06), Math.floor(s*0.08), Math.floor(s*0.55), ['#3a2008','#5a4020'], 0.35, rng);
      fillNoise(c, Math.floor(s*0.8), Math.floor(s*0.06), Math.floor(s*0.08), Math.floor(s*0.55), ['#3a2008','#5a4020'], 0.35, rng);
      // Roof beam
      c.fillStyle = '#5a3818';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.04), Math.floor(s*0.84), Math.floor(s*0.06));
      // Rope
      c.fillStyle = '#8a7a50';
      c.fillRect(Math.floor(s*0.48), Math.floor(s*0.1), 2, Math.floor(s*0.3));
      // Bucket hint
      c.fillStyle = '#6a5030';
      c.fillRect(Math.floor(s*0.44), Math.floor(s*0.38), Math.floor(s*0.12), Math.floor(s*0.1));
      break;
    }

    // ===== FENCE =====
    case T.FENCE: {
      c.fillStyle = '#3a7a2d';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#347228','#3e8232','#2e6a22'], 0.45, rng);
      // Posts
      c.fillStyle = '#5a3818';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.15), Math.floor(s*0.1), Math.floor(s*0.76));
      c.fillRect(Math.floor(s*0.82), Math.floor(s*0.15), Math.floor(s*0.1), Math.floor(s*0.76));
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.15), Math.floor(s*0.1), Math.floor(s*0.76), ['#4a2808','#6a4828'], 0.35, rng);
      fillNoise(c, Math.floor(s*0.82), Math.floor(s*0.15), Math.floor(s*0.1), Math.floor(s*0.76), ['#4a2808','#6a4828'], 0.35, rng);
      // Post tops
      fillNoise(c, Math.floor(s*0.06), Math.floor(s*0.12), Math.floor(s*0.14), Math.floor(s*0.05), ['#6a4828','#7a5838'], 0.5, rng);
      fillNoise(c, Math.floor(s*0.8), Math.floor(s*0.12), Math.floor(s*0.14), Math.floor(s*0.05), ['#6a4828','#7a5838'], 0.5, rng);
      // Rails
      c.fillStyle = '#6a4828';
      c.fillRect(0, Math.floor(s*0.3), s, Math.floor(s*0.08));
      c.fillRect(0, Math.floor(s*0.58), s, Math.floor(s*0.08));
      fillNoise(c, 0, Math.floor(s*0.3), s, Math.floor(s*0.08), ['#5a3818','#7a5838','#6a4828'], 0.4, rng);
      fillNoise(c, 0, Math.floor(s*0.58), s, Math.floor(s*0.08), ['#5a3818','#7a5838','#6a4828'], 0.4, rng);
      // Rail highlight
      c.fillStyle = '#7a5838';
      c.fillRect(0, Math.floor(s*0.3), s, 1);
      c.fillRect(0, Math.floor(s*0.58), s, 1);
      break;
    }

    // ===== WOOD WALL =====
    case T.WOOD_WALL: {
      c.fillStyle = '#5a3818';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, [
        '#503010','#5a3818','#644020','#4a2808','#5e3c1c','#543418'
      ], 0.65, rng);
      // Top highlight
      fillNoise(c, 0, 0, s, Math.floor(s*0.1), ['#6a4828','#7a5838','#725030'], 0.5, rng);
      // Horizontal plank lines
      c.fillStyle = '#3a2008';
      c.fillRect(0, Math.floor(s*0.32), s, 2);
      c.fillRect(0, Math.floor(s*0.64), s, 2);
      // Vertical board joints
      const boardOff = v % 2 === 0;
      c.fillRect(Math.floor(s*(boardOff?0.5:0.35)), 0, 1, Math.floor(s*0.32));
      c.fillRect(Math.floor(s*(boardOff?0.3:0.65)), Math.floor(s*0.33), 1, Math.floor(s*0.31));
      c.fillRect(Math.floor(s*(boardOff?0.7:0.45)), Math.floor(s*0.65), 1, Math.floor(s*0.35));
      // Dark bottom edge (3D)
      fillNoise(c, 0, s-3, s, 3, ['#2a1808','#341e0a'], 0.5, rng);
      c.fillStyle = '#2a1808';
      c.fillRect(s-1, 0, 1, s);
      // Nails
      if (v%2===0) { c.fillStyle = '#888'; c.fillRect(Math.floor(s*0.4), Math.floor(s*0.45), 2, 2); }
      break;
    }

    // ===== SAND =====
    case T.SAND: {
      c.fillStyle = '#c8b078';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, [
        '#c0a870','#ccb480','#c4ac78','#d0b888','#bca468',
        '#c8b078','#d4bc90','#c0a870','#b89c60','#d0b480'
      ], 0.7, rng);
      // Lighter patches
      fillNoise(c, 0, 0, s, s, ['#dcc898','#e0cca0'], 0.06, rng);
      // Dark speckles
      fillNoise(c, 0, 0, s, s, ['#a89058','#9c8450'], 0.05, rng);
      // Shell detail
      if (v%4===0) {
        const shx = Math.floor(rng()*s*0.7)+Math.floor(s*0.1);
        const shy = Math.floor(rng()*s*0.7)+Math.floor(s*0.1);
        c.fillStyle = '#e8dcc0';
        c.fillRect(shx, shy, 3, 2);
        c.fillStyle = '#f0e8d4';
        c.fillRect(shx, shy, 3, 1);
      }
      break;
    }

    // ===== GRAVESTONE =====
    case T.GRAVESTONE: {
      // Dead ground
      c.fillStyle = '#5a4a35';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#504030','#5e4e3a','#544838','#625240'], 0.6, rng);
      // Shadow
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(Math.floor(s*0.18), Math.floor(s*0.78), Math.floor(s*0.64), Math.floor(s*0.1));
      // Stone body
      c.fillStyle = '#747474';
      c.fillRect(Math.floor(s*0.22), Math.floor(s*0.28), Math.floor(s*0.56), Math.floor(s*0.58));
      c.fillRect(Math.floor(s*0.28), Math.floor(s*0.18), Math.floor(s*0.44), Math.floor(s*0.12));
      c.fillRect(Math.floor(s*0.34), Math.floor(s*0.12), Math.floor(s*0.32), Math.floor(s*0.08));
      fillNoise(c, Math.floor(s*0.22), Math.floor(s*0.18), Math.floor(s*0.56), Math.floor(s*0.68), ['#6a6a6a','#808080','#747474','#787878','#6e6e6e'], 0.5, rng);
      // Highlight top
      fillNoise(c, Math.floor(s*0.24), Math.floor(s*0.18), Math.floor(s*0.52), Math.floor(s*0.06), ['#8a8a8a','#929292'], 0.4, rng);
      // Cross engraving
      c.fillStyle = '#909090';
      c.fillRect(Math.floor(s*0.46), Math.floor(s*0.2), Math.floor(s*0.08), Math.floor(s*0.3));
      c.fillRect(Math.floor(s*0.36), Math.floor(s*0.28), Math.floor(s*0.28), Math.floor(s*0.06));
      // Crack
      c.fillStyle = '#555';
      if (v%3===0) {
        const cy = Math.floor(s*0.5);
        for (let i = 0; i < Math.floor(s*0.15); i++) {
          c.fillRect(Math.floor(s*0.3)+Math.floor(rng()*3), cy+i, 1, 1);
        }
      }
      break;
    }

    // ===== DEAD TREE =====
    case T.DEAD_TREE: {
      c.fillStyle = '#5a4a35';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#504030','#5e4e3a','#544838'], 0.5, rng);
      // Shadow
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(Math.floor(s*0.12), Math.floor(s*0.8), Math.floor(s*0.76), Math.floor(s*0.1));
      // Trunk
      c.fillStyle = '#2e1a08';
      c.fillRect(Math.floor(s*0.38), Math.floor(s*0.35), Math.floor(s*0.24), Math.floor(s*0.56));
      fillNoise(c, Math.floor(s*0.38), Math.floor(s*0.35), Math.floor(s*0.24), Math.floor(s*0.56), ['#221408','#3a2510','#2e1a08','#362010'], 0.55, rng);
      // Bark highlight
      fillNoise(c, Math.floor(s*0.38), Math.floor(s*0.35), Math.floor(s*0.08), Math.floor(s*0.5), ['#4a3520','#3e2a18'], 0.2, rng);
      // Branches
      c.fillStyle = '#2e1a08';
      // Main left
      c.fillRect(Math.floor(s*0.15), Math.floor(s*0.22), Math.floor(s*0.25), 3);
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.1), Math.floor(s*0.1), 3);
      c.fillRect(Math.floor(s*0.15), Math.floor(s*0.12), 3, Math.floor(s*0.12));
      // Main right
      c.fillRect(Math.floor(s*0.6), Math.floor(s*0.18), Math.floor(s*0.28), 3);
      c.fillRect(Math.floor(s*0.82), Math.floor(s*0.08), Math.floor(s*0.1), 3);
      c.fillRect(Math.floor(s*0.82), Math.floor(s*0.08), 3, Math.floor(s*0.14));
      // Upper
      c.fillRect(Math.floor(s*0.45), Math.floor(s*0.06), 3, Math.floor(s*0.3));
      c.fillRect(Math.floor(s*0.3), Math.floor(s*0.04), Math.floor(s*0.18), 3);
      // Small twigs
      c.fillRect(Math.floor(s*0.2), Math.floor(s*0.03), Math.floor(s*0.08), 2);
      c.fillRect(Math.floor(s*0.75), Math.floor(s*0.04), Math.floor(s*0.08), 2);
      break;
    }

    // ===== BONE =====
    case T.BONE: {
      c.fillStyle = '#7a6040';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#6a5030','#7a6040','#8a7050','#705838'], 0.6, rng);
      // Bone shape
      c.save();
      c.translate(s/2, s/2);
      c.rotate((v * 0.8) % (Math.PI * 2));
      c.fillStyle = '#e0d8c0';
      c.fillRect(-Math.floor(s*0.28), -Math.floor(s*0.03), Math.floor(s*0.56), Math.floor(s*0.06));
      fillNoise(c, -Math.floor(s*0.28), -Math.floor(s*0.03), Math.floor(s*0.56), Math.floor(s*0.06), ['#d8d0b8','#e8e0c8','#dcd4bc'], 0.35, rng);
      // Bone ends
      c.fillRect(-Math.floor(s*0.3), -Math.floor(s*0.06), Math.floor(s*0.06), Math.floor(s*0.12));
      c.fillRect(Math.floor(s*0.24), -Math.floor(s*0.06), Math.floor(s*0.06), Math.floor(s*0.12));
      c.restore();
      break;
    }

    // ===== MUD =====
    case T.MUD: {
      c.fillStyle = '#504020';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, [
        '#453518','#504020','#5a4a28','#483a1c','#544424',
        '#3e3014','#4c3e20','#463818'
      ], 0.7, rng);
      // Wet puddles
      for (let i = 0; i < 2+Math.floor(rng()*2); i++) {
        const px = Math.floor(rng()*s*0.6)+Math.floor(s*0.1);
        const py = Math.floor(rng()*s*0.6)+Math.floor(s*0.1);
        const pw = Math.floor(rng()*s*0.25)+Math.floor(s*0.1);
        const ph = Math.floor(rng()*s*0.15)+Math.floor(s*0.05);
        c.fillStyle = '#3a2c10';
        c.fillRect(px, py, pw, ph);
        fillNoise(c, px, py, pw, ph, ['#342808','#3e3010','#302408'], 0.35, rng);
        // Slight reflection
        c.fillStyle = 'rgba(255,255,255,0.04)';
        c.fillRect(px+1, py, Math.floor(pw*0.4), 1);
      }
      break;
    }

    // ===== HAY =====
    case T.HAY: {
      c.fillStyle = '#5a4020';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#504018','#5a4020','#644828'], 0.4, rng);
      // Shadow
      c.fillStyle = 'rgba(0,0,0,0.15)';
      c.fillRect(Math.floor(s*0.1), Math.floor(s*0.78), Math.floor(s*0.8), Math.floor(s*0.12));
      // Hay bale body
      c.fillStyle = '#b89030';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.16), Math.floor(s*0.84), Math.floor(s*0.68));
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.16), Math.floor(s*0.84), Math.floor(s*0.68), [
        '#a88028','#b89030','#c49838','#aa8228','#c09030','#a07820'
      ], 0.6, rng);
      // Top highlight
      fillNoise(c, Math.floor(s*0.08), Math.floor(s*0.16), Math.floor(s*0.84), Math.floor(s*0.08), ['#d0a848','#c8a040','#d8b050'], 0.5, rng);
      // Straw lines
      c.fillStyle = '#907020';
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.36), Math.floor(s*0.84), 1);
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.54), Math.floor(s*0.84), 1);
      c.fillRect(Math.floor(s*0.08), Math.floor(s*0.72), Math.floor(s*0.84), 1);
      // Rope
      c.fillStyle = '#5a3810';
      c.fillRect(Math.floor(s*0.48), Math.floor(s*0.16), Math.floor(s*0.06), Math.floor(s*0.68));
      fillNoise(c, Math.floor(s*0.48), Math.floor(s*0.16), Math.floor(s*0.06), Math.floor(s*0.68), ['#4a2808','#6a4818'], 0.3, rng);
      // Loose straw
      c.fillStyle = '#c8a040';
      c.fillRect(Math.floor(s*0.05), Math.floor(s*0.82), Math.floor(s*0.08), 2);
      c.fillRect(Math.floor(s*0.88), Math.floor(s*0.85), Math.floor(s*0.08), 2);
      break;
    }

    // ===== ROOF STONE =====
    case T.ROOF_STONE: {
      c.fillStyle = '#585858';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#505050','#606060','#585858','#545454','#5c5c5c'], 0.6, rng);
      // Tile rows
      c.fillStyle = '#484848';
      for (let i = 0; i < 4; i++) c.fillRect(0, Math.floor(i*s*0.25), s, 1);
      // Offset columns
      for (let row = 0; row < 4; row++) {
        const off = row % 2 === 0 ? 0 : Math.floor(s*0.25);
        for (let col = off; col < s; col += Math.floor(s*0.5)) {
          c.fillRect(col, Math.floor(row*s*0.25), 1, Math.floor(s*0.25));
        }
      }
      fillNoise(c, 0, 0, s, Math.floor(s*0.08), ['#6a6a6a','#707070'], 0.3, rng);
      break;
    }

    // ===== ROOF WOOD =====
    case T.ROOF_WOOD: {
      c.fillStyle = '#6a3818';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#5a2808','#6a3818','#7a4828','#603010','#724020'], 0.6, rng);
      // Plank rows
      c.fillStyle = '#4a2008';
      for (let i = 0; i < 4; i++) c.fillRect(0, Math.floor(i*s*0.25), s, 1);
      // Offset columns
      for (let row = 0; row < 4; row++) {
        const off = row % 2 === 0 ? 0 : Math.floor(s*0.25);
        for (let col = off; col < s; col += Math.floor(s*0.5)) {
          c.fillRect(col, Math.floor(row*s*0.25), 1, Math.floor(s*0.25));
        }
      }
      fillNoise(c, 0, 0, s, Math.floor(s*0.08), ['#7a4828','#8a5838'], 0.3, rng);
      break;
    }

    // ===== DEFAULT =====
    default: {
      c.fillStyle = '#3a7a2d';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#347228','#3e8232','#2e6a22'], 0.4, rng);
      break;
    }
  }
}

// ============= LOGIN/REGISTER =============
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const loginError = document.getElementById('login-error');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');

document.getElementById('btn-login').addEventListener('click', () => {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) { loginError.textContent = 'Preencha todos os campos.'; return; }
  loginError.textContent = 'Conectando...';
  socket.emit('login', { username, password }, (res) => {
    if (res.error) { loginError.textContent = res.error; }
    else { lastLoginCredentials = { username, password }; startGame(); }
  });
});

document.getElementById('btn-register').addEventListener('click', () => {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) { loginError.textContent = 'Preencha todos os campos.'; return; }
  loginError.textContent = 'Criando conta...';
  socket.emit('register', { username, password }, (res) => {
    if (res.error) { loginError.textContent = res.error; }
    else {
      loginError.style.color = '#44cc44';
      loginError.textContent = 'Conta criada! Entrando...';
      socket.emit('login', { username, password }, (res2) => {
        if (res2.error) { loginError.style.color = '#ff4444'; loginError.textContent = res2.error; }
        else { lastLoginCredentials = { username, password }; startGame(); }
      });
    }
  });
});

// Enter key to login
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-login').click();
});
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') passwordInput.focus();
});

function startGame() {
  loginScreen.style.display = 'none';
  gameScreen.style.display = 'flex';
  resizeCanvas();
  requestAnimationFrame(gameLoop);
}

// ============= SOCKET EVENTS =============
socket.on('mapData', (data) => {
  gameMap = data.map;
  mapWidth = data.width;
  mapHeight = data.height;
  if (data.quadrant) currentQuadrant = data.quadrant;
  if (data.quadrantName) currentQuadrantName = data.quadrantName;
  if (data.neighbors) quadrantNeighbors = data.neighbors;
  transitioning = false;
});

socket.on('npcData', (data) => { npcs = data; });

socket.on('charData', (data) => {
  myChar = myChar || {};
  Object.assign(myChar, data);
  if (data.quadrant) currentQuadrant = data.quadrant;
  updateStatusUI();
});

socket.on('gameState', (data) => {
  otherPlayers = data.players;
  nearbyEnemies = data.enemies;
  groundItems = data.groundItems || [];
  npcQuestStatus = data.npcQuestStatus || {};
});

socket.on('chat', (data) => {
  chatLog.push(data);
  if (chatLog.length > 100) chatLog.shift();
  updateChatUI();
});

socket.on('damageDealt', (data) => {
  const enemy = nearbyEnemies.find(e => e.id === data.targetId);
  if (enemy) {
    showDamage(enemy.x, enemy.y, data.damage, '#ff4444');
  }
  if (data.remainingHp <= 0) { targetEnemy = null; }
});

socket.on('damageTaken', (data) => {
  if (myChar) {
    myChar.hp = data.hp;
    showDamage(myChar.x, myChar.y, data.damage, '#ff0000');
    updateStatusUI();
  }
});

socket.on('hpUpdate', (data) => {
  if (myChar) { myChar.hp = data.hp; myChar.max_hp = data.max_hp; updateStatusUI(); }
});

socket.on('xpUpdate', (data) => {
  if (myChar) { myChar.xp = data.xp; myChar.xpNeeded = data.xpNeeded; updateStatusUI(); }
});

socket.on('levelUp', (data) => {
  if (myChar) {
    myChar.level = data.level;
    myChar.hp = data.hp;
    myChar.max_hp = data.max_hp;
    myChar.skill_points = data.skill_points;
    updateStatusUI();
    updateSkillsUI();
  }
});

socket.on('loot', (data) => {
  if (myChar) { myChar.silver = data.silver; updateStatusUI(); }
  // Floating drop text
  if (data.x !== undefined && data.y !== undefined) {
    let offsetY = 0;
    if (data.loot && data.loot.length > 0) {
      for (const l of data.loot) {
        showDropText(data.x, data.y, l, '#aaaaaa', offsetY);
        offsetY += 18;
      }
    }
    if (data.xpGain) showDropText(data.x, data.y, '+' + data.xpGain + ' XP', '#4488ff', offsetY);
  }
});

socket.on('inventoryUpdate', (data) => {
  myInventory = data;
  // Registrar nomes de itens para uso nos slots de equipamento
  for (const item of data) {
    if (item.item_id && item.name) {
      ITEMS_CLIENT[item.item_id] = { name: item.name, icon: item.icon || null };
    }
  }
  updateInventoryUI();
});

socket.on('questsUpdate', (data) => {
  myQuests = data;
  updateQuestTrackerUI();
});

socket.on('npcDialog', (data) => {
  showNpcDialog(data);
});

socket.on('death', (data) => {
  if (myChar) {
    myChar.silver = data.silver;
    myChar.x = 40; myChar.y = 30;
    transitioning = false;
    document.getElementById('death-screen').style.display = 'flex';
  }
});

document.getElementById('btn-respawn').addEventListener('click', () => {
  document.getElementById('death-screen').style.display = 'none';
});

// ============= INPUT =============
document.addEventListener('keydown', (e) => {
  if (document.activeElement === document.getElementById('chat-input')) return;
  switch(e.key) {
    case 'ArrowUp': case 'w': case 'W': keys.up = true; break;
    case 'ArrowDown': case 's': case 'S': keys.down = true; break;
    case 'ArrowLeft': case 'a': case 'A': keys.left = true; break;
    case 'ArrowRight': case 'd': case 'D': keys.right = true; break;
    case 'Enter':
      e.preventDefault();
      document.getElementById('chat-input').focus();
      break;
    case 'e': case 'E':
      interactNearestNPC();
      break;
    case 'f': case 'F':
      pickupNearestGroundItem();
      break;
    case 'Escape':
      if (currentDialog) closeDialog();
      targetEnemy = null;
      break;
  }
});

document.addEventListener('keyup', (e) => {
  switch(e.key) {
    case 'ArrowUp': case 'w': case 'W': keys.up = false; break;
    case 'ArrowDown': case 's': case 'S': keys.down = false; break;
    case 'ArrowLeft': case 'a': case 'A': keys.left = false; break;
    case 'ArrowRight': case 'd': case 'D': keys.right = false; break;
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.deltaY < 0) {
    TILE_SIZE = Math.min(TILE_SIZE_MAX, TILE_SIZE + 4);
  } else {
    TILE_SIZE = Math.max(TILE_SIZE_MIN, TILE_SIZE - 4);
  }
  // Debounce: rebuild cache only after user stops zooming (200ms)
  // Old cache tiles are scaled via drawImage in the meantime (zero lag)
  if (zoomDebounceTimer) clearTimeout(zoomDebounceTimer);
  zoomDebounceTimer = setTimeout(() => {
    rebuildTileCacheProgressive();
    zoomDebounceTimer = null;
  }, 200);
}, { passive: false });

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  mouseX = (e.clientX - rect.left) * scaleX;
  mouseY = (e.clientY - rect.top) * scaleY;
  mouseWorldX = (mouseX + cameraX) / TILE_SIZE;
  mouseWorldY = (mouseY + cameraY) / TILE_SIZE;
});

canvas.addEventListener('click', (e) => {
  if (!myChar || !gameMap) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top) * scaleY;
  const wx = (cx + cameraX) / TILE_SIZE;
  const wy = (cy + cameraY) / TILE_SIZE;

  // Check if clicked on enemy â€” target and attack immediately
  let clickedEnemy = null;
  let closestDist = 1.5; // click tolerance in tiles
  for (const enemy of nearbyEnemies) {
    const d = Math.sqrt((wx - enemy.x)**2 + (wy - enemy.y)**2);
    if (d < closestDist) { closestDist = d; clickedEnemy = enemy; }
  }
  if (clickedEnemy) {
    targetEnemy = clickedEnemy;
    // Attack immediately on click
    const now = Date.now();
    const dist = Math.sqrt((myChar.x - clickedEnemy.x)**2 + (myChar.y - clickedEnemy.y)**2);
    if (dist < 2 && now - lastAttackTime > 1000) {
      lastAttackTime = now;
      socket.emit('attack', { targetId: clickedEnemy.id });
    }
    return;
  }

  // Check if clicked on ground item â€” pick up
  let clickedItem = null;
  let closestItemDist = 1.5;
  for (const gi of groundItems) {
    const d = Math.sqrt((wx - gi.x)**2 + (wy - gi.y)**2);
    if (d < closestItemDist) { closestItemDist = d; clickedItem = gi; }
  }
  if (clickedItem) {
    const dist = Math.sqrt((myChar.x - clickedItem.x)**2 + (myChar.y - clickedItem.y)**2);
    if (dist < 2) {
      socket.emit('pickupItem', { gid: clickedItem.gid });
    }
    return;
  }

  targetEnemy = null;
});

// Chat
const chatInput = document.getElementById('chat-input');
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const msg = chatInput.value.trim();
    if (msg) {
      socket.emit('chat', { message: msg });
      myChatBubble = { message: msg, time: Date.now() };
    }
    chatInput.value = '';
    chatInput.blur();
    e.preventDefault();
  }
  if (e.key === 'Escape') {
    chatInput.blur();
    e.preventDefault();
  }
  e.stopPropagation();
});
chatInput.addEventListener('keyup', (e) => e.stopPropagation());

document.getElementById('btn-send-chat').addEventListener('click', () => {
  const msg = chatInput.value.trim();
  if (msg) {
    socket.emit('chat', { message: msg });
    myChatBubble = { message: msg, time: Date.now() };
  }
  chatInput.value = '';
});

// ============= TABS =============
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// Skill buttons
document.querySelectorAll('.btn-skill').forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('useSkillPoint', { skill: btn.dataset.skill });
  });
});

// Unequip buttons (delegated to equip-grid)
document.querySelector('.equip-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.equip-unequip-btn');
  if (btn) {
    e.stopPropagation();
    socket.emit('unequipItem', { slot: btn.dataset.slot });
  }
});

// ============= RESIZE =============
function resizeCanvas() {
  const area = document.getElementById('game-area');
  canvas.width = area.clientWidth;
  canvas.height = area.clientHeight;
}
window.addEventListener('resize', resizeCanvas);

// ============= COLLISION =============
function isBlocked(tx, ty) {
  if (tx < 0) return !(quadrantNeighbors && quadrantNeighbors.left);
  if (tx >= mapWidth) return !(quadrantNeighbors && quadrantNeighbors.right);
  if (ty < 0) return !(quadrantNeighbors && quadrantNeighbors.up);
  if (ty >= mapHeight) return !(quadrantNeighbors && quadrantNeighbors.down);
  return BLOCKED.has(gameMap[Math.floor(ty)][Math.floor(tx)]);
}

function canMoveTo(x, y) {
  const pad = 0.2;
  return !isBlocked(x - pad, y - pad) && !isBlocked(x + pad, y - pad)
    && !isBlocked(x - pad, y + pad) && !isBlocked(x + pad, y + pad);
}

// ============= GAME LOOP =============
function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);
  if (!gameMap || !myChar) return;

  const dt = timestamp - lastFrameTime;
  lastFrameTime = timestamp;

  update(dt);
  render();
}

function update(dt) {
  if (transitioning) return; // Wait for quadrant transition to complete

  // Movement
  let dx = 0, dy = 0;
  if (keys.up) dy -= 1;
  if (keys.down) dy += 1;
  if (keys.left) dx -= 1;
  if (keys.right) dx += 1;

  const moving = dx !== 0 || dy !== 0;

  if (moving) {
    // Normalize diagonal
    const len = Math.sqrt(dx*dx + dy*dy);
    dx = (dx / len) * MOVE_SPEED;
    dy = (dy / len) * MOVE_SPEED;

    // Set sprite direction
    if (keys.left) myChar.direction = 'left';
    else if (keys.right) myChar.direction = 'right';
    else if (keys.up) myChar.direction = 'up';
    else if (keys.down) myChar.direction = 'down';

    // Try move X
    let nx = myChar.x + dx;
    let ny = myChar.y + dy;
    if (canMoveTo(nx, myChar.y)) myChar.x = nx;
    if (canMoveTo(myChar.x, ny)) myChar.y = ny;

    // Quadrant transition detection
    if (myChar.x < 0.3 && quadrantNeighbors && quadrantNeighbors.left) {
      transitioning = true;
      socket.emit('changeQuadrant', { direction: 'left' });
      return;
    }
    if (myChar.x > mapWidth - 0.3 && quadrantNeighbors && quadrantNeighbors.right) {
      transitioning = true;
      socket.emit('changeQuadrant', { direction: 'right' });
      return;
    }
    if (myChar.y < 0.3 && quadrantNeighbors && quadrantNeighbors.up) {
      transitioning = true;
      socket.emit('changeQuadrant', { direction: 'up' });
      return;
    }
    if (myChar.y > mapHeight - 0.3 && quadrantNeighbors && quadrantNeighbors.down) {
      transitioning = true;
      socket.emit('changeQuadrant', { direction: 'down' });
      return;
    }

    // Send to server
    socket.emit('move', { x: myChar.x, y: myChar.y, direction: myChar.direction, moving: true });
  } else {
    socket.emit('move', { x: myChar.x, y: myChar.y, direction: myChar.direction, moving: false });
  }

  // Walking animation
  if (moving) {
    animTimer += dt;
    if (animTimer > 200) { animTimer = 0; animFrame = (animFrame + 1) % 2; }
  } else {
    animFrame = 0; animTimer = 0;
  }

  // Enemy animation (faster cycle)
  enemyAnimTimer += dt;
  if (enemyAnimTimer > 150) { enemyAnimTimer = 0; enemyAnimFrame = (enemyAnimFrame + 1) % 2; }

  // Water animation
  waterTimer += dt;
  if (waterTimer > 500) { waterTimer = 0; waterAnimFrame = (waterAnimFrame + 1) % 3; }

  // Auto-attack target
  if (targetEnemy && myChar.hp > 0) {
    const enemy = nearbyEnemies.find(e => e.id === targetEnemy.id);
    if (enemy) {
      targetEnemy = enemy; // update position
      const dist = Math.sqrt((myChar.x - enemy.x)**2 + (myChar.y - enemy.y)**2);
      if (dist < 2) {
        const now = Date.now();
        if (now - lastAttackTime > 1000) {
          lastAttackTime = now;
          socket.emit('attack', { targetId: enemy.id });
        }
      }
    } else {
      targetEnemy = null;
    }
  }

  // Camera
  cameraX = myChar.x * TILE_SIZE - canvas.width / 2;
  cameraY = myChar.y * TILE_SIZE - canvas.height / 2;
  cameraX = Math.max(0, Math.min(cameraX, mapWidth * TILE_SIZE - canvas.width));
  cameraY = Math.max(0, Math.min(cameraY, mapHeight * TILE_SIZE - canvas.height));
}

// ============= RENDERING =============
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!gameMap) return;

  // Determine visible tile range
  const startTX = Math.max(0, Math.floor(cameraX / TILE_SIZE));
  const startTY = Math.max(0, Math.floor(cameraY / TILE_SIZE));
  const endTX = Math.min(mapWidth, Math.ceil((cameraX + canvas.width) / TILE_SIZE) + 1);
  const endTY = Math.min(mapHeight, Math.ceil((cameraY + canvas.height) / TILE_SIZE) + 1);

  // Draw tiles
  for (let ty = startTY; ty < endTY; ty++) {
    for (let tx = startTX; tx < endTX; tx++) {
      const sx = tx * TILE_SIZE - cameraX;
      const sy = ty * TILE_SIZE - cameraY;
      drawTile(tx, ty, sx, sy);
    }
  }

  // Collect all entities and sort by Y for proper layering
  const entities = [];

  // NPCs
  for (const npc of npcs) {
    entities.push({ type: 'npc', data: npc, y: npc.y });
  }

  // Enemies
  for (const enemy of nearbyEnemies) {
    entities.push({ type: 'enemy', data: enemy, y: enemy.y });
  }

  // Other players
  for (const [id, op] of Object.entries(otherPlayers)) {
    entities.push({ type: 'otherPlayer', data: op, y: op.y });
  }

  // Ground items
  for (const gi of groundItems) {
    entities.push({ type: 'groundItem', data: gi, y: gi.y + 0.5 });
  }

  // My player
  if (myChar) {
    entities.push({ type: 'myPlayer', data: myChar, y: myChar.y });
  }

  // Sort by Y
  entities.sort((a, b) => a.y - b.y);

  // Draw entities
  for (const ent of entities) {
    switch (ent.type) {
      case 'npc': drawNPC(ent.data); break;
      case 'enemy': drawEnemy(ent.data); break;
      case 'otherPlayer': drawOtherPlayer(ent.data); break;
      case 'myPlayer': drawMyPlayer(ent.data); break;
      case 'groundItem': drawGroundItem(ent.data); break;
    }
  }

  // Target indicator
  if (targetEnemy) {
    const sx = targetEnemy.x * TILE_SIZE - cameraX;
    const sy = targetEnemy.y * TILE_SIZE - cameraY;
    const half = TILE_SIZE / 2;
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - half, sy - half, TILE_SIZE, TILE_SIZE);
  }

  // Minimap
  drawMinimap();
}

// ============= TILE DRAWING (TIBIA STYLE) =============
function drawTile(tx, ty, sx, sy) {
  if (tileCacheSize === 0) initTileCache(); // only first load
  const tile = gameMap[ty][tx];
  const v = (tx * 7 + ty * 13) % TILE_VARIANTS;

  if (tile === T.WATER) {
    const key = 'water_' + waterAnimFrame + '_' + v;
    const cached = tileCanvasCache[key];
    if (cached) {
      ctx.drawImage(cached, 0, 0, cached.width, cached.height, sx, sy, TILE_SIZE, TILE_SIZE);
      return;
    }
  }

  const key = tile + '_' + v;
  const cached = tileCanvasCache[key];
  if (cached) {
    ctx.drawImage(cached, 0, 0, cached.width, cached.height, sx, sy, TILE_SIZE, TILE_SIZE);
    return;
  }

  // Fallback
  ctx.fillStyle = '#3a7a2d';
  ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
}

// ============= ENTITY DRAWING =============
function drawMyPlayer(char) {
  const sx = char.x * TILE_SIZE - cameraX;
  const sy = char.y * TILE_SIZE - cameraY;
  const S = TILE_SIZE * 1.3; // sprite um pouco maior
  const half = S / 2;

  let spriteName;
  const moving = keys.up || keys.down || keys.left || keys.right;  if (char.isAdmin) {
    const spr = sprites['admin'];
    if (spr && spr.complete && spr.naturalWidth > 0) {
      const aS = S * 1.1;
      const aHalf = aS / 2;
      // Admin sprite faces left by default; flip for right/up
      const shouldFlip = (char.direction === 'right' || char.direction === 'up');
      if (!shouldFlip) {
        ctx.drawImage(spr, sx - aHalf, sy - aS * 0.75, aS, aS);
      } else {
        ctx.save();
        ctx.translate(sx, sy - aS * 0.75);
        ctx.scale(-1, 1);
        ctx.drawImage(spr, -aHalf, 0, aS, aS);
        ctx.restore();
      }
    }
  } else {
    // Player sprites: parado (idle), alternate parado/andando (walking)
    // Sprites face LEFT by default. Flip for RIGHT and UP directions.
    spriteName = (moving && animFrame === 1) ? 'andando' : 'parado';
    const shouldFlip = (char.direction === 'right' || char.direction === 'up');

    const spr = sprites[spriteName];
    if (spr && spr.complete && spr.naturalWidth > 0) {
      if (!shouldFlip) {
        ctx.drawImage(spr, sx - half, sy - S * 0.75, S, S);
      } else {
        ctx.save();
        ctx.translate(sx, sy - S * 0.75);
        ctx.scale(-1, 1);
        ctx.drawImage(spr, -half, 0, S, S);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = '#4488ff';
      ctx.fillRect(sx - half * 0.5, sy - half, half, S * 0.75);
      ctx.fillStyle = '#ffcc88';
      ctx.beginPath();
      ctx.arc(sx, sy - S * 0.56, S * 0.19, 0, Math.PI * 2);
      ctx.fill();
    }

    // Weapon overlay sprite
    if (char.equipped_weapon && WEAPON_SPRITES[char.equipped_weapon]) {
      const ws = WEAPON_SPRITES[char.equipped_weapon];
      const wSpriteName = (moving && animFrame === 1) ? ws[1] : ws[0];
      const wSpr = sprites[wSpriteName];
      if (wSpr && wSpr.complete && wSpr.naturalWidth > 0) {
        if (!shouldFlip) {
          ctx.drawImage(wSpr, sx - half, sy - S * 0.75, S, S);
        } else {
          ctx.save();
          ctx.translate(sx, sy - S * 0.75);
          ctx.scale(-1, 1);
          ctx.drawImage(wSpr, -half, 0, S, S);
          ctx.restore();
        }
      }
    }

    // Chest armor overlay sprite
    if (char.equipped_chest && CHEST_SPRITES[char.equipped_chest]) {
      const cs = CHEST_SPRITES[char.equipped_chest];
      const cSpriteName = (moving && animFrame === 1) ? cs[1] : cs[0];
      const cSpr = sprites[cSpriteName];
      if (cSpr && cSpr.complete && cSpr.naturalWidth > 0) {
        if (!shouldFlip) {
          ctx.drawImage(cSpr, sx - half, sy - S * 0.75, S, S);
        } else {
          ctx.save();
          ctx.translate(sx, sy - S * 0.75);
          ctx.scale(-1, 1);
          ctx.drawImage(cSpr, -half, 0, S, S);
          ctx.restore();
        }
      }
    }
  }

  // Name (on top)
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(char.username || 'Jogador', sx, sy - S * 1.2);

  // HP bar below name
  drawHPBar(sx, sy - S * 1.05, char.hp, char.max_hp, '#44cc44');

  // BalÃ£o de fala do prÃ³prio jogador
  if (myChatBubble && (Date.now() - myChatBubble.time < 5000)) {
    drawChatBubble(sx, sy - S * 1.4, myChatBubble.message);
  }
}

function drawChatBubble(screenX, screenY, message) {
  ctx.save();
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'center';

  // Limitar a mensagem a ~30 caracteres por linha
  const maxChars = 30;
  const lines = [];
  for (let i = 0; i < message.length; i += maxChars) {
    lines.push(message.substring(i, i + maxChars));
  }
  if (lines.length > 3) lines.length = 3; // max 3 linhas

  const lineHeight = 13;
  const paddingX = 8;
  const paddingY = 5;
  const maxWidth = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
  const boxWidth = maxWidth + paddingX * 2;
  const boxHeight = lines.length * lineHeight + paddingY * 2;
  const boxX = screenX - boxWidth / 2;
  const boxY = screenY - boxHeight;

  // Sombra
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;

  // Fundo do balÃ£o
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.beginPath();
  const r = 6;
  ctx.moveTo(boxX + r, boxY);
  ctx.lineTo(boxX + boxWidth - r, boxY);
  ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + r);
  ctx.lineTo(boxX + boxWidth, boxY + boxHeight - r);
  ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - r, boxY + boxHeight);
  ctx.lineTo(boxX + r, boxY + boxHeight);
  ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - r);
  ctx.lineTo(boxX, boxY + r);
  ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
  ctx.closePath();
  ctx.fill();

  // TriÃ¢ngulo (pontinha do balÃ£o)
  ctx.beginPath();
  ctx.moveTo(screenX - 4, boxY + boxHeight);
  ctx.lineTo(screenX + 4, boxY + boxHeight);
  ctx.lineTo(screenX, boxY + boxHeight + 5);
  ctx.closePath();
  ctx.fill();

  // Reset sombra
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Texto
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], screenX, boxY + paddingY + lineHeight * (i + 1) - 2);
  }

  ctx.restore();
}

function drawOtherPlayer(op) {
  const sx = op.x * TILE_SIZE - cameraX;
  const sy = op.y * TILE_SIZE - cameraY;
  const S = TILE_SIZE * 1.3; // sprite um pouco maior
  const half = S / 2;

  let spriteName;

  // Admin usa skin exclusiva
  if (op.isAdmin) {
    const spr = sprites['admin'];
    if (spr && spr.complete && spr.naturalWidth > 0) {
      const aS = S * 1.1;
      const aHalf = aS / 2;
      const shouldFlip = (op.direction === 'right' || op.direction === 'up');
      if (!shouldFlip) {
        ctx.drawImage(spr, sx - aHalf, sy - aS * 0.75, aS, aS);
      } else {
        ctx.save();
        ctx.translate(sx, sy - aS * 0.75);
        ctx.scale(-1, 1);
        ctx.drawImage(spr, -aHalf, 0, aS, aS);
        ctx.restore();
      }
    }
  } else {
    // Player sprites: parado (idle), alternate parado/andando (walking)
    // Sprites face LEFT by default. Flip for RIGHT and UP directions.
    spriteName = (op.moving && animFrame === 1) ? 'andando' : 'parado';
    const shouldFlip = (op.direction === 'right' || op.direction === 'up');

    const spr = sprites[spriteName];
    if (spr && spr.complete && spr.naturalWidth > 0) {
      if (!shouldFlip) {
        ctx.drawImage(spr, sx - half, sy - S * 0.75, S, S);
      } else {
        ctx.save();
        ctx.translate(sx, sy - S * 0.75);
        ctx.scale(-1, 1);
        ctx.drawImage(spr, -half, 0, S, S);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = '#44cc44';
      ctx.fillRect(sx - half * 0.5, sy - half, half, S * 0.75);
      ctx.fillStyle = '#ffcc88';
      ctx.beginPath(); ctx.arc(sx, sy - S * 0.56, S * 0.19, 0, Math.PI * 2); ctx.fill();
    }

    // Weapon overlay sprite (other player)
    if (op.equipped_weapon && WEAPON_SPRITES[op.equipped_weapon]) {
      const ws = WEAPON_SPRITES[op.equipped_weapon];
      const wSpriteName = (op.moving && animFrame === 1) ? ws[1] : ws[0];
      const wSpr = sprites[wSpriteName];
      if (wSpr && wSpr.complete && wSpr.naturalWidth > 0) {
        if (!shouldFlip) {
          ctx.drawImage(wSpr, sx - half, sy - S * 0.75, S, S);
        } else {
          ctx.save();
          ctx.translate(sx, sy - S * 0.75);
          ctx.scale(-1, 1);
          ctx.drawImage(wSpr, -half, 0, S, S);
          ctx.restore();
        }
      }
    }

    // Chest armor overlay sprite (other player)
    if (op.equipped_chest && CHEST_SPRITES[op.equipped_chest]) {
      const cs = CHEST_SPRITES[op.equipped_chest];
      const cSpriteName = (op.moving && animFrame === 1) ? cs[1] : cs[0];
      const cSpr = sprites[cSpriteName];
      if (cSpr && cSpr.complete && cSpr.naturalWidth > 0) {
        if (!shouldFlip) {
          ctx.drawImage(cSpr, sx - half, sy - S * 0.75, S, S);
        } else {
          ctx.save();
          ctx.translate(sx, sy - S * 0.75);
          ctx.scale(-1, 1);
          ctx.drawImage(cSpr, -half, 0, S, S);
          ctx.restore();
        }
      }
    }
  }

  ctx.fillStyle = '#aaffaa';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(op.username, sx, sy - S * 1.2);
  drawHPBar(sx, sy - S * 1.05, op.hp, op.max_hp, '#44cc44');

  // BalÃ£o de fala de outro jogador
  if (op.chatBubble) {
    drawChatBubble(sx, sy - S * 1.4, op.chatBubble);
  }
}

function drawEnemy(enemy) {
  const sx = enemy.x * TILE_SIZE - cameraX;
  const sy = enemy.y * TILE_SIZE - cameraY;
  const S = TILE_SIZE * 1.3; // mesmo tamanho dos players
  const half = S / 2;

  if (enemy.type === 'skeleton') {
    // Esqueleto: sprites esqueletoparado/esqueletoandando, originalmente virado pra DIREITA
    // Normal p/ direita e cima, flip p/ esquerda e baixo
    const spriteName = (enemy.moving && enemyAnimFrame === 1) ? 'esqueletoandando' : 'esqueletoparado';
    const shouldFlip = (enemy.direction === 'left' || enemy.direction === 'down');
    const spr = sprites[spriteName];
    if (spr && spr.complete && spr.naturalWidth > 0) {
      if (!shouldFlip) {
        ctx.drawImage(spr, sx - half, sy - S * 0.75, S, S);
      } else {
        ctx.save();
        ctx.translate(sx, sy - S * 0.75);
        ctx.scale(-1, 1);
        ctx.drawImage(spr, -half, 0, S, S);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = '#cccccc';
      ctx.fillRect(sx - S * 0.19, sy - S * 0.56, S * 0.38, S * 0.69);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(sx, sy - S * 0.63, S * 0.19, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.fillRect(sx - S * 0.09, sy - S * 0.69, S * 0.06, S * 0.06);
      ctx.fillRect(sx + S * 0.03, sy - S * 0.69, S * 0.06, S * 0.06);
    }
  } else if (enemy.type === 'cow') {
    // Vaca: sprites vacaparada/vacaandando/vacacomendo, originalmente virada pra DIREITA
    // Normal p/ direita e cima, flip p/ esquerda e baixo
    let spriteName;
    const animState = enemy.animState || 'idle';
    if (enemy.moving || animState === 'walking') {
      // Andando: alterna entre vacaandando e vacaparada
      spriteName = (enemyAnimFrame === 1) ? 'vacaandando' : 'vacaparada';
    } else if (animState === 'eating') {
      // Comendo: mostra sprite vacacomendo
      spriteName = 'vacacomendo';
    } else {
      // Parada/idle: mostra sprite vacaparada
      spriteName = 'vacaparada';
    }
    const shouldFlip = (enemy.direction === 'left' || enemy.direction === 'down');
    const spr = sprites[spriteName];
    if (spr && spr.complete && spr.naturalWidth > 0) {
      if (!shouldFlip) {
        ctx.drawImage(spr, sx - half, sy - S * 0.75, S, S);
      } else {
        ctx.save();
        ctx.translate(sx, sy - S * 0.75);
        ctx.scale(-1, 1);
        ctx.drawImage(spr, -half, 0, S, S);
        ctx.restore();
      }
    } else {
      // Fallback: simple brown rect
      ctx.fillStyle = '#8B6914';
      ctx.fillRect(sx - half * 0.6, sy - S * 0.5, S * 0.6, S * 0.4);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(sx - S * 0.1, sy - S * 0.5, S * 0.12, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    // Slime: sprite unico "slime", originalmente virado pra DIREITA
    const spr = sprites['slime'];
    const shouldFlip = (enemy.direction === 'left' || enemy.direction === 'down');
    if (spr && spr.complete && spr.naturalWidth > 0) {
      if (!shouldFlip) {
        ctx.drawImage(spr, sx - half, sy - S * 0.75, S, S);
      } else {
        ctx.save();
        ctx.translate(sx, sy - S * 0.75);
        ctx.scale(-1, 1);
        ctx.drawImage(spr, -half, 0, S, S);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = '#44dd44';
      ctx.beginPath(); ctx.ellipse(sx, sy - S * 0.19, S * 0.31, S * 0.25, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.fillRect(sx - S * 0.13, sy - S * 0.31, S * 0.09, S * 0.09);
      ctx.fillRect(sx + S * 0.03, sy - S * 0.31, S * 0.09, S * 0.09);
    }
  }

  // Name (on top)
  const name = enemy.type === 'skeleton' ? 'Esqueleto' : (enemy.type === 'cow' ? 'Vaca' : 'Slime');
  ctx.fillStyle = enemy.type === 'cow' ? '#ddcc88' : '#ff8888';
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(name, sx, sy - S * 1.2);

  // HP bar below name
  drawHPBar(sx, sy - S * 1.05, enemy.hp, enemy.maxHp, '#ff4444');
}

function drawNPC(npc) {
  if (!myChar) return;
  const sx = npc.x * TILE_SIZE - cameraX;
  const sy = npc.y * TILE_SIZE - cameraY;
  const S = TILE_SIZE * 1.3; // mesmo tamanho base dos players
  const half = S / 2;

  // Escala maior para o paladino
  const scale = (npc.id === 'paladino') ? 1.4 : 1.0;
  const npcS = S * scale;
  const npcHalf = npcS / 2;

  // Determine if NPC should face left (player is to the left)
  const faceLeft = myChar.x < npc.x;

  const spr = sprites[npc.sprite];
  if (spr && spr.complete && spr.naturalWidth > 0) {
    if (faceLeft) {
      ctx.save();
      ctx.translate(sx, sy - npcS * 0.75);
      ctx.scale(-1, 1);
      ctx.drawImage(spr, -npcHalf, 0, npcS, npcS);
      ctx.restore();
    } else {
      ctx.drawImage(spr, sx - npcHalf, sy - npcS * 0.75, npcS, npcS);
    }
  } else {
    ctx.fillStyle = '#ddaa44';
    ctx.fillRect(sx - half * 0.5, sy - S * 0.56, half, S * 0.75);
    ctx.fillStyle = '#ffcc88';
    ctx.beginPath(); ctx.arc(sx, sy - S * 0.63, S * 0.19, 0, Math.PI * 2); ctx.fill();
  }

  // NPC name
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(npc.name, sx, sy - npcS * 0.95);

  // Quest indicator "!" above name
  const qStatus = npcQuestStatus[npc.id];
  if (qStatus === 'available') {
    // Yellow "!" pulsing
    const pulse = 0.85 + Math.sin(Date.now() / 300) * 0.15;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffdd00';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    const bobY = Math.sin(Date.now() / 500) * 3;
    ctx.fillText('!', sx, sy - npcS * 1.15 + bobY);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeText('!', sx, sy - npcS * 1.15 + bobY);
    ctx.fillText('!', sx, sy - npcS * 1.15 + bobY);
    ctx.restore();
  } else if (qStatus === 'complete') {
    // Yellow "?" when quest ready to turn in
    ctx.save();
    ctx.fillStyle = '#ffdd00';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeText('?', sx, sy - npcS * 1.15);
    ctx.fillText('?', sx, sy - npcS * 1.15);
    ctx.restore();
  } else if (qStatus === 'in_progress') {
    // Gray "?" for in-progress
    ctx.save();
    ctx.fillStyle = '#aaaaaa';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeText('?', sx, sy - npcS * 1.15);
    ctx.fillText('?', sx, sy - npcS * 1.15);
    ctx.restore();
  }

  // Interaction indicator (if close)
  const dist = Math.sqrt((myChar.x - npc.x)**2 + (myChar.y - npc.y)**2);
  if (dist < 3) {
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 12px Arial';
    ctx.fillText('[E] Interagir', sx, sy + S * 0.44);
  }
}

// Load ground item icon sprites (cached)
const groundIconCache = {};
function getGroundIcon(src) {
  if (!src) return null;
  if (groundIconCache[src]) return groundIconCache[src];
  const img = new Image();
  img.src = src;
  groundIconCache[src] = img;
  return img;
}

function drawGroundItem(gi) {
  const sx = gi.x * TILE_SIZE - cameraX;
  const sy = gi.y * TILE_SIZE - cameraY;
  const S = TILE_SIZE * 0.6;
  const half = S / 2;

  // Floating bob animation
  const bob = Math.sin(Date.now() / 400 + gi.gid) * 3;

  // Glow shadow
  ctx.save();
  ctx.globalAlpha = 0.3 + Math.sin(Date.now() / 600 + gi.gid) * 0.15;
  ctx.fillStyle = '#ffd700';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 4, half * 0.8, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Draw icon
  if (gi.icon) {
    const iconImg = getGroundIcon(gi.icon);
    if (iconImg && iconImg.complete && iconImg.naturalWidth > 0) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(iconImg, sx - half, sy - S + bob - 2, S, S);
      ctx.imageSmoothingEnabled = true;
    } else {
      ctx.fillStyle = '#d4a750';
      ctx.fillRect(sx - half * 0.5, sy - S * 0.7 + bob, half, half);
    }
  } else {
    ctx.fillStyle = '#d4a750';
    ctx.fillRect(sx - half * 0.5, sy - S * 0.7 + bob, half, half);
  }

  // Item name label
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 9px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(gi.name, sx, sy - S + bob - 6);
  if (gi.quantity > 1) {
    ctx.fillText('x' + gi.quantity, sx, sy - S + bob + S + 10);
  }

  // Pickup indicator if close
  if (myChar) {
    const dist = Math.sqrt((myChar.x - gi.x)**2 + (myChar.y - gi.y)**2);
    if (dist < 2) {
      ctx.fillStyle = '#44ff44';
      ctx.font = 'bold 10px Arial';
      ctx.fillText('[F] Pegar', sx, sy + 12);
    }
  }

  ctx.restore();
}

function drawHPBar(sx, sy, hp, maxHp, color) {
  const barW = 30, barH = 4;
  const pct = Math.max(0, hp / maxHp);
  ctx.fillStyle = '#000';
  ctx.fillRect(sx - barW/2 - 1, sy - 1, barW + 2, barH + 2);
  ctx.fillStyle = '#333';
  ctx.fillRect(sx - barW/2, sy, barW, barH);
  ctx.fillStyle = color;
  ctx.fillRect(sx - barW/2, sy, barW * pct, barH);
}

// ============= MINIMAP =============
function drawMinimap() {
  if (!gameMap) return;
  const mmW = 140, mmH = 100;
  const mmX = canvas.width - mmW - 10, mmY = 10;
  const tileW = mmW / mapWidth, tileH = mmH / mapHeight;

  ctx.globalAlpha = 0.8;
  ctx.fillStyle = '#000';
  ctx.fillRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);

  for (let ty = 0; ty < mapHeight; ty++) {
    for (let tx = 0; tx < mapWidth; tx++) {
      const tile = gameMap[ty][tx];
      switch (tile) {
        case T.GRASS: ctx.fillStyle = '#3a6c2f'; break;
        case T.DARK_GRASS: ctx.fillStyle = '#2d5a22'; break;
        case T.TALL_GRASS: ctx.fillStyle = '#4a8c3f'; break;
        case T.FLOWERS: ctx.fillStyle = '#5a8c4f'; break;
        case T.MUSHROOM: ctx.fillStyle = '#3a6c2f'; break;
        case T.BUSH: ctx.fillStyle = '#1e4c10'; break;
        case T.ROCK: ctx.fillStyle = '#777'; break;
        case T.DIRT: ctx.fillStyle = '#6b5335'; break;
        case T.STONE_PATH: ctx.fillStyle = '#888'; break;
        case T.STONE_WALL: ctx.fillStyle = '#555'; break;
        case T.WINDOW_STONE: ctx.fillStyle = '#66aadd'; break;
        case T.TORCH_WALL: ctx.fillStyle = '#ff8800'; break;
        case T.WATER: ctx.fillStyle = '#2060c0'; break;
        case T.TREE: ctx.fillStyle = '#1d4b0e'; break;
        case T.WOOD_FLOOR: ctx.fillStyle = '#8a6240'; break;
        case T.CHURCH_FLOOR: ctx.fillStyle = '#a09870'; break;
        case T.RED_CARPET: ctx.fillStyle = '#8b1a1a'; break;
        case T.ALTAR: ctx.fillStyle = '#ddd'; break;
        case T.CROSS: ctx.fillStyle = '#d4a750'; break;
        case T.CHURCH_PEW: ctx.fillStyle = '#6a4020'; break;
        case T.BOOKSHELF: ctx.fillStyle = '#5a3a1a'; break;
        case T.WOOD_WALL: ctx.fillStyle = '#5a3818'; break;
        case T.WINDOW_WOOD: ctx.fillStyle = '#88bbdd'; break;
        case T.TABLE: ctx.fillStyle = '#8a6040'; break;
        case T.CHAIR: ctx.fillStyle = '#7a5030'; break;
        case T.BED: ctx.fillStyle = '#8b2020'; break;
        case T.RUG: ctx.fillStyle = '#8b3030'; break;
        case T.BARREL: ctx.fillStyle = '#7a5230'; break;
        case T.CRATE: ctx.fillStyle = '#8a6a40'; break;
        case T.ANVIL: ctx.fillStyle = '#555'; break;
        case T.FURNACE: ctx.fillStyle = '#5a4040'; break;
        case T.WELL: ctx.fillStyle = '#777'; break;
        case T.FENCE: ctx.fillStyle = '#8a6a40'; break;
        case T.SAND: ctx.fillStyle = '#b4a070'; break;
        case T.GRAVESTONE: ctx.fillStyle = '#888'; break;
        case T.DEAD_TREE: ctx.fillStyle = '#4a3520'; break;
        case T.BONE: ctx.fillStyle = '#c8c0a0'; break;
        case T.MUD: ctx.fillStyle = '#6b5030'; break;
        case T.HAY: ctx.fillStyle = '#c8a040'; break;
        case T.CHURCH_WALL: ctx.fillStyle = '#6a5a4a'; break;
        default: ctx.fillStyle = '#000';
      }
      ctx.fillRect(mmX + tx * tileW, mmY + ty * tileH, Math.ceil(tileW), Math.ceil(tileH));
    }
  }

  // NPCs on minimap
  ctx.fillStyle = '#ffd700';
  for (const npc of npcs) {
    ctx.fillRect(mmX + npc.x * tileW - 1, mmY + npc.y * tileH - 1, 3, 3);
  }

  // Other players
  ctx.fillStyle = '#44ff44';
  for (const op of Object.values(otherPlayers)) {
    ctx.fillRect(mmX + op.x * tileW - 1, mmY + op.y * tileH - 1, 3, 3);
  }

  // My position
  if (myChar) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(mmX + myChar.x * tileW - 2, mmY + myChar.y * tileH - 2, 4, 4);
  }

  // Enemies
  ctx.fillStyle = '#ff4444';
  for (const e of nearbyEnemies) {
    ctx.fillRect(mmX + e.x * tileW - 1, mmY + e.y * tileH - 1, 2, 2);
  }

  ctx.globalAlpha = 1;

  // Border
  ctx.strokeStyle = '#6b4c2a';
  ctx.lineWidth = 2;
  ctx.strokeRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);

  // Quadrant label
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 13px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`[${currentQuadrant}]`, mmX, mmY + mmH + 16);
  ctx.fillStyle = '#cccccc';
  ctx.font = '11px Arial';
  ctx.fillText(currentQuadrantName, mmX, mmY + mmH + 30);
}

// ============= UI UPDATES =============
function updateStatusUI() {
  if (!myChar) return;
  document.getElementById('char-name').textContent = myChar.username || 'Jogador';
  document.getElementById('stat-level').textContent = myChar.level;
  document.getElementById('stat-silver').textContent = myChar.silver;
  document.getElementById('stat-hp-max').textContent = myChar.max_hp;
  document.getElementById('stat-str').textContent = myChar.strength;
  document.getElementById('stat-int').textContent = myChar.intelligence;
  document.getElementById('stat-def').textContent = myChar.defense;
  document.getElementById('stat-luck').textContent = myChar.luck;

  // HP bar
  const hpPct = Math.max(0, (myChar.hp / myChar.max_hp) * 100);
  document.getElementById('hp-bar').style.width = hpPct + '%';
  document.getElementById('hp-text').textContent = `${myChar.hp}/${myChar.max_hp} HP`;

  // XP bar
  const xpNeeded = myChar.xpNeeded || (myChar.level * 100);
  const xpPct = Math.max(0, (myChar.xp / xpNeeded) * 100);
  document.getElementById('xp-bar').style.width = xpPct + '%';
  document.getElementById('xp-text').textContent = `${myChar.xp}/${xpNeeded} XP`;

  // Equipment slots
  const equipSlots = {
    helmet: { field: 'equipped_helmet', label: 'Elmo' },
    chest: { field: 'equipped_chest', label: 'Peitoral' },
    legs: { field: 'equipped_legs', label: 'CalÃ§a' },
    boots: { field: 'equipped_boots', label: 'Botas' },
    weapon: { field: 'equipped_weapon', label: 'Arma' },
    weapon2: { field: 'equipped_weapon2', label: 'Escudo' },
    ring1: { field: 'equipped_ring1', label: 'Anel 1' },
    ring2: { field: 'equipped_ring2', label: 'Anel 2' }
  };

  for (const [slotId, info] of Object.entries(equipSlots)) {
    const box = document.getElementById('equip-' + slotId);
    if (!box) continue;
    const itemId = myChar[info.field];
    // Limpar conteÃºdo anterior
    box.innerHTML = '';
    if (itemId && ITEMS_CLIENT[itemId]) {
      box.classList.add('has-item');
      const itemData = ITEMS_CLIENT[itemId];
      if (itemData.icon) {
        const iconImg = document.createElement('img');
        iconImg.src = itemData.icon;
        iconImg.className = 'equip-box-icon';
        iconImg.alt = itemData.name;
        iconImg.title = itemData.name;
        box.appendChild(iconImg);
      } else {
        const itemNameEl = document.createElement('span');
        itemNameEl.className = 'equip-box-item';
        itemNameEl.textContent = itemData.name;
        box.appendChild(itemNameEl);
      }
      const unequipBtn = document.createElement('button');
      unequipBtn.className = 'equip-unequip-btn';
      unequipBtn.dataset.slot = slotId;
      unequipBtn.textContent = 'X';
      box.appendChild(unequipBtn);
    } else {
      box.classList.remove('has-item');
      const label = document.createElement('span');
      label.className = 'equip-box-label';
      label.textContent = info.label;
      box.appendChild(label);
    }
  }

  updateSkillsUI();
}

function updateSkillsUI() {
  if (!myChar) return;
  document.getElementById('skill-points').textContent = myChar.skill_points;
  document.getElementById('skill-vitality').textContent = myChar.vitality;
  document.getElementById('skill-strength').textContent = myChar.strength;
  document.getElementById('skill-intelligence').textContent = myChar.intelligence;
  document.getElementById('skill-defense').textContent = myChar.defense;
  document.getElementById('skill-luck').textContent = myChar.luck;

  document.querySelectorAll('.btn-skill').forEach(btn => {
    btn.disabled = !myChar.skill_points || myChar.skill_points <= 0;
  });
}

function updateInventoryUI() {
  const grid = document.getElementById('inventory-grid');
  grid.innerHTML = '';

  // Filter out ONE inventory row per equipped slot
  const equippedItemIds = [];
  if (myChar) {
    const eqFields = ['equipped_weapon', 'equipped_armor', 'equipped_helmet', 'equipped_chest',
      'equipped_legs', 'equipped_boots', 'equipped_ring1', 'equipped_ring2', 'equipped_weapon2'];
    for (const f of eqFields) {
      if (myChar[f]) equippedItemIds.push(myChar[f]);
    }
  }
  const usedRowIds = new Set();
  for (const eqItemId of equippedItemIds) {
    const row = myInventory.find(i => i.item_id === eqItemId && !usedRowIds.has(i.id));
    if (row) usedRowIds.add(row.id);
  }
  const visibleItems = myInventory.filter(item => !usedRowIds.has(item.id));

  // Build a fixed 20-slot grid. visibleItems go in order, rest are empty.
  const totalSlots = 20;
  for (let i = 0; i < totalSlots; i++) {
    const item = visibleItems[i] || null;
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    slot.dataset.slotIndex = String(i);

    if (item) {
      slot.draggable = true;
      slot.dataset.invRowId = String(item.id);

      let icon = '\ud83d\udce6';
      let iconIsImage = false;
      if (item.icon) { icon = item.icon; iconIsImage = true; }
      else if (item.type === 'weapon') icon = '\u2694\ufe0f';
      else if (item.type === 'armor' || item.type === 'chest') icon = '\ud83d\udee1\ufe0f';
      else if (item.type === 'consumable') icon = '\ud83e\uddea';
      else if (item.type === 'helmet') icon = '\ud83e\ude96';
      else if (item.type === 'legs') icon = '\ud83d\udc56';
      else if (item.type === 'boots') icon = '\ud83d\udc62';
      else if (item.type === 'ring') icon = '\ud83d\udc8d';
      else if (item.type === 'shield') icon = '\ud83d\udee1\ufe0f';

      const iconHtml = iconIsImage
        ? `<img src="${icon}" class="item-icon-img" draggable="false" alt="${item.name}">`
        : `<span class="item-icon">${icon}</span>`;

      slot.innerHTML = `
        ${iconHtml}
        <span class="item-name">${item.name}</span>
        ${item.quantity > 1 ? `<span class="item-qty">x${item.quantity}</span>` : ''}
      `;

      // Tooltip
      slot.addEventListener('mouseenter', (e) => showItemTooltip(e, item));
      slot.addEventListener('mouseleave', () => hideItemTooltip());
      slot.addEventListener('mousemove', (e) => moveItemTooltip(e));

      // Left click = equip / use
      slot.addEventListener('click', (e) => {
        const equipTypes = ['weapon', 'armor', 'helmet', 'chest', 'legs', 'boots', 'ring', 'shield'];
        if (equipTypes.includes(item.type)) {
          socket.emit('equipItem', { itemId: item.item_id });
        } else if (item.type === 'consumable') {
          socket.emit('useItem', { itemId: item.item_id });
        }
      });

      // Right click = context menu
      slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showItemContextMenu(e, item);
      });

      // Drag start
      slot.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(item.id));
        slot.classList.add('dragging');
      });
      slot.addEventListener('dragend', () => {
        slot.classList.remove('dragging');
      });
    }

    // ALL slots accept drops (both filled and empty)
    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      slot.classList.add('drag-over');
    });
    slot.addEventListener('dragleave', () => {
      slot.classList.remove('drag-over');
    });
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const draggedRowId = parseInt(e.dataTransfer.getData('text/plain'));
      if (!draggedRowId) return;
      const targetRowId = item ? item.id : null;
      if (draggedRowId === targetRowId) return;

      const dragIdx = myInventory.findIndex(r => r.id === draggedRowId);
      if (dragIdx === -1) return;

      if (targetRowId) {
        // Swap the two items
        const dropIdx = myInventory.findIndex(r => r.id === targetRowId);
        if (dropIdx !== -1) {
          const temp = myInventory[dragIdx];
          myInventory[dragIdx] = myInventory[dropIdx];
          myInventory[dropIdx] = temp;
        }
      } else {
        // Move dragged item to this empty slot position
        const draggedItem = myInventory.splice(dragIdx, 1)[0];
        // Insert at end (empty slots are at the end)
        myInventory.push(draggedItem);
      }
      updateInventoryUI();
    });

    grid.appendChild(slot);
  }
}

// ============= ITEM TOOLTIP =============
let tooltipEl = null;

function showItemTooltip(e, item) {
  hideItemTooltip();
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'item-tooltip';

  let descText = item.description || '';
  // Limitar a 2 linhas (~60 chars)
  if (descText.length > 60) descText = descText.substring(0, 57) + '...';

  tooltipEl.innerHTML = `
    <div class="tip-name">${item.name}</div>
    ${descText ? `<div class="tip-desc">${descText}</div>` : ''}
    <div class="tip-hint">Clique para equipar/usar | Direito para op\u00e7\u00f5es</div>
  `;

  document.body.appendChild(tooltipEl);
  moveItemTooltip(e);
}

function moveItemTooltip(e) {
  if (!tooltipEl) return;
  tooltipEl.style.left = (e.clientX + 12) + 'px';
  tooltipEl.style.top = (e.clientY - 10) + 'px';
}

function hideItemTooltip() {
  if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
}

// ============= CONTEXT MENU (RIGHT CLICK) =============
let contextMenuEl = null;

function showItemContextMenu(e, item) {
  hideItemContextMenu();
  contextMenuEl = document.createElement('div');
  contextMenuEl.className = 'item-context-menu';

  const equipTypes = ['weapon', 'armor', 'helmet', 'chest', 'legs', 'boots', 'ring', 'shield'];

  let btns = '';
  if (equipTypes.includes(item.type)) {
    btns += `<button class="ctx-btn ctx-equip" data-action="equip">[E] Equipar</button>`;
  }
  if (item.type === 'consumable') {
    btns += `<button class="ctx-btn ctx-use" data-action="use">[E] Usar</button>`;
  }
  btns += `<button class="ctx-btn ctx-drop" data-action="drop">[Q] Largar</button>`;

  contextMenuEl.innerHTML = btns;
  document.body.appendChild(contextMenuEl);
  contextMenuEl.style.left = e.clientX + 'px';
  contextMenuEl.style.top = e.clientY + 'px';

  // Handle clicks
  contextMenuEl.querySelectorAll('.ctx-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'equip') {
        socket.emit('equipItem', { itemId: item.item_id });
      } else if (action === 'use') {
        socket.emit('useItem', { itemId: item.item_id });
      } else if (action === 'drop') {
        showDropConfirmation(item);
      }
      hideItemContextMenu();
    });
  });

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', _closeCtxMenu);
  }, 10);
}

function _closeCtxMenu() {
  hideItemContextMenu();
  document.removeEventListener('click', _closeCtxMenu);
}

function hideItemContextMenu() {
  if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null; }
}

// ============= DROP CONFIRMATION POPUP =============
function showDropConfirmation(item) {
  // Remove any existing popup
  const existing = document.getElementById('drop-confirm-popup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'drop-confirm-popup';
  popup.innerHTML = `
    <div class="drop-confirm-box">
      <p>Tem certeza que deseja dropar <strong>${item.name}</strong>${item.quantity > 1 ? ' x' + item.quantity : ''}?</p>
      <div class="drop-confirm-btns">
        <button class="drop-btn-cancel">Cancelar</button>
        <button class="drop-btn-confirm">Largar</button>
      </div>
    </div>
  `;
  document.body.appendChild(popup);

  popup.querySelector('.drop-btn-cancel').addEventListener('click', () => popup.remove());
  popup.querySelector('.drop-btn-confirm').addEventListener('click', () => {
    socket.emit('dropItem', { invId: item.id, itemId: item.item_id, quantity: item.quantity });
    popup.remove();
  });
}

function updateQuestTrackerUI() {
  const tracker = document.getElementById('quest-tracker');
  const activeQuests = myQuests.filter(q => q.status === 'in_progress');
  if (activeQuests.length === 0) {
    tracker.style.display = 'none';
    return;
  }
  tracker.style.display = 'block';
  let html = '<h4>ðŸ“œ MissÃµes</h4>';
  for (const q of activeQuests) {
    const def = q; // already merged with QUEST_DEFS
    let progressHtml = '';
    if (def.targets) {
      let progressData = {};
      try { progressData = JSON.parse(q.progress_data || '{}'); } catch(e) {}
      progressHtml = def.targets.map(t => {
        const name = t.type === 'skeleton' ? 'Esqueletos' : (t.type === 'cow' ? 'Vacas' : 'Slimes');
        return `${name}: ${progressData[t.type] || 0}/${t.count}`;
      }).join(' | ');
    } else {
      progressHtml = `${def.description || ''}: ${q.progress}/${def.targetCount || '?'}`;
    }
    html += `
      <div class="quest-item">
        <div class="quest-name">${def.name || q.quest_id}</div>
        <div class="quest-progress">${progressHtml}</div>
      </div>`;
  }
  tracker.innerHTML = html;
}

function updateChatUI() {
  const container = document.getElementById('chat-messages');
  let html = '';
  for (const msg of chatLog) {
    html += `<div class="chat-msg"><span class="chat-sender" style="color:${msg.color || '#fff'}">[${msg.sender}]</span> ${escapeHtml(msg.message)}</div>`;
  }
  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

// ============= NPC DIALOG =============
function showNpcDialog(data) {
  currentDialog = data;
  document.getElementById('npc-dialog').style.display = 'flex';
  document.getElementById('npc-dialog-name').textContent = data.npcName;
  document.getElementById('npc-dialog-text').textContent = data.message;

  const btns = document.getElementById('npc-dialog-buttons');
  btns.innerHTML = '';

  if (data.action === 'offer') {
    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Aceitar MissÃ£o';
    acceptBtn.className = 'dialog-btn-accept';
    acceptBtn.addEventListener('click', () => {
      socket.emit('acceptQuest', { questId: data.questId });
      closeDialog();
    });
    btns.appendChild(acceptBtn);
  }

  if (data.action === 'complete') {
    const completeBtn = document.createElement('button');
    completeBtn.textContent = 'Receber Recompensa';
    completeBtn.className = 'dialog-btn-complete';
    completeBtn.addEventListener('click', () => {
      socket.emit('completeQuest', { questId: data.questId });
      closeDialog();
    });
    btns.appendChild(completeBtn);
  }

  // Crafting recipes (ArtesÃ£o)
  if (data.isCrafter && data.recipes && data.recipes.length > 0) {
    const recipesDiv = document.createElement('div');
    recipesDiv.className = 'craft-recipes';
    recipesDiv.innerHTML = '<h4 style="color:#d4a750;margin:8px 0 4px;">ðŸ› ï¸ Receitas:</h4>';
    for (const recipe of data.recipes) {
      const recipeDiv = document.createElement('div');
      recipeDiv.className = 'craft-recipe-item';
      const ingredientText = recipe.ingredients.map(ing => {
        const itemInfo = ITEMS_CLIENT[ing.itemId];
        return `${ing.qty}x ${itemInfo ? itemInfo.name : ing.itemId}`;
      }).join(', ');
      recipeDiv.innerHTML = `
        <div class="craft-recipe-name">${recipe.name}</div>
        <div class="craft-recipe-desc">${ingredientText}</div>
      `;
      const craftBtn = document.createElement('button');
      craftBtn.textContent = recipe.canCraft ? 'Criar' : 'Materiais insuficientes';
      craftBtn.className = recipe.canCraft ? 'dialog-btn-accept craft-btn' : 'dialog-btn-close craft-btn disabled';
      craftBtn.disabled = !recipe.canCraft;
      craftBtn.addEventListener('click', () => {
        if (recipe.canCraft) {
          socket.emit('craft', { recipeId: recipe.resultId });
          closeDialog();
        }
      });
      recipeDiv.appendChild(craftBtn);
      recipesDiv.appendChild(recipeDiv);
    }
    btns.appendChild(recipesDiv);
  }

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Fechar';
  closeBtn.className = 'dialog-btn-close';
  closeBtn.addEventListener('click', closeDialog);
  btns.appendChild(closeBtn);
}

function closeDialog() {
  document.getElementById('npc-dialog').style.display = 'none';
  currentDialog = null;
}

// ============= DROP TEXT =============
function showDropText(wx, wy, text, color, offsetY) {
  const container = document.getElementById('damage-numbers');
  const el = document.createElement('div');
  el.className = 'dmg-number drop-text';
  el.textContent = text;
  el.style.color = color;
  el.style.fontWeight = 'bold';
  el.style.fontSize = '13px';

  const sx = wx * TILE_SIZE - cameraX;
  const sy = wy * TILE_SIZE - cameraY - 50 - (offsetY || 0);
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;

  el.style.left = (sx * scaleX + rect.left) + 'px';
  el.style.top = (sy * scaleY + rect.top) + 'px';

  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ============= DAMAGE NUMBERS =============
function showDamage(wx, wy, dmg, color) {
  const container = document.getElementById('damage-numbers');
  const el = document.createElement('div');
  el.className = 'dmg-number';
  el.textContent = '-' + dmg;
  el.style.color = color;

  const sx = wx * TILE_SIZE - cameraX;
  const sy = wy * TILE_SIZE - cameraY - 40;
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;

  el.style.left = (sx * scaleX + rect.left) + 'px';
  el.style.top = (sy * scaleY + rect.top) + 'px';

  container.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// ============= HELPERS =============
function itemName(itemId) {
  const data = ITEMS_CLIENT[itemId];
  return data ? data.name : itemId;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function interactNearestNPC() {
  if (!myChar || currentDialog) return;
  let nearest = null, nearDist = 3; // max interaction range
  for (const npc of npcs) {
    const d = Math.sqrt((myChar.x - npc.x)**2 + (myChar.y - npc.y)**2);
    if (d < nearDist) { nearDist = d; nearest = npc; }
  }
  if (nearest) {
    // Force sync position before interacting
    socket.emit('move', { x: myChar.x, y: myChar.y, direction: myChar.direction, moving: false });
    socket.emit('interact', { npcId: nearest.id });
  }
}

function pickupNearestGroundItem() {
  if (!myChar || myChar.hp <= 0) return;
  let nearest = null, nearDist = 2;
  for (const gi of groundItems) {
    const d = Math.sqrt((myChar.x - gi.x)**2 + (myChar.y - gi.y)**2);
    if (d < nearDist) { nearDist = d; nearest = gi; }
  }
  if (nearest) {
    socket.emit('pickupItem', { gid: nearest.gid });
  }
}

// ============= INIT =============
window.addEventListener('load', () => {
  resizeCanvas();
});
