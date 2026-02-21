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
  console.log('Reconectado após', attempt, 'tentativas');
  // Re-login automático se já estava logado
  if (myChar && myChar.username && lastLoginCredentials) {
    console.log('Tentando re-login automático...');
    socket.emit('login', lastLoginCredentials, (res) => {
      if (res.success) {
        console.log('Re-login automático bem sucedido!');
      } else {
        console.log('Re-login falhou:', res.error);
        // Se falhou por conta já conectada, forçar refresh
        if (res.error && res.error.includes('já está conectada')) {
          setTimeout(() => {
            socket.emit('login', lastLoginCredentials, (res2) => {
              if (res2.success) console.log('Re-login automático bem sucedido (2a tentativa)');
            });
          }, 2000);
        }
      }
    });
  }
});

socket.on('reconnect_attempt', (attempt) => {
  console.log('Tentativa de reconexão:', attempt);
});

// ============= CONSTANTS =============
let TILE_SIZE = 32;
const TILE_SIZE_MIN = 16;
const TILE_SIZE_MAX = 64;
const MOVE_SPEED = 0.08; // tiles per frame
let userZoom = null; // null = auto, number = user-defined TILE_SIZE via scroll

// Tile type enum (must match server)
const T = { GRASS:0, DIRT:1, STONE_PATH:2, STONE_WALL:3, WATER:4, TREE_CARVALHO:5, WOOD_FLOOR:6, CHURCH_FLOOR:7, WOOD_WALL:8, SAND:9,
  FLOWERS:10, BUSH:11, ROCK:12, RED_CARPET:13, ALTAR:14, ANVIL:15, FURNACE:16, BOOKSHELF:17, TABLE:18, CHAIR:19,
  WELL:20, FENCE:21, ROOF_STONE:22, ROOF_WOOD:23, WINDOW_STONE:24, WINDOW_WOOD:25, CROSS:26, TALL_GRASS:27, MUSHROOM:28,
  BARREL:29, CRATE:30, TORCH_WALL:31, BED:32, RUG:33, CHURCH_PEW:34, DARK_GRASS:35,
  GRAVESTONE:36, DEAD_TREE:37, BONE:38, MUD:39, HAY:40, CHURCH_WALL:41,
  ROOF_RED:42, ROOF_BLUE:43, ROOF_YELLOW:44, BENCH:45,
  TREE_BETULA:46, TREE_CARVALHO_SMALL:47, TREE_MAGICA:48, TREE_MANGUE:49, TREE_PINHEIRO:50, TREE_PINOS:51,
  WATER_RIVER:52 };
const BLOCKED = new Set([T.STONE_WALL, T.WATER, T.WATER_RIVER, T.TREE_CARVALHO, T.WOOD_WALL, T.BUSH, T.ROCK, T.ANVIL, T.FURNACE,
  T.BOOKSHELF, T.WELL, T.FENCE, T.BARREL, T.CRATE, T.BED, T.TORCH_WALL, T.GRAVESTONE, T.DEAD_TREE, T.HAY, T.CHURCH_WALL,
  T.TREE_BETULA, T.TREE_CARVALHO_SMALL, T.TREE_MAGICA, T.TREE_MANGUE, T.TREE_PINHEIRO, T.TREE_PINOS]);

// ============= STATE =============
let gameMap = null;
let mapWidth = 0, mapHeight = 0;
let myChar = null;
let otherPlayers = {};
let otherPlayersCache = {}; // interpolation: { id: { x, y, targetX, targetY, animFrame, animTimer } }
let nearbyEnemies = [];
let npcs = [];
let myInventory = [];
let myQuests = [];
let chatLog = [];
let myChatBubble = null; // { message, time }
let currentDialog = null;
let targetEnemy = null;
let lastAttackTime = 0;
let groundItems = []; // itens no chão
let npcQuestStatus = {}; // quest status per NPC
let lastLoginCredentials = null; // para re-login automático

// Quadrant system
let currentQuadrant = 'E5';
let currentQuadrantName = 'Cidade de Origens';
let quadrantNeighbors = { left: null, right: null, up: null, down: null };
let transitioning = false;

// Image objects on the map (solid blocks with images)
let mapObjects = [];
let mapPortals = [];
let solidCellSet = new Set(); // per-cell solid grid from editor
let behindCellSet = new Set(); // per-cell "behind" grid (player passes behind objects here)
const mapObjectImages = {}; // cache: id -> Image element

function loadMapObjectImages() {
  for (const obj of mapObjects) {
    if (!mapObjectImages[obj.id]) {
      const img = new Image();
      img.src = obj.src;
      mapObjectImages[obj.id] = img;
    }
  }
  // Clean up removed objects
  const ids = new Set(mapObjects.map(o => o.id));
  for (const k of Object.keys(mapObjectImages)) {
    if (!ids.has(k)) delete mapObjectImages[k];
  }
}

// Draw the portions of objects that are NOT in behindCells (rendered BEFORE entities)
function drawMapObjects() {
  if (behindCellSet.size === 0) {
    // No behind cells at all — draw everything as before
    for (const obj of mapObjects) {
      const img = mapObjectImages[obj.id];
      if (!img || !img.complete || !img.naturalWidth) continue;
      const sx = obj.x * TILE_SIZE - cameraX;
      const sy = obj.y * TILE_SIZE - cameraY;
      const sw = obj.width * TILE_SIZE;
      const sh = obj.height * TILE_SIZE;
      ctx.drawImage(img, sx, sy, sw, sh);
    }
    return;
  }

  for (const obj of mapObjects) {
    const img = mapObjectImages[obj.id];
    if (!img || !img.complete || !img.naturalWidth) continue;
    const sx = obj.x * TILE_SIZE - cameraX;
    const sy = obj.y * TILE_SIZE - cameraY;
    const sw = obj.width * TILE_SIZE;
    const sh = obj.height * TILE_SIZE;

    // Check if this object overlaps any behind cells
    let hasBehind = false;
    for (let ty = obj.y; ty < obj.y + obj.height; ty++) {
      for (let tx = obj.x; tx < obj.x + obj.width; tx++) {
        if (behindCellSet.has(`${tx},${ty}`)) { hasBehind = true; break; }
      }
      if (hasBehind) break;
    }

    if (!hasBehind) {
      // No behind cells overlap — draw entire object normally
      ctx.drawImage(img, sx, sy, sw, sh);
    } else {
      // Clip to tiles that are NOT behind cells
      ctx.save();
      ctx.beginPath();
      for (let ty = obj.y; ty < obj.y + obj.height; ty++) {
        for (let tx = obj.x; tx < obj.x + obj.width; tx++) {
          if (!behindCellSet.has(`${tx},${ty}`)) {
            ctx.rect(tx * TILE_SIZE - cameraX, ty * TILE_SIZE - cameraY, TILE_SIZE, TILE_SIZE);
          }
        }
      }
      ctx.clip();
      ctx.drawImage(img, sx, sy, sw, sh);
      ctx.restore();
    }
  }
}

// Draw the portions of objects that ARE in behindCells (rendered AFTER entities so they appear in front)
function drawMapObjectsBehind() {
  if (behindCellSet.size === 0) return;

  for (const obj of mapObjects) {
    const img = mapObjectImages[obj.id];
    if (!img || !img.complete || !img.naturalWidth) continue;
    const sx = obj.x * TILE_SIZE - cameraX;
    const sy = obj.y * TILE_SIZE - cameraY;
    const sw = obj.width * TILE_SIZE;
    const sh = obj.height * TILE_SIZE;

    // Collect behind tiles that overlap this object
    ctx.save();
    ctx.beginPath();
    let anyBehind = false;
    for (let ty = obj.y; ty < obj.y + obj.height; ty++) {
      for (let tx = obj.x; tx < obj.x + obj.width; tx++) {
        if (behindCellSet.has(`${tx},${ty}`)) {
          ctx.rect(tx * TILE_SIZE - cameraX, ty * TILE_SIZE - cameraY, TILE_SIZE, TILE_SIZE);
          anyBehind = true;
        }
      }
    }
    if (anyBehind) {
      ctx.clip();
      ctx.drawImage(img, sx, sy, sw, sh);
    }
    ctx.restore();
  }
}

// Item data map (client-side)
const ITEMS_CLIENT = {
  espada_enferrujada: { name: 'Espada Enferrujada', icon: '/assets/icons/swords/enferrujada.png' },
  pocao_cura: { name: 'Poção de Cura', icon: null },
  couro_cru: { name: 'Couro Cru', icon: '/assets/sprites/cow/courocru.png' },
  couro_trabalhado: { name: 'Couro Trabalhado', icon: '/assets/sprites/cow/courotrabalhado.png' },
  tunica_couro_simples: { name: 'Túnica de Couro Simples', icon: '/assets/icons/Armadura de Couro Simples/tunicacourosimples.png' },
  chapeu_couro_simples: { name: 'Chapéu de Couro Simples', icon: '/assets/icons/Armadura de Couro Simples/chapeucourosimples.png' },
  bota_couro_simples: { name: 'Bota de Couro Simples', icon: '/assets/icons/Armadura de Couro Simples/botacourosimples.png' },
  calca_couro_simples: { name: 'Calça de Couro Simples', icon: '/assets/icons/Armadura de Couro Simples/calcacourosimples.png' }
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
  ['tunicasimplesparado', '/assets/sprites/player/itens/Couro simples/tunicasimplesparado.png'],
  ['tunicasimplesandando', '/assets/sprites/player/itens/Couro simples/tunicasimplesandando.png'],
  ['chapeuparado', '/assets/sprites/player/itens/Couro simples/chapeuparado.png'],
  ['chapeuandando', '/assets/sprites/player/itens/Couro simples/chapeuandando.png'],
  ['botaparado', '/assets/sprites/player/itens/Couro simples/botaparado.png'],
  ['botaandando', '/assets/sprites/player/itens/Couro simples/botaandando.png'],
  ['calcaparado', '/assets/sprites/player/itens/Couro simples/calcaparado.png'],
  ['calcaandando', '/assets/sprites/player/itens/Couro simples/calcaandando.png'],
  ['zumbiparado', '/assets/sprites/zumbi/zumbiparado.png'],
  ['zumbiandando', '/assets/sprites/zumbi/zumbiandando.png'],
];

// Mapa de item_id -> sprite names [parado, andando]
const WEAPON_SPRITES = {
  espada_enferrujada: ['enferrujadaparado', 'esferrujadaandando'],
};

// Mapa de item_id -> sprite names [parado, andando] para armaduras de peitoral
const CHEST_SPRITES = {
  tunica_couro_simples: ['tunicasimplesparado', 'tunicasimplesandando'],
};

// Mapa de item_id -> sprite names [parado, andando] para elmos
const HELMET_SPRITES = {
  chapeu_couro_simples: ['chapeuparado', 'chapeuandando'],
};

// Mapa de item_id -> sprite names [parado, andando] para botas
const BOOTS_SPRITES = {
  bota_couro_simples: ['botaparado', 'botaandando'],
};

// Mapa de item_id -> sprite names [parado, andando] para calças
const LEGS_SPRITES = {
  calca_couro_simples: ['calcaparado', 'calcaandando'],
};

let spritesLoaded = 0;
for (const [name, src] of spriteNames) {
  const img = new Image();
  img.onload = () => { spritesLoaded++; };
  img.onerror = () => { console.warn('Sprite not found:', src); spritesLoaded++; };
  img.src = src;
  sprites[name] = img;
}

// ============= TREE SPRITE LOADING =============
// Map tile type -> array of Image objects for that tree family
const TREE_SPRITES = {};
const TREE_SPRITE_DEFS = {
  [T.TREE_CARVALHO]: [
    '/assets/sprites/trees/carvalho/arvore1.png',
    '/assets/sprites/trees/carvalho/arvore2.png',
    '/assets/sprites/trees/carvalho/arvore3.png',
    '/assets/sprites/trees/carvalho/arvore4.png',
    '/assets/sprites/trees/carvalho/arvore5.png',
    '/assets/sprites/trees/carvalho/arvore6.png',
    '/assets/sprites/trees/carvalho/arvore7.png',
  ],
  [T.TREE_BETULA]: [
    '/assets/sprites/trees/bétula/betula1.png',
    '/assets/sprites/trees/bétula/betula2.png',
    '/assets/sprites/trees/bétula/betula3.png',
    '/assets/sprites/trees/bétula/betula4.png',
    '/assets/sprites/trees/bétula/betula5.png',
  ],
  [T.TREE_CARVALHO_SMALL]: [
    '/assets/sprites/trees/carvalho/pequena1.png',
    '/assets/sprites/trees/carvalho/pequena2.png',
  ],
  [T.TREE_MAGICA]: [
    '/assets/sprites/trees/magicas/arvoremagica1.png',
    '/assets/sprites/trees/magicas/arvoremagica2.png',
  ],
  [T.TREE_MANGUE]: [
    '/assets/sprites/trees/mangue/mangue1.png',
    '/assets/sprites/trees/mangue/mangue2.png',
  ],
  [T.TREE_PINHEIRO]: [
    '/assets/sprites/trees/pinheiro/pinheiro1.png',
    '/assets/sprites/trees/pinheiro/pinheiro2.png',
    '/assets/sprites/trees/pinheiro/pinheiro3.png',
    '/assets/sprites/trees/pinheiro/pinheiro4.png',
    '/assets/sprites/trees/pinheiro/pinheiro5.png',
    '/assets/sprites/trees/pinheiro/pinheiro6.png',
    '/assets/sprites/trees/pinheiro/pinheiro7.png',
    '/assets/sprites/trees/pinheiro/pinheiro8.png',
    '/assets/sprites/trees/pinheiro/pinheiro9.png',
  ],
  [T.TREE_PINOS]: [
    '/assets/sprites/trees/pinos/pinos1.png',
    '/assets/sprites/trees/pinos/pinos2.png',
    '/assets/sprites/trees/pinos/pinos3.png',
  ],
};
// All tree tile types for quick lookup
const TREE_TILE_TYPES = new Set(Object.keys(TREE_SPRITE_DEFS).map(Number));

let treeSpriteCount = 0;
let treeSpriteTotal = 0;
for (const [tileType, paths] of Object.entries(TREE_SPRITE_DEFS)) {
  TREE_SPRITES[tileType] = [];
  treeSpriteTotal += paths.length;
  for (const src of paths) {
    const img = new Image();
    img.onload = () => { treeSpriteCount++; };
    img.onerror = () => { console.warn('Tree sprite not found:', src); treeSpriteCount++; };
    img.src = src;
    TREE_SPRITES[tileType].push(img);
  }
}

// (Auto-tiling removed — using simple procedural tile cache only)
// Pre-render detailed tiles ONCE at fixed base resolution, then scale via drawImage
const tileCanvasCache = {};
let tileCacheBuilt = false;
const TILE_VARIANTS = 8; // variants per tile type
const TILE_BASE = 32; // fixed render resolution (32x32 Tibia-style pixel art)

function seededRand(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function() { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
}

// Clean texture helper: fewer pixels, larger patches (less noisy)
function fillCleanTexture(c, x, y, w, h, colors, patchCount, rng) {
  for (let i = 0; i < patchCount; i++) {
    const px = Math.floor(rng() * (w - 1));
    const py = Math.floor(rng() * (h - 1));
    c.fillStyle = colors[Math.floor(rng() * colors.length)];
    const pw = rng() < 0.5 ? 2 : 1;
    const ph = rng() < 0.5 ? 2 : 1;
    c.fillRect(x + px, y + py, pw, ph);
  }
}

// Legacy noise fill (reduced density for cleaner look)
function fillNoise(c, x, y, w, h, colors, density, rng) {
  // Use patch-based approach instead of per-pixel noise
  const patchCount = Math.max(2, Math.floor(w * h * density * 0.3));
  fillCleanTexture(c, x, y, w, h, colors, patchCount, rng);
}

function initTileCache() {
  // Build once at fixed TILE_BASE resolution - never rebuilt on zoom
  if (tileCacheBuilt) return;
  tileCacheBuilt = true;
  const s = TILE_BASE;
  for (let tileType = 0; tileType <= 52; tileType++) {
    // Skip tree sprite tiles and water tiles (animated separately)
    if (TREE_TILE_TYPES.has(tileType)) continue;
    if (tileType === T.WATER_RIVER) continue;
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
  // river water frames (lighter)
  for (let f = 0; f < 3; f++) {
    for (let v = 0; v < TILE_VARIANTS; v++) {
      const key = 'river_' + f + '_' + v;
      const off = document.createElement('canvas');
      off.width = s; off.height = s;
      const oc = off.getContext('2d');
      renderRiverTile(oc, v, f, s);
      tileCanvasCache[key] = off;
    }
  }
}

function renderWaterTile(c, variant, frame, s) {
  const rng = seededRand(variant * 137 + frame * 31 + 999);
  // Deep blue base
  c.fillStyle = '#1a4a85';
  c.fillRect(0, 0, s, s);
  // Depth variation patches (scaled)
  const wShades = ['#164278','#1e528e','#1a4a85','#184c8a','#1c5090'];
  const depthN = Math.floor(s * s / 80);
  for (let i = 0; i < depthN; i++) {
    c.fillStyle = wShades[Math.floor(rng() * wShades.length)];
    c.fillRect(Math.floor(rng() * (s - 2)), Math.floor(rng() * (s - 2)),
      1 + Math.floor(rng() * 2), 1 + Math.floor(rng() * 2));
  }
  // Primary wave lines (animated)
  const wOff = frame * Math.floor(s / 3);
  c.fillStyle = '#2a6aaa';
  for (let px = 0; px < s; px++) {
    const wy1 = Math.floor(s * 0.25 + Math.sin((px + wOff) * 0.28) * 2.5);
    c.fillRect(px, wy1, 1, 1);
    const wy2 = Math.floor(s * 0.65 + Math.sin((px + wOff + 8) * 0.24) * 2.5);
    c.fillRect(px, wy2, 1, 1);
  }
  // Secondary subtle wave
  c.fillStyle = '#225e98';
  for (let px = 0; px < s; px++) {
    const wy3 = Math.floor(s * 0.45 + Math.sin((px + wOff + 4) * 0.32) * 2);
    c.fillRect(px, wy3, 1, 1);
  }
  // Sparkle highlights
  c.fillStyle = '#5a9ad0';
  const sparkles = Math.max(2, Math.floor(s / 10));
  for (let i = 0; i < sparkles; i++) {
    const spx = Math.floor(rng() * s), spy = Math.floor(rng() * s);
    if ((spx + spy + frame) % 4 === 0) c.fillRect(spx, spy, 1, 1);
  }
}

// River water — lighter, clearer variant
function renderRiverTile(c, variant, frame, s) {
  const rng = seededRand(variant * 137 + frame * 31 + 777);
  // Lighter blue-green base
  c.fillStyle = '#2a7ab8';
  c.fillRect(0, 0, s, s);
  // Depth variation patches (lighter shades)
  const rShades = ['#2872ae','#3082c0','#2a7ab8','#2c80bc','#3488c4'];
  const depthN = Math.floor(s * s / 80);
  for (let i = 0; i < depthN; i++) {
    c.fillStyle = rShades[Math.floor(rng() * rShades.length)];
    c.fillRect(Math.floor(rng() * (s - 2)), Math.floor(rng() * (s - 2)),
      1 + Math.floor(rng() * 2), 1 + Math.floor(rng() * 2));
  }
  // Primary wave lines (animated) — lighter
  const wOff = frame * Math.floor(s / 3);
  c.fillStyle = '#4a9ad0';
  for (let px = 0; px < s; px++) {
    const wy1 = Math.floor(s * 0.25 + Math.sin((px + wOff) * 0.28) * 2.5);
    c.fillRect(px, wy1, 1, 1);
    const wy2 = Math.floor(s * 0.65 + Math.sin((px + wOff + 8) * 0.24) * 2.5);
    c.fillRect(px, wy2, 1, 1);
  }
  // Secondary subtle wave
  c.fillStyle = '#3a8cc0';
  for (let px = 0; px < s; px++) {
    const wy3 = Math.floor(s * 0.45 + Math.sin((px + wOff + 4) * 0.32) * 2);
    c.fillRect(px, wy3, 1, 1);
  }
  // Sparkle highlights — more visible on river
  c.fillStyle = '#7ac0e8';
  const sparkles = Math.max(3, Math.floor(s / 8));
  for (let i = 0; i < sparkles; i++) {
    const spx = Math.floor(rng() * s), spy = Math.floor(rng() * s);
    if ((spx + spy + frame) % 3 === 0) c.fillRect(spx, spy, 1, 1);
  }
}

function renderDetailedTile(c, tileType, variant, s) {
  const rng = seededRand(variant * 1000 + tileType * 97 + 42);
  const v = variant;

  switch (tileType) {
    // ===== GRASS =====
    case T.GRASS: {
      c.fillStyle = '#3a7a2c';
      c.fillRect(0, 0, s, s);
      // Rich dithered texture (scales with resolution)
      const gShades = ['#367628','#3e7e30','#347224','#408032','#387a2a','#3c7c2e'];
      const gPatches = Math.floor(s * s / 65);
      for (let i = 0; i < gPatches; i++) {
        c.fillStyle = gShades[Math.floor(rng() * gShades.length)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.4 ? 2 : 1, rng() < 0.4 ? 2 : 1);
      }
      // Grass blade tufts (scaled)
      const gTufts = Math.floor(s / 7) + (v % 3);
      for (let i = 0; i < gTufts; i++) {
        const tx = 3 + Math.floor(rng() * (s - 6));
        const ty = 3 + Math.floor(rng() * (s - 8));
        c.fillStyle = '#4a9a3a';
        c.fillRect(tx, ty, 1, 3);
        if (rng() < 0.5) c.fillRect(tx + 1, ty + 1, 1, 2);
        if (rng() < 0.3) c.fillRect(tx - 1, ty + 1, 1, 2);
      }
      // Dark accent dots
      c.fillStyle = '#2e6820';
      const gAccents = Math.max(1, Math.floor(s / 16));
      for (let i = 0; i < gAccents; i++) {
        c.fillRect(1 + Math.floor(rng() * (s - 3)), 1 + Math.floor(rng() * (s - 2)), 2, 1);
      }
      break;
    }

    // ===== DARK GRASS =====
    case T.DARK_GRASS: {
      c.fillStyle = '#2a5c18';
      c.fillRect(0, 0, s, s);
      const dgShades = ['#225414','#2e6220','#1e4e10','#286018','#204c12'];
      const dgP = Math.floor(s * s / 70);
      for (let i = 0; i < dgP; i++) {
        c.fillStyle = dgShades[Math.floor(rng() * dgShades.length)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.3 ? 2 : 1, rng() < 0.3 ? 2 : 1);
      }
      // Grass blade tufts (like normal grass but darker)
      const dgTufts = Math.floor(s / 7) + (v % 3);
      for (let i = 0; i < dgTufts; i++) {
        const tx = 3 + Math.floor(rng() * (s - 6));
        const ty = 3 + Math.floor(rng() * (s - 8));
        c.fillStyle = '#388a28';
        c.fillRect(tx, ty, 1, 3);
        if (rng() < 0.5) c.fillRect(tx + 1, ty + 1, 1, 2);
        if (rng() < 0.3) c.fillRect(tx - 1, ty + 1, 1, 2);
      }
      // Dark specks
      const dgSpecks = Math.max(2, Math.floor(s / 10));
      for (let i = 0; i < dgSpecks; i++) {
        c.fillStyle = '#1a4a0c';
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), 1, 1);
      }
      // Accent dots (subtly lighter)
      c.fillStyle = '#245816';
      const dgAccents = Math.max(1, Math.floor(s / 16));
      for (let i = 0; i < dgAccents; i++) {
        c.fillRect(1 + Math.floor(rng() * (s - 3)), 1 + Math.floor(rng() * (s - 2)), 2, 1);
      }
      break;
    }

    // ===== TALL GRASS =====
    case T.TALL_GRASS: {
      c.fillStyle = '#348a28';
      c.fillRect(0, 0, s, s);
      const tgP = Math.floor(s * s / 70);
      for (let i = 0; i < tgP; i++) {
        c.fillStyle = ['#2e7a22','#3a8e2e','#327e26'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.3 ? 2 : 1, 1);
      }
      // Tall blades (scaled)
      const tgBlades = Math.max(4, Math.floor(s / 5));
      for (let i = 0; i < tgBlades; i++) {
        const bx = Math.floor(rng() * (s - 1));
        const bh = Math.floor(s * 0.15) + Math.floor(rng() * Math.floor(s * 0.15));
        const by = s - bh;
        c.fillStyle = ['#4ea844','#56b04a','#48a03e'][Math.floor(rng() * 3)];
        c.fillRect(bx, by, 1, bh);
        if (rng() < 0.3) c.fillRect(bx + 1, by + 2, 1, bh - 3);
      }
      break;
    }

    // ===== FLOWERS =====
    case T.FLOWERS: {
      c.fillStyle = '#3a7a2c';
      c.fillRect(0, 0, s, s);
      const flP = Math.floor(s * s / 70);
      for (let i = 0; i < flP; i++) {
        c.fillStyle = ['#358226','#3f9232','#367628'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.3 ? 2 : 1, rng() < 0.3 ? 2 : 1);
      }
      // Flowers (scaled count)
      const nF = Math.max(2, Math.floor(s / 8));
      for (let i = 0; i < nF; i++) {
        const fx = 2 + Math.floor(rng() * (s - 5));
        const fy = 2 + Math.floor(rng() * (s - 6));
        c.fillStyle = '#2a6a1c';
        c.fillRect(fx, fy + 3, 1, Math.max(2, Math.floor(s * 0.08)));
        const fc = ['#ff4466','#ffaa33','#ff6688','#ffdd44','#ee55aa'][Math.floor(rng() * 5)];
        c.fillStyle = fc;
        c.fillRect(fx - 1, fy, 3, 1);
        c.fillRect(fx, fy - 1, 1, 3);
        c.fillStyle = '#ffee44';
        c.fillRect(fx, fy, 1, 1);
      }
      break;
    }

    // ===== MUSHROOM =====
    case T.MUSHROOM: {
      c.fillStyle = '#3a7a2c';
      c.fillRect(0, 0, s, s);
      const msP = Math.floor(s * s / 70);
      for (let i = 0; i < msP; i++) {
        c.fillStyle = ['#358226','#3f9232','#367628'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.3 ? 2 : 1, 1);
      }
      // Mushroom (scaled)
      const mx = Math.floor(s * 0.38), my = Math.floor(s * 0.32);
      const mStem = Math.max(2, Math.floor(s * 0.08));
      const mCapW = Math.max(5, Math.floor(s * 0.22));
      const mCapH = Math.max(3, Math.floor(s * 0.12));
      // Stem
      c.fillStyle = '#e8dcc0';
      c.fillRect(mx, my + mCapH, mStem, Math.floor(s * 0.16));
      c.fillStyle = '#d8ccb0';
      c.fillRect(mx + mStem - 1, my + mCapH, 1, Math.floor(s * 0.16));
      // Cap
      c.fillStyle = '#cc2020';
      c.fillRect(mx - Math.floor(mCapW * 0.4), my, mCapW, mCapH);
      // White spots
      c.fillStyle = '#fff';
      c.fillRect(mx - Math.floor(mCapW * 0.2), my + 1, 1, 1);
      c.fillRect(mx + Math.floor(mCapW * 0.15), my, 1, 1);
      if (s >= 24) c.fillRect(mx + Math.floor(mCapW * 0.3), my + 1, 1, 1);
      break;
    }

    // ===== BUSH =====
    case T.BUSH: {
      // Grass background
      c.fillStyle = '#3a7a2c';
      c.fillRect(0, 0, s, s);
      const bshP = Math.floor(s * s / 80);
      for (let i = 0; i < bshP; i++) {
        c.fillStyle = ['#367628','#3e7e30','#347224'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.3 ? 2 : 1, 1);
      }
      // Ground shadow
      c.fillStyle = 'rgba(0,0,0,0.12)';
      const bshSx = Math.floor(s * 0.14), bshSy = Math.floor(s * 0.78);
      c.fillRect(bshSx, bshSy, Math.floor(s * 0.72), Math.floor(s * 0.08));
      // Bush body - rounded oval shape
      const bx = Math.floor(s * 0.1), bby = Math.floor(s * 0.18);
      const bw = Math.floor(s * 0.8), bh = Math.floor(s * 0.6);
      // Dark green base (rounded edges)
      const inset = Math.max(2, Math.floor(s * 0.08));
      c.fillStyle = '#1a5c0e';
      c.fillRect(bx + inset, bby, bw - inset * 2, bh);
      c.fillRect(bx + 1, bby + inset, bw - 2, bh - inset * 2);
      c.fillRect(bx, bby + inset + 1, bw, bh - inset * 2 - 2);
      // Medium green layer
      c.fillStyle = '#226a14';
      c.fillRect(bx + inset + 1, bby + 1, bw - inset * 2 - 2, bh - 3);
      c.fillRect(bx + 2, bby + inset + 1, bw - 4, bh - inset * 2 - 2);
      // Light highlight top
      c.fillStyle = '#2e7a1e';
      c.fillRect(bx + inset + 2, bby + 1, bw - inset * 2 - 4, Math.floor(bh * 0.35));
      c.fillStyle = '#3a8a2a';
      c.fillRect(bx + inset + 3, bby, bw - inset * 2 - 6, Math.floor(bh * 0.18));
      // Leaf detail
      for (let i = 0; i < Math.floor(s / 8); i++) {
        c.fillStyle = rng() < 0.5 ? '#144e0a' : '#2e7a1c';
        c.fillRect(bx + inset + Math.floor(rng() * (bw - inset * 2)),
          bby + 2 + Math.floor(rng() * (bh - 4)), 1, 1);
      }
      break;
    }

    // ===== ROCK =====
    case T.ROCK: {
      // Grass background
      c.fillStyle = '#3a7a2c';
      c.fillRect(0, 0, s, s);
      const rkP = Math.floor(s * s / 80);
      for (let i = 0; i < rkP; i++) {
        c.fillStyle = ['#367628','#3e7e30','#347224'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.3 ? 2 : 1, 1);
      }
      // Ground shadow
      c.fillStyle = 'rgba(0,0,0,0.15)';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.72), Math.floor(s * 0.8), Math.floor(s * 0.1));
      // Rock body - rounded
      const rx = Math.floor(s * 0.12), ry = Math.floor(s * 0.15);
      const rw = Math.floor(s * 0.76), rh = Math.floor(s * 0.58);
      const rInset = Math.max(2, Math.floor(s * 0.06));
      // Base shape
      c.fillStyle = '#686868';
      c.fillRect(rx + rInset, ry, rw - rInset * 2, rh);
      c.fillRect(rx + 1, ry + rInset, rw - 2, rh - rInset);
      c.fillRect(rx, ry + rInset + 1, rw, rh - rInset - 2);
      // Mid-tone
      c.fillStyle = '#7a7a7a';
      c.fillRect(rx + rInset + 1, ry + 1, rw - rInset * 2 - 2, rh - 3);
      // Highlight top third
      c.fillStyle = '#8e8e8e';
      c.fillRect(rx + rInset + 2, ry + 1, rw - rInset * 2 - 4, Math.floor(rh * 0.35));
      c.fillStyle = '#9a9a9a';
      c.fillRect(rx + rInset + 3, ry, rw - rInset * 2 - 6, Math.floor(rh * 0.2));
      // Dark bottom
      c.fillStyle = '#585858';
      c.fillRect(rx + 1, ry + rh - Math.floor(rh * 0.25), rw - 2, Math.floor(rh * 0.25));
      // Crack
      c.fillStyle = '#4a4a4a';
      const crX = rx + Math.floor(rw * 0.35);
      for (let i = 0; i < Math.floor(rh * 0.5); i++) {
        c.fillRect(crX + (i % 2), ry + 3 + i, 1, 1);
      }
      // Speckle detail
      for (let i = 0; i < Math.floor(s / 10); i++) {
        c.fillStyle = rng() < 0.5 ? '#5e5e5e' : '#8a8a8a';
        c.fillRect(rx + 2 + Math.floor(rng() * (rw - 4)),
          ry + 2 + Math.floor(rng() * (rh - 3)), 1, 1);
      }
      break;
    }

    // ===== DIRT =====
    case T.DIRT: {
      c.fillStyle = '#8a6e48';
      c.fillRect(0, 0, s, s);
      // Earthy texture (scaled)
      const dtShades = ['#826644','#927a54','#7e6240','#886e4c','#7a5e3c'];
      const dtP = Math.floor(s * s / 60);
      for (let i = 0; i < dtP; i++) {
        c.fillStyle = dtShades[Math.floor(rng() * dtShades.length)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.4 ? 2 : 1, rng() < 0.3 ? 2 : 1);
      }
      // Pebbles
      const dtPeb = 1 + (v % 3);
      for (let i = 0; i < dtPeb; i++) {
        c.fillStyle = ['#6a5e48','#5e5240','#625844'][Math.floor(rng() * 3)];
        c.fillRect(1 + Math.floor(rng() * (s - 3)), 1 + Math.floor(rng() * (s - 3)), 2, 1);
      }
      // Occasional crack
      if (v % 4 === 0) {
        c.fillStyle = '#6a5838';
        const dtCx = 3 + Math.floor(rng() * (s - 6));
        const dtCy = 3 + Math.floor(rng() * (s - 6));
        for (let i = 0; i < Math.max(3, Math.floor(s * 0.12)); i++) {
          c.fillRect(dtCx + i, dtCy + Math.floor(rng() * 2), 1, 1);
        }
      }
      break;
    }

    // ===== STONE PATH =====
    case T.STONE_PATH: {
      // Classic cobblestone grid pattern
      c.fillStyle = '#5a5a5a';
      c.fillRect(0, 0, s, s);
      const stClrs = ['#8a8a8a','#828282','#909090','#868686','#8e8e8e','#7e7e7e','#929292','#848484'];
      const stRows = Math.max(3, Math.floor(s / 7));
      const stRowH = Math.floor(s / stRows);
      for (let row = 0; row < stRows; row++) {
        const stRy = row * stRowH;
        const stSh = stRowH - 1;
        if (stRy + stSh > s) break;
        const stOff = ((row + v) % 2 !== 0) ? Math.floor(s * 0.15) : 0;
        const stNum = Math.max(2, Math.floor(s / 8));
        const stBaseW = Math.floor(s / stNum);
        let stCx = -stOff;
        for (let si = 0; si <= stNum + 1; si++) {
          const stSw = stBaseW + ((si + row) % 3 === 0 ? 2 : 0);
          const stDx = Math.max(0, stCx);
          const stDw = Math.min(stCx + stSw - 1, s) - stDx;
          if (stDw > 0 && stSh > 0) {
            const ci = ((row * 5 + si + v * 3) * 7) % stClrs.length;
            c.fillStyle = stClrs[ci];
            c.fillRect(stDx, stRy, stDw, stSh);
            // Highlight top
            c.fillStyle = '#9a9a9a';
            c.fillRect(stDx, stRy, stDw, 1);
            // Shadow bottom
            c.fillStyle = '#6a6a6a';
            c.fillRect(stDx, stRy + stSh - 1, stDw, 1);
          }
          stCx += stSw;
        }
      }
      break;
    }

    // ===== STONE WALL =====
    case T.STONE_WALL: {
      c.fillStyle = '#585858';
      c.fillRect(0, 0, s, s);
      // Top highlight (3D)
      c.fillStyle = '#707070';
      c.fillRect(0, 0, s, Math.max(2, Math.floor(s * 0.08)));
      // Mortar
      c.fillStyle = '#464646';
      const wh = Math.floor(s / 2);
      c.fillRect(0, wh, s, 1);
      // Brick pattern
      if (v % 2 === 0) {
        c.fillRect(wh, 0, 1, wh);
        c.fillRect(Math.floor(s * 0.25), wh + 1, 1, wh - 1);
        c.fillRect(Math.floor(s * 0.75), wh + 1, 1, wh - 1);
      } else {
        c.fillRect(Math.floor(s * 0.33), 0, 1, wh);
        c.fillRect(Math.floor(s * 0.66), 0, 1, wh);
        c.fillRect(wh, wh + 1, 1, wh - 1);
      }
      // Stone texture (scaled)
      const swP = Math.floor(s * s / 120);
      for (let i = 0; i < swP; i++) {
        c.fillStyle = ['#646464','#5c5c5c','#6a6a6a'][Math.floor(rng() * 3)];
        c.fillRect(1 + Math.floor(rng() * (s - 3)), 1 + Math.floor(rng() * (s - 3)), 1, 1);
      }
      // Dark bottom/right edge
      c.fillStyle = '#383838';
      c.fillRect(0, s - 1, s, 1);
      c.fillRect(s - 1, 0, 1, s);
      break;
    }

    // ===== CHURCH WALL =====
    case T.CHURCH_WALL: {
      c.fillStyle = '#6a6058';
      c.fillRect(0, 0, s, s);
      c.fillStyle = '#7a7068';
      c.fillRect(0, 0, s, Math.max(2, Math.floor(s * 0.08)));
      c.fillStyle = '#504840';
      const cwh = Math.floor(s / 2);
      c.fillRect(0, cwh, s, 1);
      if (v % 2 === 0) { c.fillRect(cwh, 0, 1, cwh); c.fillRect(Math.floor(s * 0.25), cwh + 1, 1, cwh - 1); c.fillRect(Math.floor(s * 0.75), cwh + 1, 1, cwh - 1); }
      else { c.fillRect(Math.floor(s * 0.33), 0, 1, cwh); c.fillRect(Math.floor(s * 0.66), 0, 1, cwh); c.fillRect(cwh, cwh + 1, 1, cwh - 1); }
      // Texture
      const cwTP = Math.floor(s * s / 120);
      for (let i = 0; i < cwTP; i++) {
        c.fillStyle = ['#625848','#6e6454','#5e5444'][Math.floor(rng() * 3)];
        c.fillRect(1 + Math.floor(rng() * (s - 3)), 1 + Math.floor(rng() * (s - 3)), 1, 1);
      }
      c.fillStyle = '#3e3830';
      c.fillRect(0, s - 1, s, 1);
      c.fillRect(s - 1, 0, 1, s);
      break;
    }

    // ===== WINDOW STONE =====
    case T.WINDOW_STONE: {
      c.fillStyle = '#585858';
      c.fillRect(0, 0, s, s);
      // Wall texture
      const wsTP = Math.floor(s * s / 120);
      for (let i = 0; i < wsTP; i++) {
        c.fillStyle = ['#505050','#606060','#565656'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), 1, 1);
      }
      // Window frame (scaled)
      const wsFW = Math.floor(s * 0.6), wsFH = Math.floor(s * 0.65);
      const wsFX = Math.floor(s * 0.2), wsFY = Math.floor(s * 0.12);
      c.fillStyle = '#3a2a18';
      c.fillRect(wsFX, wsFY, wsFW, wsFH);
      // Glass
      c.fillStyle = '#4a80b8';
      c.fillRect(wsFX + 2, wsFY + 2, wsFW - 4, wsFH - 4);
      // Reflection
      c.fillStyle = '#6aa0d0';
      c.fillRect(wsFX + 2, wsFY + 2, Math.floor(wsFW * 0.35), Math.floor(wsFH * 0.3));
      // Cross frame (scaled)
      const wsFrW = Math.max(2, Math.floor(s * 0.06));
      c.fillStyle = '#3a2a18';
      c.fillRect(wsFX + Math.floor(wsFW * 0.45), wsFY, wsFrW, wsFH);
      c.fillRect(wsFX, wsFY + Math.floor(wsFH * 0.45), wsFW, wsFrW);
      break;
    }

    // ===== WINDOW WOOD =====
    case T.WINDOW_WOOD: {
      c.fillStyle = '#6a4828';
      c.fillRect(0, 0, s, s);
      // Wood texture
      const wwTP = Math.floor(s * s / 100);
      for (let i = 0; i < wwTP; i++) {
        c.fillStyle = ['#5a3818','#704020','#624020'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), rng() < 0.3 ? 2 : 1, 1);
      }
      // Frame
      const wwFW = Math.floor(s * 0.6), wwFH = Math.floor(s * 0.65);
      const wwFX = Math.floor(s * 0.2), wwFY = Math.floor(s * 0.12);
      c.fillStyle = '#3a2010';
      c.fillRect(wwFX, wwFY, wwFW, wwFH);
      c.fillStyle = '#6a9ac8';
      c.fillRect(wwFX + 2, wwFY + 2, wwFW - 4, wwFH - 4);
      c.fillStyle = '#80aad8';
      c.fillRect(wwFX + 2, wwFY + 2, Math.floor(wwFW * 0.35), Math.floor(wwFH * 0.3));
      // Cross frame (scaled)
      const wwFrW = Math.max(2, Math.floor(s * 0.06));
      c.fillStyle = '#3a2010';
      c.fillRect(wwFX + Math.floor(wwFW * 0.45), wwFY, wwFrW, wwFH);
      c.fillRect(wwFX, wwFY + Math.floor(wwFH * 0.45), wwFW, wwFrW);
      break;
    }

    // ===== TORCH WALL =====
    case T.TORCH_WALL: {
      c.fillStyle = '#585858';
      c.fillRect(0, 0, s, s);
      // Wall texture
      const twP = Math.floor(s * s / 120);
      for (let i = 0; i < twP; i++) {
        c.fillStyle = ['#505050','#606060','#565656'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), 1, 1);
      }
      // Bracket (scaled)
      const twBW = Math.max(2, Math.floor(s * 0.06));
      c.fillStyle = '#444';
      c.fillRect(Math.floor(s * 0.44), Math.floor(s * 0.42), twBW, Math.floor(s * 0.38));
      // Handle
      c.fillStyle = '#4a3018';
      c.fillRect(Math.floor(s * 0.36), Math.floor(s * 0.36), Math.floor(s * 0.28), twBW);
      // Flame
      c.fillStyle = '#ff6600';
      c.fillRect(Math.floor(s * 0.34), Math.floor(s * 0.16), Math.floor(s * 0.32), Math.floor(s * 0.22));
      c.fillStyle = '#ffcc00';
      c.fillRect(Math.floor(s * 0.38), Math.floor(s * 0.2), Math.floor(s * 0.24), Math.floor(s * 0.14));
      c.fillStyle = '#fff8e0';
      c.fillRect(Math.floor(s * 0.42), Math.floor(s * 0.24), Math.floor(s * 0.16), Math.floor(s * 0.08));
      // Glow
      c.fillStyle = 'rgba(255,140,30,0.08)';
      c.fillRect(0, 0, s, s);
      break;
    }

    // ===== TREE CARVALHO =====
    case T.TREE_CARVALHO: {
      // Grass background
      c.fillStyle = '#3a7a2c';
      c.fillRect(0, 0, s, s);
      const trGP = Math.floor(s * s / 80);
      for (let i = 0; i < trGP; i++) {
        c.fillStyle = ['#367628','#3e7e30','#347224'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.3 ? 2 : 1, 1);
      }
      // Ground shadow
      c.fillStyle = 'rgba(0,0,0,0.15)';
      const trShY = Math.floor(s * 0.68);
      c.fillRect(Math.floor(s * 0.08), trShY, Math.floor(s * 0.84), Math.max(3, Math.floor(s * 0.12)));
      c.fillStyle = 'rgba(0,0,0,0.08)';
      c.fillRect(Math.floor(s * 0.05), trShY - 1, Math.floor(s * 0.9), Math.max(4, Math.floor(s * 0.15)));
      // Trunk
      const trW = Math.max(4, Math.floor(s * 0.18));
      const trH = Math.floor(s * 0.35);
      const trX = Math.floor(s * 0.41), trY = Math.floor(s * 0.42);
      c.fillStyle = '#5a3818';
      c.fillRect(trX, trY, trW, trH);
      c.fillStyle = '#6a4828';
      c.fillRect(trX, trY, Math.floor(trW * 0.5), trH);
      c.fillStyle = '#4a2810';
      c.fillRect(trX + trW - 1, trY, 1, trH);
      // Bark detail
      c.fillStyle = '#503010';
      for (let i = 0; i < Math.floor(trH / 4); i++) {
        c.fillRect(trX + 1, trY + 2 + i * 4, trW - 2, 1);
      }
      // Canopy - large rounded shape with layered green shading
      const canI = Math.max(3, Math.floor(s * 0.1));
      const canX = Math.floor(s * 0.05), canY = Math.floor(s * 0.02);
      const canW = Math.floor(s * 0.9), canH = Math.floor(s * 0.52);
      // Darkest outer layer (rounded)
      c.fillStyle = '#1a5c0e';
      c.fillRect(canX + canI, canY, canW - canI * 2, canH);
      c.fillRect(canX + 1, canY + canI, canW - 2, canH - canI * 2);
      c.fillRect(canX, canY + canI + 1, canW, canH - canI * 2 - 2);
      // Medium green middle
      c.fillStyle = '#226e14';
      c.fillRect(canX + canI + 1, canY + 2, canW - canI * 2 - 2, canH - 4);
      c.fillRect(canX + 3, canY + canI + 1, canW - 6, canH - canI * 2 - 2);
      // Lighter green upper area
      c.fillStyle = '#2e7e1e';
      c.fillRect(canX + canI + 2, canY + 2, canW - canI * 2 - 4, Math.floor(canH * 0.4));
      // Brightest highlight crown
      c.fillStyle = '#3a8e2a';
      c.fillRect(canX + canI + 4, canY + 1, canW - canI * 2 - 8, Math.floor(canH * 0.2));
      // Bottom shadow of canopy
      c.fillStyle = '#0e4208';
      c.fillRect(canX + 3, canY + canH - Math.max(2, Math.floor(s * 0.06)), canW - 6, Math.max(2, Math.floor(s * 0.06)));
      // Leaf texture detail
      for (let i = 0; i < Math.floor(s / 5); i++) {
        c.fillStyle = rng() < 0.5 ? '#0e420a' : '#2e7c1c';
        c.fillRect(canX + canI + Math.floor(rng() * (canW - canI * 2)),
          canY + 2 + Math.floor(rng() * (canH - 4)), 1, 1);
      }
      break;
    }

    // ===== WOOD FLOOR =====
    case T.WOOD_FLOOR: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      // Plank count scales with tile size
      const wfNP = Math.max(3, Math.floor(s / 7));
      // Plank gaps
      c.fillStyle = '#6a4020';
      for (let i = 1; i < wfNP; i++) {
        c.fillRect(0, Math.floor(i * s / wfNP), s, 1);
      }
      // Board end offsets per plank
      for (let i = 0; i < wfNP; i++) {
        const wfOx = Math.floor(rng() * s * 0.5) + Math.floor(s * 0.2);
        c.fillRect(wfOx, Math.floor(i * s / wfNP) + 1, 1, Math.floor(s / wfNP) - 1);
      }
      // Grain texture (scaled)
      const wfP = Math.floor(s * s / 80);
      for (let i = 0; i < wfP; i++) {
        c.fillStyle = ['#8a5828','#a07040','#946030'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), rng() < 0.4 ? 2 : 1, 1);
      }
      // Optional knot
      if (v % 3 === 0) {
        c.fillStyle = '#6a4020';
        const wfKx = 2 + Math.floor(rng() * (s - 4));
        const wfKy = 2 + Math.floor(rng() * (s - 4));
        c.fillRect(wfKx, wfKy, 2, 2);
        c.fillStyle = '#7a5028';
        c.fillRect(wfKx, wfKy, 1, 1);
      }
      break;
    }

    // ===== CHURCH FLOOR =====
    case T.CHURCH_FLOOR: {
      if (v % 2 === 0) {
        c.fillStyle = '#d8d0b8';
        c.fillRect(0, 0, s, s);
        const cf1P = Math.floor(s * s / 80);
        for (let i = 0; i < cf1P; i++) {
          c.fillStyle = ['#d0c8b0','#dcd4bc','#d4ccb4'][Math.floor(rng() * 3)];
          c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), rng() < 0.3 ? 2 : 1, 1);
        }
      } else {
        c.fillStyle = '#b8b098';
        c.fillRect(0, 0, s, s);
        const cf2P = Math.floor(s * s / 80);
        for (let i = 0; i < cf2P; i++) {
          c.fillStyle = ['#b0a890','#bcb49c','#b4ac94'][Math.floor(rng() * 3)];
          c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), rng() < 0.3 ? 2 : 1, 1);
        }
      }
      // Border lines
      c.fillStyle = '#9a9280';
      c.fillRect(0, 0, s, 1); c.fillRect(0, 0, 1, s);
      c.fillRect(s - 1, 0, 1, s); c.fillRect(0, s - 1, s, 1);
      break;
    }

    // ===== RED CARPET =====
    case T.RED_CARPET: {
      c.fillStyle = '#7a1515';
      c.fillRect(0, 0, s, s);
      const rcP = Math.floor(s * s / 80);
      for (let i = 0; i < rcP; i++) {
        c.fillStyle = ['#701010','#841a1a','#781414'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), rng() < 0.3 ? 2 : 1, 1);
      }
      // Gold borders (scaled)
      const rcBW = Math.max(2, Math.floor(s * 0.06));
      c.fillStyle = '#d4a040';
      c.fillRect(0, 0, rcBW, s); c.fillRect(s - rcBW, 0, rcBW, s);
      // Inner line
      c.fillStyle = '#c89838';
      c.fillRect(rcBW + 1, rcBW + 1, s - rcBW * 2 - 2, 1);
      c.fillRect(rcBW + 1, s - rcBW - 2, s - rcBW * 2 - 2, 1);
      break;
    }

    // ===== ALTAR =====
    case T.ALTAR: {
      c.fillStyle = '#d0c8b0';
      c.fillRect(0, 0, s, s);
      // Altar body
      c.fillStyle = '#d8d8d8';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.3), Math.floor(s * 0.8), Math.floor(s * 0.6));
      c.fillStyle = '#eaeaea';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.3), Math.floor(s * 0.8), Math.max(2, Math.floor(s * 0.06)));
      // Gold trim
      c.fillStyle = '#d4a040';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.28), Math.floor(s * 0.8), Math.max(1, Math.floor(s * 0.03)));
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.88), Math.floor(s * 0.8), Math.max(1, Math.floor(s * 0.03)));
      // Candles (scaled)
      const alCW = Math.max(2, Math.floor(s * 0.07));
      for (const acx of [s * 0.18, s * 0.72]) {
        c.fillStyle = '#f0e8c0';
        c.fillRect(Math.floor(acx), Math.floor(s * 0.12), alCW, Math.floor(s * 0.2));
        c.fillStyle = '#ffcc00';
        c.fillRect(Math.floor(acx), Math.floor(s * 0.08), alCW, Math.max(3, Math.floor(s * 0.08)));
        c.fillStyle = '#fff8e0';
        c.fillRect(Math.floor(acx) + 1, Math.floor(s * 0.09), alCW - 2, Math.max(1, Math.floor(s * 0.04)));
      }
      break;
    }

    // ===== CROSS =====
    case T.CROSS: {
      c.fillStyle = '#d0c8b0';
      c.fillRect(0, 0, s, s);
      const crW = Math.max(2, Math.floor(s * 0.07));
      c.fillStyle = '#d4a040';
      c.fillRect(Math.floor(s * 0.46) - Math.floor(crW / 2), Math.floor(s * 0.06), crW, Math.floor(s * 0.82));
      c.fillRect(Math.floor(s * 0.22), Math.floor(s * 0.18), Math.floor(s * 0.56), crW);
      c.fillStyle = '#e4b858';
      c.fillRect(Math.floor(s * 0.46) - Math.floor(crW / 2), Math.floor(s * 0.06), crW, 1);
      c.fillRect(Math.floor(s * 0.22), Math.floor(s * 0.18), Math.floor(s * 0.56), 1);
      break;
    }

    // ===== CHURCH PEW =====
    case T.CHURCH_PEW: {
      c.fillStyle = '#d0c8b0';
      c.fillRect(0, 0, s, s);
      c.fillStyle = '#9a9280'; c.fillRect(0, 0, s, 1); c.fillRect(0, 0, 1, s);
      // Bench
      c.fillStyle = '#4a2510';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.3), Math.floor(s * 0.8), Math.floor(s * 0.45));
      c.fillStyle = '#603818';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.15), Math.floor(s * 0.8), Math.floor(s * 0.17));
      // Highlight
      c.fillStyle = '#704828';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.15), Math.floor(s * 0.8), Math.max(2, Math.floor(s * 0.06)));
      // Legs (scaled)
      const cpLW = Math.max(2, Math.floor(s * 0.07));
      c.fillStyle = '#3a1808';
      c.fillRect(Math.floor(s * 0.14), Math.floor(s * 0.75), cpLW, Math.floor(s * 0.14));
      c.fillRect(Math.floor(s * 0.82) - cpLW + 2, Math.floor(s * 0.75), cpLW, Math.floor(s * 0.14));
      break;
    }

    // ===== ANVIL =====
    case T.ANVIL: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      const avP = Math.floor(s * s / 80);
      for (let i = 0; i < avP; i++) {
        c.fillStyle = ['#8a5828','#a07040','#946030'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), rng() < 0.4 ? 2 : 1, 1);
      }
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fillRect(Math.floor(s * 0.16), Math.floor(s * 0.78), Math.floor(s * 0.68), Math.max(2, Math.floor(s * 0.06)));
      // Base
      c.fillStyle = '#333';
      c.fillRect(Math.floor(s * 0.26), Math.floor(s * 0.58), Math.floor(s * 0.48), Math.floor(s * 0.24));
      // Top (anvil surface)
      c.fillStyle = '#4a4a4a';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.38), Math.floor(s * 0.8), Math.floor(s * 0.22));
      c.fillStyle = '#606060';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.38), Math.floor(s * 0.8), Math.max(2, Math.floor(s * 0.06)));
      // Horn
      c.fillStyle = '#484848';
      c.fillRect(Math.floor(s * 0.04), Math.floor(s * 0.42), Math.floor(s * 0.1), Math.floor(s * 0.14));
      break;
    }

    // ===== FURNACE =====
    case T.FURNACE: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      // Body
      c.fillStyle = '#3a2828';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.08), Math.floor(s * 0.8), Math.floor(s * 0.84));
      c.fillStyle = '#4a3838';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.08), Math.floor(s * 0.8), 2);
      // Fire opening
      c.fillStyle = '#141414';
      c.fillRect(Math.floor(s * 0.24), Math.floor(s * 0.45), Math.floor(s * 0.52), Math.floor(s * 0.38));
      // Fire
      c.fillStyle = '#cc3300';
      c.fillRect(Math.floor(s * 0.28), Math.floor(s * 0.58), Math.floor(s * 0.44), Math.floor(s * 0.2));
      c.fillStyle = '#ff8800';
      c.fillRect(Math.floor(s * 0.32), Math.floor(s * 0.6), Math.floor(s * 0.36), Math.floor(s * 0.14));
      c.fillStyle = '#ffcc00';
      c.fillRect(Math.floor(s * 0.38), Math.floor(s * 0.64), Math.floor(s * 0.24), Math.floor(s * 0.08));
      break;
    }

    // ===== BOOKSHELF =====
    case T.BOOKSHELF: {
      c.fillStyle = '#d0c8b0';
      c.fillRect(0, 0, s, s);
      // Frame
      c.fillStyle = '#3a2008';
      c.fillRect(Math.floor(s * 0.08), Math.floor(s * 0.06), Math.floor(s * 0.84), Math.floor(s * 0.88));
      // 3 shelves
      for (const sy of [0.32, 0.58, 0.84]) {
        c.fillStyle = '#4a3018';
        c.fillRect(Math.floor(s * 0.08), Math.floor(s * sy), Math.floor(s * 0.84), 1);
      }
      // Books
      const bCol = ['#8b1818','#18408b','#186828','#8b6818','#681868'];
      for (let row = 0; row < 3; row++) {
        const rowY = Math.floor(s * (0.08 + row * 0.26));
        const rowH = Math.floor(s * 0.22);
        let bx = Math.floor(s * 0.12);
        while (bx < s * 0.88) {
          const bw = Math.floor(rng() * 2) + 2;
          c.fillStyle = bCol[Math.floor(rng() * bCol.length)];
          c.fillRect(bx, rowY, bw, rowH);
          bx += bw + 1;
        }
      }
      break;
    }

    // ===== TABLE =====
    case T.TABLE: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      const tbP = Math.floor(s * s / 80);
      for (let i = 0; i < tbP; i++) {
        c.fillStyle = ['#8a5828','#a07040','#946030'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), rng() < 0.4 ? 2 : 1, 1);
      }
      // Surface
      c.fillStyle = '#6a4020';
      c.fillRect(Math.floor(s * 0.08), Math.floor(s * 0.25), Math.floor(s * 0.84), Math.floor(s * 0.5));
      c.fillStyle = '#7a5030';
      c.fillRect(Math.floor(s * 0.08), Math.floor(s * 0.25), Math.floor(s * 0.84), Math.max(2, Math.floor(s * 0.06)));
      // Legs (scaled)
      const tbLW = Math.max(2, Math.floor(s * 0.07));
      c.fillStyle = '#4a2810';
      c.fillRect(Math.floor(s * 0.12), Math.floor(s * 0.78), tbLW, Math.floor(s * 0.18));
      c.fillRect(Math.floor(s * 0.84) - tbLW + 2, Math.floor(s * 0.78), tbLW, Math.floor(s * 0.18));
      break;
    }

    // ===== CHAIR =====
    case T.CHAIR: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      const chP = Math.floor(s * s / 80);
      for (let i = 0; i < chP; i++) {
        c.fillStyle = ['#8a5828','#a07040','#946030'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), rng() < 0.4 ? 2 : 1, 1);
      }
      // Back
      c.fillStyle = '#4a2510';
      c.fillRect(Math.floor(s * 0.22), Math.floor(s * 0.12), Math.floor(s * 0.56), Math.floor(s * 0.28));
      c.fillStyle = '#5a3518';
      c.fillRect(Math.floor(s * 0.22), Math.floor(s * 0.12), Math.floor(s * 0.56), Math.max(2, Math.floor(s * 0.06)));
      // Seat
      c.fillStyle = '#5a3518';
      c.fillRect(Math.floor(s * 0.2), Math.floor(s * 0.44), Math.floor(s * 0.6), Math.floor(s * 0.14));
      // Legs (scaled)
      const chLW = Math.max(2, Math.floor(s * 0.07));
      c.fillStyle = '#3a1808';
      c.fillRect(Math.floor(s * 0.24), Math.floor(s * 0.58), chLW, Math.floor(s * 0.32));
      c.fillRect(Math.floor(s * 0.72) - chLW + 2, Math.floor(s * 0.58), chLW, Math.floor(s * 0.32));
      break;
    }

    // ===== BED =====
    case T.BED: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      // Frame
      c.fillStyle = '#4a2510';
      c.fillRect(Math.floor(s * 0.06), Math.floor(s * 0.14), Math.floor(s * 0.88), Math.floor(s * 0.76));
      // Frame highlight
      c.fillStyle = '#5a3518';
      c.fillRect(Math.floor(s * 0.06), Math.floor(s * 0.14), Math.floor(s * 0.88), Math.max(2, Math.floor(s * 0.06)));
      // Mattress
      c.fillStyle = '#e0d8c0';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.2), Math.floor(s * 0.8), Math.floor(s * 0.64));
      // Blanket
      c.fillStyle = '#7a1515';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.48), Math.floor(s * 0.8), Math.floor(s * 0.36));
      c.fillStyle = '#8a2525';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.48), Math.floor(s * 0.8), Math.max(2, Math.floor(s * 0.06)));
      // Blanket fold
      c.fillStyle = '#6a0e0e';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.82), Math.floor(s * 0.8), Math.max(1, Math.floor(s * 0.03)));
      // Pillow
      c.fillStyle = '#f0ead8';
      c.fillRect(Math.floor(s * 0.14), Math.floor(s * 0.22), Math.floor(s * 0.3), Math.floor(s * 0.2));
      c.fillStyle = '#e8e0d0';
      c.fillRect(Math.floor(s * 0.14), Math.floor(s * 0.36), Math.floor(s * 0.3), Math.max(1, Math.floor(s * 0.03)));
      break;
    }

    // ===== RUG =====
    case T.RUG: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      c.fillStyle = '#6a1818';
      c.fillRect(1, 1, s - 2, s - 2);
      const rgP = Math.floor(s * s / 80);
      for (let i = 0; i < rgP; i++) {
        c.fillStyle = ['#601010','#701818','#681414'][Math.floor(rng() * 3)];
        c.fillRect(2 + Math.floor(rng() * (s - 4)), 2 + Math.floor(rng() * (s - 4)), rng() < 0.3 ? 2 : 1, 1);
      }
      // Gold borders (scaled)
      const rgBW = Math.max(1, Math.floor(s * 0.06));
      c.fillStyle = '#d4a040';
      c.fillRect(1, 1, s - 2, rgBW); c.fillRect(1, s - 1 - rgBW, s - 2, rgBW);
      c.fillRect(1, 1, rgBW, s - 2); c.fillRect(s - 1 - rgBW, 1, rgBW, s - 2);
      break;
    }

    // ===== BARREL =====
    case T.BARREL: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      const brP = Math.floor(s * s / 80);
      for (let i = 0; i < brP; i++) {
        c.fillStyle = ['#8a5828','#a07040','#946030'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), rng() < 0.4 ? 2 : 1, 1);
      }
      c.fillStyle = 'rgba(0,0,0,0.1)';
      c.fillRect(Math.floor(s * 0.12), Math.floor(s * 0.82), Math.floor(s * 0.76), Math.max(2, Math.floor(s * 0.06)));
      // Body
      c.fillStyle = '#5a3818';
      c.fillRect(Math.floor(s * 0.18), Math.floor(s * 0.1), Math.floor(s * 0.64), Math.floor(s * 0.74));
      c.fillRect(Math.floor(s * 0.14), Math.floor(s * 0.28), Math.floor(s * 0.72), Math.floor(s * 0.38));
      // Staves
      c.fillStyle = '#4a2c10';
      for (const stX of [0.26, 0.38, 0.5, 0.62]) {
        c.fillRect(Math.floor(s * stX), Math.floor(s * 0.12), 1, Math.floor(s * 0.7));
      }
      // Metal rings (scaled)
      const brRH = Math.max(2, Math.floor(s * 0.05));
      c.fillStyle = '#606060';
      c.fillRect(Math.floor(s * 0.16), Math.floor(s * 0.2), Math.floor(s * 0.68), brRH);
      c.fillRect(Math.floor(s * 0.16), Math.floor(s * 0.72), Math.floor(s * 0.68), brRH);
      // Ring highlights
      c.fillStyle = '#808080';
      c.fillRect(Math.floor(s * 0.16), Math.floor(s * 0.2), Math.floor(s * 0.68), 1);
      c.fillRect(Math.floor(s * 0.16), Math.floor(s * 0.72), Math.floor(s * 0.68), 1);
      break;
    }

    // ===== CRATE =====
    case T.CRATE: {
      c.fillStyle = '#9a6838';
      c.fillRect(0, 0, s, s);
      // Body
      c.fillStyle = '#7a5830';
      c.fillRect(Math.floor(s * 0.14), Math.floor(s * 0.14), Math.floor(s * 0.72), Math.floor(s * 0.72));
      c.fillStyle = '#8a6840';
      c.fillRect(Math.floor(s * 0.14), Math.floor(s * 0.14), Math.floor(s * 0.72), 2);
      // Cross
      c.fillStyle = '#5a3818';
      c.fillRect(Math.floor(s * 0.14), Math.floor(s * 0.48), Math.floor(s * 0.72), 1);
      c.fillRect(Math.floor(s * 0.48), Math.floor(s * 0.14), 1, Math.floor(s * 0.72));
      // Nails
      c.fillStyle = '#aaa';
      c.fillRect(Math.floor(s * 0.48), Math.floor(s * 0.48), 1, 1);
      break;
    }

    // ===== WELL =====
    case T.WELL: {
      c.fillStyle = '#858585';
      c.fillRect(0, 0, s, s);
      // Texture
      const wlP = Math.floor(s * s / 100);
      for (let i = 0; i < wlP; i++) {
        c.fillStyle = ['#7a7a7a','#909090','#808080'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), 1, 1);
      }
      // Stone wall
      c.fillStyle = '#5a5a5a';
      c.fillRect(Math.floor(s * 0.08), Math.floor(s * 0.26), Math.floor(s * 0.84), Math.floor(s * 0.66));
      c.fillStyle = '#6a6a6a';
      c.fillRect(Math.floor(s * 0.08), Math.floor(s * 0.26), Math.floor(s * 0.84), Math.max(2, Math.floor(s * 0.06)));
      // Water
      c.fillStyle = '#1a4a90';
      c.fillRect(Math.floor(s * 0.18), Math.floor(s * 0.38), Math.floor(s * 0.64), Math.floor(s * 0.42));
      c.fillStyle = '#2a5aa0';
      c.fillRect(Math.floor(s * 0.18), Math.floor(s * 0.38), Math.floor(s * 0.64), Math.max(2, Math.floor(s * 0.06)));
      // Posts (scaled)
      const wlPW = Math.max(2, Math.floor(s * 0.07));
      c.fillStyle = '#4a3018';
      c.fillRect(Math.floor(s * 0.12), Math.floor(s * 0.06), wlPW, Math.floor(s * 0.52));
      c.fillRect(Math.floor(s * 0.82), Math.floor(s * 0.06), wlPW, Math.floor(s * 0.52));
      // Post highlights
      c.fillStyle = '#5a4028';
      c.fillRect(Math.floor(s * 0.12), Math.floor(s * 0.06), 1, Math.floor(s * 0.52));
      c.fillRect(Math.floor(s * 0.82), Math.floor(s * 0.06), 1, Math.floor(s * 0.52));
      // Roof beam (scaled)
      const wlBH = Math.max(2, Math.floor(s * 0.06));
      c.fillStyle = '#5a3818';
      c.fillRect(Math.floor(s * 0.08), Math.floor(s * 0.04), Math.floor(s * 0.84), wlBH);
      break;
    }

    // ===== FENCE =====
    case T.FENCE: {
      // Grass background
      c.fillStyle = '#3a7a2c';
      c.fillRect(0, 0, s, s);
      const fnGP = Math.floor(s * s / 80);
      for (let i = 0; i < fnGP; i++) {
        c.fillStyle = ['#367628','#3e7e30','#347224'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.3 ? 2 : 1, 1);
      }
      // Posts (scaled thickness)
      const fnPW = Math.max(2, Math.floor(s * 0.09));
      c.fillStyle = '#4a2810';
      c.fillRect(Math.floor(s * 0.08), Math.floor(s * 0.15), fnPW, Math.floor(s * 0.75));
      c.fillRect(Math.floor(s * 0.84), Math.floor(s * 0.15), fnPW, Math.floor(s * 0.75));
      // Post highlights
      c.fillStyle = '#6a4828';
      c.fillRect(Math.floor(s * 0.08), Math.floor(s * 0.15), 1, Math.floor(s * 0.75));
      c.fillRect(Math.floor(s * 0.84), Math.floor(s * 0.15), 1, Math.floor(s * 0.75));
      // Rails (scaled height)
      const fnRH = Math.max(2, Math.floor(s * 0.08));
      c.fillStyle = '#5a3818';
      c.fillRect(0, Math.floor(s * 0.3), s, fnRH);
      c.fillRect(0, Math.floor(s * 0.58), s, fnRH);
      // Rail highlights
      c.fillStyle = '#7a5830';
      c.fillRect(0, Math.floor(s * 0.3), s, 1);
      c.fillRect(0, Math.floor(s * 0.58), s, 1);
      break;
    }

    // ===== WOOD WALL =====
    case T.WOOD_WALL: {
      c.fillStyle = '#5a3818';
      c.fillRect(0, 0, s, s);
      // Top highlight
      c.fillStyle = '#6a4828';
      c.fillRect(0, 0, s, Math.max(2, Math.floor(s * 0.08)));
      // Plank lines (3 horizontal sections)
      c.fillStyle = '#3a2008';
      c.fillRect(0, Math.floor(s * 0.33), s, 1);
      c.fillRect(0, Math.floor(s * 0.66), s, 1);
      // Board joints (offset per variant)
      const wwBoardOff = v % 2 === 0;
      c.fillRect(Math.floor(s * (wwBoardOff ? 0.5 : 0.35)), 0, 1, Math.floor(s * 0.33));
      c.fillRect(Math.floor(s * (wwBoardOff ? 0.3 : 0.65)), Math.floor(s * 0.34), 1, Math.floor(s * 0.32));
      c.fillRect(Math.floor(s * (wwBoardOff ? 0.7 : 0.45)), Math.floor(s * 0.67), 1, Math.floor(s * 0.33));
      // Wood grain texture (scaled)
      const wwP = Math.floor(s * s / 80);
      for (let i = 0; i < wwP; i++) {
        c.fillStyle = ['#503010','#624020','#5a3818'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), rng() < 0.3 ? 2 : 1, 1);
      }
      // Dark bottom/right edge
      c.fillStyle = '#2a1808';
      c.fillRect(0, s - 1, s, 1);
      c.fillRect(s - 1, 0, 1, s);
      break;
    }

    // ===== SAND =====
    case T.SAND: {
      c.fillStyle = '#c8b478';
      c.fillRect(0, 0, s, s);
      // Sandy texture (scaled)
      const sdShades = ['#c4b074','#ccb87c','#c0ac70','#cab680','#c6b276'];
      const sdP = Math.floor(s * s / 60);
      for (let i = 0; i < sdP; i++) {
        c.fillStyle = sdShades[Math.floor(rng() * sdShades.length)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.4 ? 2 : 1, 1);
      }
      // Sand ripple line
      if (v % 3 === 0) {
        c.fillStyle = '#d8c890';
        const sdRy = 5 + Math.floor(rng() * (s - 10));
        for (let px = 0; px < s; px++) {
          if (rng() < 0.6) c.fillRect(px, sdRy, 1, 1);
        }
      }
      // Grain detail
      if (v % 4 < 2) {
        c.fillStyle = '#b8a060';
        c.fillRect(1 + Math.floor(rng() * (s - 3)), 1 + Math.floor(rng() * (s - 3)), 2, 1);
      }
      break;
    }

    // ===== GRAVESTONE =====
    case T.GRAVESTONE: {
      // Dark dirt ground
      c.fillStyle = '#5a4a35';
      c.fillRect(0, 0, s, s);
      const gsGP = Math.floor(s * s / 70);
      for (let i = 0; i < gsGP; i++) {
        c.fillStyle = ['#504030','#5e4e3a','#584838'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.3 ? 2 : 1, 1);
      }
      // Ground shadow
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fillRect(Math.floor(s * 0.18), Math.floor(s * 0.78), Math.floor(s * 0.64), Math.max(2, Math.floor(s * 0.06)));
      // Gravestone body
      c.fillStyle = '#6a6a6a';
      c.fillRect(Math.floor(s * 0.22), Math.floor(s * 0.28), Math.floor(s * 0.56), Math.floor(s * 0.55));
      // Rounded top
      c.fillRect(Math.floor(s * 0.28), Math.floor(s * 0.18), Math.floor(s * 0.44), Math.floor(s * 0.12));
      // Highlight left
      c.fillStyle = '#808080';
      c.fillRect(Math.floor(s * 0.22), Math.floor(s * 0.28), Math.max(2, Math.floor(s * 0.06)), Math.floor(s * 0.5));
      c.fillRect(Math.floor(s * 0.28), Math.floor(s * 0.18), Math.floor(s * 0.44), Math.max(2, Math.floor(s * 0.06)));
      // Shadow right
      c.fillStyle = '#585858';
      c.fillRect(Math.floor(s * 0.72), Math.floor(s * 0.28), Math.max(2, Math.floor(s * 0.06)), Math.floor(s * 0.5));
      // Cross engraving
      const gsLW = Math.max(2, Math.floor(s * 0.06));
      c.fillStyle = '#555555';
      c.fillRect(Math.floor(s * 0.44), Math.floor(s * 0.24), gsLW, Math.floor(s * 0.35));
      c.fillRect(Math.floor(s * 0.34), Math.floor(s * 0.34), Math.floor(s * 0.32), gsLW);
      break;
    }

    // ===== DEAD TREE =====
    case T.DEAD_TREE: {
      // Dark dirt ground
      c.fillStyle = '#5a4a35';
      c.fillRect(0, 0, s, s);
      const dtGP = Math.floor(s * s / 70);
      for (let i = 0; i < dtGP; i++) {
        c.fillStyle = ['#504030','#5e4e3a','#584838'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.3 ? 2 : 1, 1);
      }
      // Ground shadow
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.8), Math.floor(s * 0.8), Math.max(2, Math.floor(s * 0.06)));
      // Trunk (scaled width)
      const dtTW = Math.max(3, Math.floor(s * 0.16));
      c.fillStyle = '#2e1a08';
      c.fillRect(Math.floor(s * 0.42), Math.floor(s * 0.35), dtTW, Math.floor(s * 0.5));
      // Trunk highlight
      c.fillStyle = '#3e2a18';
      c.fillRect(Math.floor(s * 0.42), Math.floor(s * 0.35), Math.floor(dtTW * 0.4), Math.floor(s * 0.5));
      // Branches (scaled thickness)
      const dtBH = Math.max(2, Math.floor(s * 0.06));
      c.fillStyle = '#2e1a08';
      c.fillRect(Math.floor(s * 0.15), Math.floor(s * 0.22), Math.floor(s * 0.28), dtBH);
      c.fillRect(Math.floor(s * 0.56), Math.floor(s * 0.18), Math.floor(s * 0.3), dtBH);
      c.fillRect(Math.floor(s * 0.44), Math.floor(s * 0.06), dtBH, Math.floor(s * 0.3));
      c.fillRect(Math.floor(s * 0.18), Math.floor(s * 0.04), Math.floor(s * 0.16), dtBH);
      c.fillRect(Math.floor(s * 0.72), Math.floor(s * 0.04), Math.floor(s * 0.14), dtBH);
      // Tilted branch ends
      c.fillRect(Math.floor(s * 0.14), Math.floor(s * 0.2), dtBH, dtBH);
      c.fillRect(Math.floor(s * 0.84), Math.floor(s * 0.16), dtBH, dtBH);
      break;
    }

    // ===== BONE =====
    case T.BONE: {
      c.fillStyle = '#7a6040';
      c.fillRect(0, 0, s, s);
      const bnGP = Math.floor(s * s / 70);
      for (let i = 0; i < bnGP; i++) {
        c.fillStyle = ['#6a5030','#846c48','#725838'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.3 ? 2 : 1, 1);
      }
      // Bone shaft (scaled)
      const bnH = Math.max(2, Math.floor(s * 0.08));
      c.fillStyle = '#e0d8c0';
      c.fillRect(Math.floor(s * 0.18), Math.floor(s * 0.44), Math.floor(s * 0.64), bnH);
      // Bone ends (knobs)
      c.fillRect(Math.floor(s * 0.14), Math.floor(s * 0.38), Math.max(3, Math.floor(s * 0.1)), Math.floor(s * 0.18));
      c.fillRect(Math.floor(s * 0.76), Math.floor(s * 0.38), Math.max(3, Math.floor(s * 0.1)), Math.floor(s * 0.18));
      // Highlight
      c.fillStyle = '#f0e8d0';
      c.fillRect(Math.floor(s * 0.2), Math.floor(s * 0.44), Math.floor(s * 0.6), 1);
      break;
    }

    // ===== MUD =====
    case T.MUD: {
      c.fillStyle = '#504020';
      c.fillRect(0, 0, s, s);
      const mdGP = Math.floor(s * s / 50);
      for (let i = 0; i < mdGP; i++) {
        c.fillStyle = ['#453518','#5a4a28','#483a1c','#524020'][Math.floor(rng() * 4)];
        c.fillRect(Math.floor(rng() * (s - 1)), Math.floor(rng() * (s - 1)),
          rng() < 0.4 ? 2 : 1, rng() < 0.3 ? 2 : 1);
      }
      // Puddle
      if (v % 2 === 0) {
        c.fillStyle = '#3a2c10';
        const mdPx = Math.floor(rng() * s * 0.3) + 3;
        const mdPy = Math.floor(rng() * s * 0.3) + 3;
        c.fillRect(mdPx, mdPy, Math.floor(s * 0.35), Math.floor(s * 0.2));
        c.fillStyle = '#443418';
        c.fillRect(mdPx + 1, mdPy, Math.floor(s * 0.33), 1);
      }
      break;
    }

    // ===== HAY =====
    case T.HAY: {
      c.fillStyle = '#5a4020';
      c.fillRect(0, 0, s, s);
      c.fillStyle = 'rgba(0,0,0,0.1)';
      c.fillRect(Math.floor(s * 0.1), Math.floor(s * 0.78), Math.floor(s * 0.8), Math.max(2, Math.floor(s * 0.06)));
      // Bale body
      c.fillStyle = '#b89030';
      c.fillRect(Math.floor(s * 0.08), Math.floor(s * 0.16), Math.floor(s * 0.84), Math.floor(s * 0.66));
      c.fillStyle = '#c8a040';
      c.fillRect(Math.floor(s * 0.08), Math.floor(s * 0.16), Math.floor(s * 0.84), Math.max(2, Math.floor(s * 0.06)));
      // Straw lines (scaled)
      c.fillStyle = '#907020';
      c.fillRect(Math.floor(s * 0.08), Math.floor(s * 0.36), Math.floor(s * 0.84), 1);
      c.fillRect(Math.floor(s * 0.08), Math.floor(s * 0.54), Math.floor(s * 0.84), 1);
      // Straw texture
      const hyP = Math.floor(s * s / 100);
      for (let i = 0; i < hyP; i++) {
        c.fillStyle = rng() < 0.5 ? '#a88028' : '#c09838';
        c.fillRect(Math.floor(s * 0.1 + rng() * s * 0.8), Math.floor(s * 0.18 + rng() * s * 0.6), rng() < 0.3 ? 2 : 1, 1);
      }
      // Rope (scaled)
      const hyRW = Math.max(2, Math.floor(s * 0.06));
      c.fillStyle = '#5a3810';
      c.fillRect(Math.floor(s * 0.47), Math.floor(s * 0.16), hyRW, Math.floor(s * 0.66));
      break;
    }

    // ===== ROOF STONE =====
    case T.ROOF_STONE: {
      c.fillStyle = '#585858';
      c.fillRect(0, 0, s, s);
      // Shingle rows (scaled count)
      const rsRows = Math.max(4, Math.floor(s / 8));
      c.fillStyle = '#484848';
      for (let i = 0; i < rsRows; i++) c.fillRect(0, Math.floor(i * s / rsRows), s, 1);
      for (let row = 0; row < rsRows; row++) {
        const rsOff = row % 2 === 0 ? 0 : Math.floor(s * 0.25);
        for (let col = rsOff; col < s; col += Math.floor(s * 0.5)) {
          c.fillRect(col, Math.floor(row * s / rsRows), 1, Math.floor(s / rsRows));
        }
      }
      // Texture
      const rsP = Math.floor(s * s / 100);
      for (let i = 0; i < rsP; i++) {
        c.fillStyle = ['#505050','#606060','#545454'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), 1, 1);
      }
      c.fillStyle = '#686868';
      c.fillRect(0, 0, s, 1);
      break;
    }

    // ===== ROOF WOOD =====
    case T.ROOF_WOOD: {
      c.fillStyle = '#6a3818';
      c.fillRect(0, 0, s, s);
      const rwRows = Math.max(4, Math.floor(s / 8));
      c.fillStyle = '#4a2008';
      for (let i = 0; i < rwRows; i++) c.fillRect(0, Math.floor(i * s / rwRows), s, 1);
      for (let row = 0; row < rwRows; row++) {
        const rwOff = row % 2 === 0 ? 0 : Math.floor(s * 0.25);
        for (let col = rwOff; col < s; col += Math.floor(s * 0.5)) {
          c.fillRect(col, Math.floor(row * s / rwRows), 1, Math.floor(s / rwRows));
        }
      }
      // Texture
      const rwP = Math.floor(s * s / 100);
      for (let i = 0; i < rwP; i++) {
        c.fillStyle = ['#5a2810','#744020','#623018'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), 1, 1);
      }
      c.fillStyle = '#7a4828';
      c.fillRect(0, 0, s, 1);
      break;
    }

    // ===== ROOF RED =====
    case T.ROOF_RED: {
      c.fillStyle = '#8b1a1a';
      c.fillRect(0, 0, s, s);
      const rrRows = Math.max(4, Math.floor(s / 8));
      c.fillStyle = '#6a0a0a';
      for (let i = 0; i < rrRows; i++) c.fillRect(0, Math.floor(i * s / rrRows), s, 1);
      for (let row = 0; row < rrRows; row++) {
        const rrOff = row % 2 === 0 ? 0 : Math.floor(s * 0.25);
        for (let col = rrOff; col < s; col += Math.floor(s * 0.5)) {
          c.fillRect(col, Math.floor(row * s / rrRows), 1, Math.floor(s / rrRows));
        }
      }
      const rrP = Math.floor(s * s / 100);
      for (let i = 0; i < rrP; i++) {
        c.fillStyle = ['#7b1212','#9b2222','#851818'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), 1, 1);
      }
      c.fillStyle = '#a52a2a';
      c.fillRect(0, 0, s, 1);
      break;
    }

    // ===== ROOF BLUE =====
    case T.ROOF_BLUE: {
      c.fillStyle = '#1a3a7a';
      c.fillRect(0, 0, s, s);
      const rbRows = Math.max(4, Math.floor(s / 8));
      c.fillStyle = '#0a2a5a';
      for (let i = 0; i < rbRows; i++) c.fillRect(0, Math.floor(i * s / rbRows), s, 1);
      for (let row = 0; row < rbRows; row++) {
        const rbOff = row % 2 === 0 ? 0 : Math.floor(s * 0.25);
        for (let col = rbOff; col < s; col += Math.floor(s * 0.5)) {
          c.fillRect(col, Math.floor(row * s / rbRows), 1, Math.floor(s / rbRows));
        }
      }
      const rbP = Math.floor(s * s / 100);
      for (let i = 0; i < rbP; i++) {
        c.fillStyle = ['#153570','#1f4585','#1a3a78'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), 1, 1);
      }
      c.fillStyle = '#2a4a8a';
      c.fillRect(0, 0, s, 1);
      break;
    }

    // ===== ROOF YELLOW =====
    case T.ROOF_YELLOW: {
      c.fillStyle = '#b89020';
      c.fillRect(0, 0, s, s);
      const ryRows = Math.max(4, Math.floor(s / 8));
      c.fillStyle = '#987010';
      for (let i = 0; i < ryRows; i++) c.fillRect(0, Math.floor(i * s / ryRows), s, 1);
      for (let row = 0; row < ryRows; row++) {
        const ryOff = row % 2 === 0 ? 0 : Math.floor(s * 0.25);
        for (let col = ryOff; col < s; col += Math.floor(s * 0.5)) {
          c.fillRect(col, Math.floor(row * s / ryRows), 1, Math.floor(s / ryRows));
        }
      }
      const ryP = Math.floor(s * s / 100);
      for (let i = 0; i < ryP; i++) {
        c.fillStyle = ['#a88018','#c8a028','#b08820'][Math.floor(rng() * 3)];
        c.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), 1, 1);
      }
      c.fillStyle = '#c8a030';
      c.fillRect(0, 0, s, 1);
      break;
    }

    // ===== BENCH =====
    case T.BENCH: {
      // Draw grass base first
      c.fillStyle = '#3a7a2d';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#347228','#3e8232'], 0.1, rng);
      // Bench seat
      const bw = Math.floor(s * 0.8);
      const bh = Math.floor(s * 0.3);
      const bx = Math.floor((s - bw) / 2);
      const by = Math.floor(s * 0.35);
      c.fillStyle = '#7a5a30';
      c.fillRect(bx, by, bw, bh);
      c.fillStyle = '#5a3a18';
      c.fillRect(bx, by + bh - 1, bw, 1);
      // Legs
      const lw = Math.floor(s * 0.08) || 1;
      c.fillStyle = '#4a2a10';
      c.fillRect(bx + Math.floor(bw * 0.15), by + bh, lw, Math.floor(s * 0.2));
      c.fillRect(bx + Math.floor(bw * 0.75), by + bh, lw, Math.floor(s * 0.2));
      // Back rest
      c.fillStyle = '#8a6a38';
      c.fillRect(bx, by - Math.floor(s * 0.12), bw, Math.floor(s * 0.12));
      break;
    }

    // ===== DEFAULT =====
    default: {
      c.fillStyle = '#3a7a2d';
      c.fillRect(0, 0, s, s);
      fillNoise(c, 0, 0, s, s, ['#347228','#3e8232'], 0.1, rng);
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
  // Portals
  mapPortals = data.portals || [];
  // Load image objects
  mapObjects = data.objects || [];
  loadMapObjectImages();
  // Load per-cell solid grid
  solidCellSet = new Set(data.solidCells || []);
  // Load per-cell behind grid
  behindCellSet = new Set(data.behindCells || []);
  // Reset user zoom on map change so auto-scale works for small maps
  userZoom = null;
  // Clear other players interpolation cache on map change
  otherPlayersCache = {};
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
  // Update other players with interpolation targets
  const newPlayers = data.players || {};
  for (const [id, op] of Object.entries(newPlayers)) {
    if (!otherPlayersCache[id]) {
      // First time seeing this player — snap to position
      otherPlayersCache[id] = {
        x: op.x, y: op.y,
        targetX: op.x, targetY: op.y,
        animFrame: 0, animTimer: 0
      };
    } else {
      // Set interpolation target
      otherPlayersCache[id].targetX = op.x;
      otherPlayersCache[id].targetY = op.y;
    }
  }
  // Remove players that are no longer nearby
  for (const id of Object.keys(otherPlayersCache)) {
    if (!newPlayers[id]) delete otherPlayersCache[id];
  }
  otherPlayers = newPlayers;
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
  const current = userZoom !== null ? userZoom : TILE_SIZE;
  if (e.deltaY < 0) {
    userZoom = Math.min(TILE_SIZE_MAX, current + 4);
  } else {
    userZoom = Math.max(TILE_SIZE_MIN, current - 4);
  }
  TILE_SIZE = userZoom;
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
  const fx = Math.floor(tx), fy = Math.floor(ty);
  if (fy >= gameMap.length || fx >= (gameMap[0] || []).length) return true;
  if (BLOCKED.has(gameMap[fy][fx])) return true;
  // Tree tiles also block the tile above them (because trees are 2 tiles tall visually)
  if (fy + 1 < mapHeight && fy + 1 < gameMap.length && TREE_TILE_TYPES.has(gameMap[fy + 1][fx])) return true;
  // Check per-cell solid grid (from editor collision tool)
  if (solidCellSet.has(`${fx},${fy}`)) return true;
  return false;
}

function canMoveTo(x, y) {
  // Hitbox ~0.6 tile centrada no personagem
  const pad = 0.3;
  const left = x - pad, right = x + pad;
  const top = y - pad, bottom = y + pad;
  return !isBlocked(left, top) && !isBlocked(right, top)
    && !isBlocked(left, bottom) && !isBlocked(right, bottom);
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

    // Try move X then Y separately (wall sliding)
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

  // Other players interpolation & animation
  for (const [id, op] of Object.entries(otherPlayers)) {
    const cache = otherPlayersCache[id];
    if (!cache) continue;
    // Smooth interpolation towards target position
    const lerpSpeed = 0.25;
    cache.x += (cache.targetX - cache.x) * lerpSpeed;
    cache.y += (cache.targetY - cache.y) * lerpSpeed;
    // Snap if very close
    if (Math.abs(cache.targetX - cache.x) < 0.01) cache.x = cache.targetX;
    if (Math.abs(cache.targetY - cache.y) < 0.01) cache.y = cache.targetY;
    // Independent animation timer per player
    if (op.moving) {
      cache.animTimer += dt;
      if (cache.animTimer > 200) { cache.animTimer = 0; cache.animFrame = (cache.animFrame + 1) % 2; }
    } else {
      cache.animFrame = 0; cache.animTimer = 0;
    }
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

  // Camera — auto-scale for small maps (only if user hasn't zoomed manually)
  if (userZoom !== null) {
    TILE_SIZE = userZoom;
  } else {
    const baseMapW = mapWidth * 32, baseMapH = mapHeight * 32;
    if (baseMapW < canvas.width || baseMapH < canvas.height) {
      const scaleX = canvas.width / (mapWidth * 32);
      const scaleY = canvas.height / (mapHeight * 32);
      TILE_SIZE = Math.floor(Math.min(scaleX, scaleY) * 32 * 0.9);
    } else {
      TILE_SIZE = 32;
    }
  }

  cameraX = myChar.x * TILE_SIZE - canvas.width / 2;
  cameraY = myChar.y * TILE_SIZE - canvas.height / 2;
  const totalMapW = mapWidth * TILE_SIZE;
  const totalMapH = mapHeight * TILE_SIZE;
  if (totalMapW <= canvas.width) {
    cameraX = -(canvas.width - totalMapW) / 2;
  } else {
    cameraX = Math.max(0, Math.min(cameraX, totalMapW - canvas.width));
  }
  if (totalMapH <= canvas.height) {
    cameraY = -(canvas.height - totalMapH) / 2;
  } else {
    cameraY = Math.max(0, Math.min(cameraY, totalMapH - canvas.height));
  }
}

// ============= RENDERING =============
function render() {
  // Dark background (visible around small maps)
  ctx.fillStyle = '#0e0e1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

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

  // Draw portal indicators (animated glow)
  if (mapPortals && mapPortals.length > 0) {
    const portalPulse = 0.4 + 0.3 * Math.sin(Date.now() / 400);
    for (const portal of mapPortals) {
      const px = portal.x * TILE_SIZE - cameraX;
      const py = portal.y * TILE_SIZE - cameraY;
      if (px < -TILE_SIZE || px > canvas.width || py < -TILE_SIZE || py > canvas.height) continue;
      ctx.save();
      ctx.globalAlpha = portalPulse;
      const grad = ctx.createRadialGradient(px + TILE_SIZE/2, py + TILE_SIZE/2, 2, px + TILE_SIZE/2, py + TILE_SIZE/2, TILE_SIZE * 0.6);
      grad.addColorStop(0, '#ffe066');
      grad.addColorStop(0.5, '#ffaa00');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  // Draw tree sprites in a separate pass (after all base tiles) so they don't get painted over
  // Trees are NOT drawn here anymore — they are added to the entity list for proper Y-sorting
  // (kept as comment for reference)

  // Draw image objects on top of tiles (simple, no Y-sort)
  drawMapObjects();

  // Collect all entities AND trees, sort by Y for proper layering
  const entities = [];

  // Add visible trees as entities so they Y-sort with characters
  for (let ty = startTY; ty < endTY; ty++) {
    for (let tx = startTX; tx < endTX; tx++) {
      const tile = gameMap[ty][tx];
      if (!TREE_TILE_TYPES.has(tile)) continue;
      entities.push({ type: 'tree', tx, ty, y: ty + 0.9 }); // y at bottom of tile for sorting
    }
  }

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
    const cache = otherPlayersCache[id];
    const drawY = cache ? cache.y : op.y;
    op._cacheId = id;
    entities.push({ type: 'otherPlayer', data: op, y: drawY });
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
      case 'tree': drawTreeEntity(ent.tx, ent.ty); break;
      case 'npc': drawNPC(ent.data); break;
      case 'enemy': drawEnemy(ent.data); break;
      case 'otherPlayer': drawOtherPlayer(ent.data); break;
      case 'myPlayer': drawMyPlayer(ent.data); break;
      case 'groundItem': drawGroundItem(ent.data); break;
    }
  }

  // Draw portions of image objects that are in "behind" cells (rendered over entities)
  drawMapObjectsBehind();

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

// ============= TILE DRAWING (SIMPLE CACHE-BASED) =============

function drawTile(tx, ty, sx, sy) {
  if (!tileCacheBuilt) initTileCache();
  const tile = gameMap[ty][tx];
  const v = (tx * 7 + ty * 13) % TILE_VARIANTS;

  // Water (animated)
  if (tile === T.WATER) {
    const key = 'water_' + waterAnimFrame + '_' + v;
    const cached = tileCanvasCache[key];
    if (cached) {
      ctx.drawImage(cached, 0, 0, cached.width, cached.height, sx, sy, TILE_SIZE, TILE_SIZE);
      return;
    }
  }

  // River water (animated, lighter)
  if (tile === T.WATER_RIVER) {
    const key = 'river_' + waterAnimFrame + '_' + v;
    const cached = tileCanvasCache[key];
    if (cached) {
      ctx.drawImage(cached, 0, 0, cached.width, cached.height, sx, sy, TILE_SIZE, TILE_SIZE);
      return;
    }
  }

  // Tree sprite tiles — draw only grass background here; tree sprites are drawn via Y-sorted entities
  if (TREE_TILE_TYPES.has(tile)) {
    const grassKey = T.GRASS + '_' + v;
    const grassCached = tileCanvasCache[grassKey];
    if (grassCached) {
      ctx.drawImage(grassCached, 0, 0, grassCached.width, grassCached.height, sx, sy, TILE_SIZE, TILE_SIZE);
    } else {
      ctx.fillStyle = '#3a7a2c';
      ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
    }
    return;
  }

  // All tiles from procedural cache
  const key = tile + '_' + v;
  const cached = tileCanvasCache[key];
  if (cached) {
    ctx.drawImage(cached, 0, 0, cached.width, cached.height, sx, sy, TILE_SIZE, TILE_SIZE);
    return;
  }

  // Fallback
  ctx.fillStyle = '#3b8a2e';
  ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
}

// ============= ENTITY DRAWING =============

function drawTreeEntity(tx, ty) {
  const tile = gameMap[ty][tx];
  const treeImgs = TREE_SPRITES[tile];
  if (!treeImgs || treeImgs.length === 0) return;
  const idx = (tx * 31 + ty * 17) % treeImgs.length;
  const img = treeImgs[idx];
  if (!img.complete || !img.naturalWidth) return;
  const sx = tx * TILE_SIZE - cameraX;
  const sy = ty * TILE_SIZE - cameraY;
  const aspect = img.naturalHeight / img.naturalWidth;
  const scale = 2.0;
  const drawW = TILE_SIZE * scale;
  const drawH = TILE_SIZE * scale * aspect;
  const drawX = sx + (TILE_SIZE - drawW) / 2;
  const drawY = sy + TILE_SIZE - drawH;
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
}

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

    // Equipment overlay layers: Calças > Botas > Peitoral > Elmo (bottom to top)
    const equipLayers = [
      { slot: 'equipped_legs', map: LEGS_SPRITES },
      { slot: 'equipped_boots', map: BOOTS_SPRITES },
      { slot: 'equipped_chest', map: CHEST_SPRITES },
      { slot: 'equipped_helmet', map: HELMET_SPRITES },
    ];
    for (const layer of equipLayers) {
      const itemId = char[layer.slot];
      if (itemId && layer.map[itemId]) {
        const pair = layer.map[itemId];
        const eName = (moving && animFrame === 1) ? pair[1] : pair[0];
        const eSpr = sprites[eName];
        if (eSpr && eSpr.complete && eSpr.naturalWidth > 0) {
          if (!shouldFlip) {
            ctx.drawImage(eSpr, sx - half, sy - S * 0.75, S, S);
          } else {
            ctx.save();
            ctx.translate(sx, sy - S * 0.75);
            ctx.scale(-1, 1);
            ctx.drawImage(eSpr, -half, 0, S, S);
            ctx.restore();
          }
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

  // Balão de fala do próprio jogador
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

  // Fundo do balão
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

  // Triângulo (pontinha do balão)
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
  // Use interpolated position from cache
  const cache = otherPlayersCache[op._cacheId];
  const drawX = cache ? cache.x : op.x;
  const drawY = cache ? cache.y : op.y;
  const opAnimFrame = cache ? cache.animFrame : 0;

  const sx = drawX * TILE_SIZE - cameraX;
  const sy = drawY * TILE_SIZE - cameraY;
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
    spriteName = (op.moving && opAnimFrame === 1) ? 'andando' : 'parado';
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
      const wSpriteName = (op.moving && opAnimFrame === 1) ? ws[1] : ws[0];
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

    // Equipment overlay layers (other player): Calças > Botas > Peitoral > Elmo
    const equipLayers = [
      { slot: 'equipped_legs', map: LEGS_SPRITES },
      { slot: 'equipped_boots', map: BOOTS_SPRITES },
      { slot: 'equipped_chest', map: CHEST_SPRITES },
      { slot: 'equipped_helmet', map: HELMET_SPRITES },
    ];
    for (const layer of equipLayers) {
      const itemId = op[layer.slot];
      if (itemId && layer.map[itemId]) {
        const pair = layer.map[itemId];
        const eName = (op.moving && opAnimFrame === 1) ? pair[1] : pair[0];
        const eSpr = sprites[eName];
        if (eSpr && eSpr.complete && eSpr.naturalWidth > 0) {
          if (!shouldFlip) {
            ctx.drawImage(eSpr, sx - half, sy - S * 0.75, S, S);
          } else {
            ctx.save();
            ctx.translate(sx, sy - S * 0.75);
            ctx.scale(-1, 1);
            ctx.drawImage(eSpr, -half, 0, S, S);
            ctx.restore();
          }
        }
      }
    }
  }

  ctx.fillStyle = '#aaffaa';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(op.username, sx, sy - S * 1.2);
  drawHPBar(sx, sy - S * 1.05, op.hp, op.max_hp, '#44cc44');

  // Balão de fala de outro jogador
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
  } else if (enemy.type === 'zombie') {
    // Zumbi: sprites zumbiparado/zumbiandando, originalmente virado pra DIREITA
    const spriteName = (enemy.moving && enemyAnimFrame === 1) ? 'zumbiandando' : 'zumbiparado';
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
      // Fallback: green-gray rect
      ctx.fillStyle = '#556b2f';
      ctx.fillRect(sx - S * 0.19, sy - S * 0.56, S * 0.38, S * 0.69);
      ctx.fillStyle = '#8fbc8f';
      ctx.beginPath(); ctx.arc(sx, sy - S * 0.63, S * 0.19, 0, Math.PI * 2); ctx.fill();
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
  const name = enemy.type === 'skeleton' ? 'Esqueleto' : (enemy.type === 'zombie' ? 'Zumbi' : (enemy.type === 'cow' ? 'Vaca' : 'Slime'));
  ctx.fillStyle = enemy.type === 'cow' ? '#ddcc88' : (enemy.type === 'zombie' ? '#88ff88' : '#ff8888');
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
        case T.WATER_RIVER: ctx.fillStyle = '#3a90d8'; break;
        case T.TREE_CARVALHO: ctx.fillStyle = '#1d4b0e'; break;
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
        case T.ROOF_RED: ctx.fillStyle = '#aa2020'; break;
        case T.ROOF_BLUE: ctx.fillStyle = '#2050aa'; break;
        case T.ROOF_YELLOW: ctx.fillStyle = '#c8a020'; break;
        case T.BENCH: ctx.fillStyle = '#8a6a40'; break;
        case T.TREE_BETULA: ctx.fillStyle = '#e8e0c0'; break;
        case T.TREE_CARVALHO_SMALL: ctx.fillStyle = '#4a8a30'; break;
        case T.TREE_MAGICA: ctx.fillStyle = '#6a2aaa'; break;
        case T.TREE_MANGUE: ctx.fillStyle = '#2a6a20'; break;
        case T.TREE_PINHEIRO: ctx.fillStyle = '#0e4a20'; break;
        case T.TREE_PINOS: ctx.fillStyle = '#1a5a1a'; break;
        default: ctx.fillStyle = '#000';
      }
      ctx.fillRect(mmX + tx * tileW, mmY + ty * tileH, Math.ceil(tileW), Math.ceil(tileH));
    }
  }

  // Image objects on minimap
  for (const obj of mapObjects) {
    const img = mapObjectImages[obj.id];
    if (!img || !img.complete || !img.naturalWidth) continue;
    const ox = mmX + obj.x * tileW;
    const oy = mmY + obj.y * tileH;
    const ow = Math.max(1, obj.width * tileW);
    const oh = Math.max(1, obj.height * tileH);
    ctx.drawImage(img, ox, oy, ow, oh);
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
    legs: { field: 'equipped_legs', label: 'Calça' },
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
    // Limpar conteúdo anterior
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
  let html = '<h4>ðŸ“œ Missões</h4>';
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
    acceptBtn.textContent = 'Aceitar Missão';
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

  // Crafting recipes (Artesão)
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
      const resultItem = ITEMS_CLIENT[recipe.resultId];
      const iconSrc = resultItem && resultItem.icon ? resultItem.icon : '';
      recipeDiv.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          ${iconSrc ? `<img src="${iconSrc}" style="width:32px;height:32px;image-rendering:pixelated;" />` : ''}
          <div>
            <div class="craft-recipe-name">${recipe.name}</div>
            <div class="craft-recipe-desc">${ingredientText}</div>
          </div>
        </div>
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
