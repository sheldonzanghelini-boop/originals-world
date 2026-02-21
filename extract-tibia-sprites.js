// ═══════════════════════════════════════════════════════════════════════
//  extract-tibia-sprites.js
//  Extrai sprites do Tibia .spr/.dat e gera atlas + mapping para o jogo
// ═══════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const SPR_FILE = 'C:\\Program Files (x86)\\Tibia2\\Tibia.spr';
const DAT_FILE = 'C:\\Program Files (x86)\\Tibia2\\Tibia.dat';
const OUT_DIR  = path.join(__dirname, 'public', 'assets', 'tilesets', 'tibia');

// Game tile enum (must match game.js T)
const T = {
  GRASS:0, DIRT:1, STONE_PATH:2, STONE_WALL:3, WATER:4, TREE:5,
  WOOD_FLOOR:6, CHURCH_FLOOR:7, WOOD_WALL:8, SAND:9, FLOWERS:10,
  BUSH:11, ROCK:12, RED_CARPET:13, ALTAR:14, ANVIL:15, FURNACE:16,
  BOOKSHELF:17, TABLE:18, CHAIR:19, WELL:20, FENCE:21, ROOF_STONE:22,
  ROOF_WOOD:23, WINDOW_STONE:24, WINDOW_WOOD:25, CROSS:26, TALL_GRASS:27,
  MUSHROOM:28, BARREL:29, CRATE:30, TORCH_WALL:31, BED:32, RUG:33,
  CHURCH_PEW:34, DARK_GRASS:35, GRAVESTONE:36, DEAD_TREE:37, BONE:38,
  MUD:39, HAY:40, CHURCH_WALL:41
};
const T_NAMES = Object.fromEntries(Object.entries(T).map(([k,v])=>[v,k]));

// ═══════════════════════════════════════════
//  SPR PARSER
// ═══════════════════════════════════════════
class SprFile {
  constructor(filepath) {
    this.buf = fs.readFileSync(filepath);
    this.signature = this.buf.readUInt32LE(0);
    this.count = this.buf.readUInt32LE(4);
    console.log(`SPR: signature=0x${this.signature.toString(16)}, sprites=${this.count}`);
  }

  extract(spriteId) {
    if (spriteId < 1 || spriteId > this.count) return null;
    const offset = this.buf.readUInt32LE(8 + (spriteId - 1) * 4);
    if (offset === 0) return null;

    const rgba = Buffer.alloc(32 * 32 * 4); // transparent
    const dataSize = this.buf.readUInt16LE(offset + 3);
    if (dataSize === 0) return rgba;

    let pos = offset + 5;
    const end = pos + dataSize;
    let px = 0;

    while (pos < end && px < 1024) {
      const skip = this.buf.readUInt16LE(pos); pos += 2;
      px += skip;
      if (pos >= end || px >= 1024) break;
      const count = this.buf.readUInt16LE(pos); pos += 2;
      for (let i = 0; i < count && px < 1024; i++, px++) {
        const idx = px * 4;
        rgba[idx]     = this.buf[pos++]; // R
        rgba[idx + 1] = this.buf[pos++]; // G
        rgba[idx + 2] = this.buf[pos++]; // B
        rgba[idx + 3] = 255;             // A
      }
    }
    return rgba;
  }
}

// ═══════════════════════════════════════════
//  DAT PARSER
// ═══════════════════════════════════════════
const FLAG_DATA = {
  0x00: 2, 0x01: 0, 0x02: 0, 0x03: 0, 0x04: 0, 0x05: 0, 0x06: 0, 0x07: 0,
  0x08: 2, 0x09: 2, 0x0A: 0, 0x0B: 0, 0x0C: 0, 0x0D: 0, 0x0E: 0, 0x0F: 0,
  0x10: 0, 0x11: 0, 0x12: 0, 0x13: 0, 0x14: 0, 0x15: 4, 0x16: 0, 0x17: 0,
  0x18: 4, 0x19: 2, 0x1A: 0, 0x1B: 0, 0x1C: 2, 0x1D: 2, 0x1E: 0,
  0x1F: 0, 0x20: 2, 0xFE: 2
};

class DatFile {
  constructor(filepath) {
    this.buf = fs.readFileSync(filepath);
    this.signature = this.buf.readUInt32LE(0);
    this.itemCount = this.buf.readUInt16LE(4);
    this.creatureCount = this.buf.readUInt16LE(6);
    this.effectCount = this.buf.readUInt16LE(8);
    this.missileCount = this.buf.readUInt16LE(10);
    this.pos = 12;
    console.log(`DAT: items=${this.itemCount}, creatures=${this.creatureCount}, effects=${this.effectCount}, missiles=${this.missileCount}`);
  }

  parseItems() {
    const items = [];
    for (let id = 100; id <= this.itemCount; id++) {
      const item = this._parseEntry(id);
      if (!item) { console.error(`Parse failed at item ${id}`); break; }
      items.push(item);
    }
    console.log(`Parsed ${items.length} items`);
    return items;
  }

  // Also parse creatures to get monster sprites
  parseCreatures() {
    const creatures = [];
    for (let id = 1; id <= this.creatureCount; id++) {
      const c = this._parseEntry(id, 'creature');
      if (!c) { console.error(`Creature parse failed at ${id}`); break; }
      creatures.push(c);
    }
    console.log(`Parsed ${creatures.length} creatures`);
    return creatures;
  }

  parseEffects() {
    for (let id = 1; id <= this.effectCount; id++) {
      if (!this._parseEntry(id, 'effect')) break;
    }
  }

  parseMissiles() {
    for (let id = 1; id <= this.missileCount; id++) {
      if (!this._parseEntry(id, 'missile')) break;
    }
  }

  _parseEntry(id, type = 'item') {
    const entry = { id, type, flags: {}, sprites: [] };
    
    while (this.pos < this.buf.length) {
      const flag = this.buf[this.pos++];
      if (flag === 0xFF) break;

      if (flag in FLAG_DATA) {
        // Process known flags
        switch (flag) {
          case 0x00: entry.flags.isGround = true; entry.flags.groundSpeed = this.buf.readUInt16LE(this.pos); break;
          case 0x01: entry.flags.isTopOrder1 = true; break;
          case 0x02: entry.flags.isTopOrder2 = true; break;
          case 0x03: entry.flags.isTopOrder3 = true; break;
          case 0x04: entry.flags.isContainer = true; break;
          case 0x05: entry.flags.isStackable = true; break;
          case 0x06: entry.flags.isForceUse = true; break;
          case 0x07: entry.flags.isMultiUse = true; break;
          case 0x08: entry.flags.isWritable = true; break;
          case 0x09: entry.flags.isWritableOnce = true; break;
          case 0x0A: entry.flags.isFluidContainer = true; break;
          case 0x0B: entry.flags.isSplash = true; break;
          case 0x0C: entry.flags.isNotWalkable = true; break;
          case 0x0D: entry.flags.isNotMoveable = true; break;
          case 0x0E: entry.flags.isBlockMissiles = true; break;
          case 0x0F: entry.flags.isBlockPathfind = true; break;
          case 0x10: entry.flags.isPickupable = true; break;
          case 0x11: entry.flags.isHangable = true; break;
          case 0x12: entry.flags.isHookSouth = true; break;
          case 0x13: entry.flags.isHookEast = true; break;
          case 0x14: entry.flags.isRotatable = true; break;
          case 0x15: entry.flags.lightIntensity = this.buf.readUInt16LE(this.pos); entry.flags.lightColor = this.buf.readUInt16LE(this.pos + 2); break;
          case 0x16: entry.flags.isDontHide = true; break;
          case 0x17: entry.flags.isTranslucent = true; break;
          case 0x18: entry.flags.displacementX = this.buf.readUInt16LE(this.pos); entry.flags.displacementY = this.buf.readUInt16LE(this.pos + 2); break;
          case 0x19: entry.flags.elevation = this.buf.readUInt16LE(this.pos); break;
          case 0x1A: entry.flags.isLyingObject = true; break;
          case 0x1B: entry.flags.isAnimateAlways = true; break;
          case 0x1C: entry.flags.minimapColor = this.buf.readUInt16LE(this.pos); break;
          case 0x1D: entry.flags.lensHelp = this.buf.readUInt16LE(this.pos); break;
          case 0x1E: entry.flags.isFullGround = true; break;
          case 0x1F: entry.flags.isLookThrough = true; break;
          case 0x20: entry.flags.clothSlot = this.buf.readUInt16LE(this.pos); break;
        }
        this.pos += FLAG_DATA[flag];
      } else if (flag === 0x21) {
        // Market data
        entry.flags.marketCategory = this.buf.readUInt16LE(this.pos); this.pos += 2;
        entry.flags.marketTradeAs = this.buf.readUInt16LE(this.pos); this.pos += 2;
        entry.flags.marketShowAs = this.buf.readUInt16LE(this.pos); this.pos += 2;
        const nameLen = this.buf.readUInt16LE(this.pos); this.pos += 2;
        entry.flags.marketName = this.buf.slice(this.pos, this.pos + nameLen).toString('utf8');
        this.pos += nameLen;
        entry.flags.marketVocation = this.buf.readUInt16LE(this.pos); this.pos += 2;
        entry.flags.marketLevel = this.buf.readUInt16LE(this.pos); this.pos += 2;
      } else {
        console.error(`Unknown flag 0x${flag.toString(16)} at item ${id}`);
        return null;
      }
    }

    // Sprite dimensions
    entry.width = this.buf[this.pos++];
    entry.height = this.buf[this.pos++];
    if (entry.width > 1 || entry.height > 1) {
      entry.exactSize = this.buf[this.pos++];
    }
    entry.layers = this.buf[this.pos++];
    entry.xPattern = this.buf[this.pos++];
    entry.yPattern = this.buf[this.pos++];
    entry.zPattern = this.buf[this.pos++];
    entry.animLength = this.buf[this.pos++];

    const total = entry.width * entry.height * entry.layers *
                  entry.xPattern * entry.yPattern * entry.zPattern * entry.animLength;

    for (let i = 0; i < total; i++) {
      entry.sprites.push(this.buf.readUInt32LE(this.pos));
      this.pos += 4;
    }
    return entry;
  }
}

// ═══════════════════════════════════════════
//  COLOR ANALYSIS
// ═══════════════════════════════════════════
function analyzeColor(rgba) {
  if (!rgba) return null;
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < 1024; i++) {
    if (rgba[i * 4 + 3] > 0) {
      r += rgba[i * 4];
      g += rgba[i * 4 + 1];
      b += rgba[i * 4 + 2];
      count++;
    }
  }
  if (count < 50) return null;
  return { r: r / count, g: g / count, b: b / count, coverage: count / 1024 };
}

function classifyGround(avg) {
  if (!avg) return 'unknown';
  const { r, g, b, coverage } = avg;

  // Water - blueish
  if (b > r + 20 && b > g) return 'water';
  // Lava - red dominant
  if (r > g + 60 && r > b + 60 && r > 150) return 'lava';
  // Green family
  if (g > r + 10 && g > b + 10) {
    if (g < 100 || (r + g + b) < 250) return 'dark_grass';
    return 'grass';
  }
  // Sand / yellow
  if (r > 140 && g > 120 && b < 100 && r > b + 50) return 'sand';
  // Brown / dirt
  if (r > g && r > b && g > b && r - b > 30 && r < 180) return 'dirt';
  // Wood (warmer brown)
  if (r > g && g > b && r > 100 && r - b > 40 && r > 150) return 'wood';
  // Gray / stone
  if (Math.abs(r - g) < 25 && Math.abs(g - b) < 25) {
    if (r > 180) return 'white_stone';
    if (r > 80) return 'stone';
    return 'dark_stone';
  }
  // Red-ish (carpet, etc)
  if (r > g + 30 && r > b + 30) return 'red';
  return 'unknown';
}

// ═══════════════════════════════════════════
//  CANVAS HELPERS
// ═══════════════════════════════════════════
function rgbaToCanvas(rgba) {
  const c = createCanvas(32, 32);
  const ctx = c.getContext('2d');
  const imgData = ctx.createImageData(32, 32);
  for (let i = 0; i < 32 * 32 * 4; i++) imgData.data[i] = rgba[i];
  ctx.putImageData(imgData, 0, 0);
  return c;
}

function composite(baseCanvas, overlayCanvas) {
  const c = createCanvas(32, 32);
  const ctx = c.getContext('2d');
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.drawImage(overlayCanvas, 0, 0);
  return c;
}

// Get the "center" sprite index for items with patterns
function getCenterSpriteIndex(item) {
  const { width: w, height: h, layers, xPattern: xp, yPattern: yp, zPattern: zp, animLength } = item;
  if (xp >= 4 && yp >= 4) {
    // 4x4 border pattern: center is at (1,1) -> index = 1*4+1 = 5
    return (1 * xp + 1) * w * h * layers;
  }
  if (xp >= 2 && yp >= 2) {
    return (1 * xp + 1) * w * h * layers;
  }
  return 0; // just use first sprite
}

// ═══════════════════════════════════════════
//  MAIN EXTRACTION LOGIC
// ═══════════════════════════════════════════
function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const spr = new SprFile(SPR_FILE);
  const dat = new DatFile(DAT_FILE);
  const items = dat.parseItems();

  // ── Categorize items ──
  const grounds = [];     // isGround items
  const walls = [];       // blocking + blockMissiles (wall-like)
  const vegetation = [];  // top-order, not walkable (trees/bushes)
  const objects = [];     // other items (furniture, decorations)
  const overlays = [];    // ground-level decorations (flowers, etc.)

  for (const item of items) {
    const f = item.flags;
    if (f.isGround) {
      grounds.push(item);
    } else if (f.isNotWalkable && f.isBlockMissiles && f.isNotMoveable && !f.isContainer) {
      walls.push(item);
    } else if ((f.isTopOrder1 || f.isTopOrder2) && f.isNotWalkable) {
      vegetation.push(item);
    } else if (f.isPickupable && !f.isStackable && (f.displacementX > 0 || f.displacementY > 0)) {
      overlays.push(item);
    } else {
      objects.push(item);
    }
  }

  console.log(`\nCategories: grounds=${grounds.length}, walls=${walls.length}, vegetation=${vegetation.length}, overlays=${overlays.length}, objects=${objects.length}`);

  // ── Analyze ground tiles ──
  console.log('\nAnalyzing ground tiles...');
  const groundsByType = {};
  let analyzed = 0;

  for (const item of grounds) {
    const idx = getCenterSpriteIndex(item);
    const sprId = item.sprites[idx] || item.sprites[0];
    if (!sprId) continue;

    const rgba = spr.extract(sprId);
    const avg = analyzeColor(rgba);
    const type = classifyGround(avg);

    if (!groundsByType[type]) groundsByType[type] = [];
    groundsByType[type].push({
      item,
      spriteId: sprId,
      rgba,
      avg,
      name: item.flags.marketName || `item_${item.id}`
    });
    analyzed++;
  }

  console.log('Ground types found:');
  for (const [type, list] of Object.entries(groundsByType)) {
    console.log(`  ${type}: ${list.length} items`);
  }

  // ── Select best sprites for each game tile type ──
  console.log('\nSelecting best sprites...');

  // Helper: pick the best ground from a category (highest coverage, most representative)
  function pickBest(list, preferFullGround = true) {
    if (!list || list.length === 0) return null;
    // Prefer items with isFullGround flag and high coverage
    const sorted = [...list].sort((a, b) => {
      const aFull = a.item.flags.isFullGround ? 1 : 0;
      const bFull = b.item.flags.isFullGround ? 1 : 0;
      if (preferFullGround && aFull !== bFull) return bFull - aFull;
      return (b.avg?.coverage || 0) - (a.avg?.coverage || 0);
    });
    return sorted[0];
  }

  // Helper: pick N different ground items for variety
  function pickVariety(list, n = 4) {
    if (!list || list.length === 0) return [];
    const sorted = [...list].sort((a, b) => {
      const aFull = a.item.flags.isFullGround ? 1 : 0;
      const bFull = b.item.flags.isFullGround ? 1 : 0;
      if (aFull !== bFull) return bFull - aFull;
      return (b.avg?.coverage || 0) - (a.avg?.coverage || 0);
    });
    return sorted.slice(0, n);
  }

  // Ground selections
  const selected = {};

  // GRASS (T=0) - green ground
  const grassPick = pickBest(groundsByType.grass);
  if (grassPick) selected[T.GRASS] = { spriteId: grassPick.spriteId, rgba: grassPick.rgba, name: grassPick.name };

  // DARK_GRASS (T=35)
  const dGrassPick = pickBest(groundsByType.dark_grass);
  if (dGrassPick) selected[T.DARK_GRASS] = { spriteId: dGrassPick.spriteId, rgba: dGrassPick.rgba, name: dGrassPick.name };

  // DIRT (T=1) - brown ground
  const dirtPick = pickBest(groundsByType.dirt);
  if (dirtPick) selected[T.DIRT] = { spriteId: dirtPick.spriteId, rgba: dirtPick.rgba, name: dirtPick.name };

  // STONE_PATH (T=2)
  const stonePick = pickBest(groundsByType.stone);
  if (stonePick) selected[T.STONE_PATH] = { spriteId: stonePick.spriteId, rgba: stonePick.rgba, name: stonePick.name };

  // SAND (T=9)
  const sandPick = pickBest(groundsByType.sand);
  if (sandPick) selected[T.SAND] = { spriteId: sandPick.spriteId, rgba: sandPick.rgba, name: sandPick.name };

  // WOOD_FLOOR (T=6)
  const woodPick = pickBest(groundsByType.wood);
  if (woodPick) selected[T.WOOD_FLOOR] = { spriteId: woodPick.spriteId, rgba: woodPick.rgba, name: woodPick.name };

  // CHURCH_FLOOR (T=7) - white/light stone
  const whitePick = pickBest(groundsByType.white_stone);
  if (whitePick) selected[T.CHURCH_FLOOR] = { spriteId: whitePick.spriteId, rgba: whitePick.rgba, name: whitePick.name };
  
  // MUD (T=39) - dark dirt
  const darkDirtItems = (groundsByType.dirt || []).filter(g => g.avg && g.avg.r < 120);
  const mudPick = pickBest(darkDirtItems.length > 0 ? darkDirtItems : groundsByType.dark_stone);
  if (mudPick) selected[T.MUD] = { spriteId: mudPick.spriteId, rgba: mudPick.rgba, name: mudPick.name };

  // RED_CARPET (T=13) - red ground
  const redPick = pickBest(groundsByType.red);
  if (redPick) selected[T.RED_CARPET] = { spriteId: redPick.spriteId, rgba: redPick.rgba, name: redPick.name };

  // WATER (T=4) - animated water
  const waterItems = (groundsByType.water || []).filter(g => g.item.animLength > 1);
  if (waterItems.length === 0 && groundsByType.water) waterItems.push(...groundsByType.water);
  if (waterItems.length > 0) {
    const waterItem = waterItems[0].item;
    const waterFrames = [];
    const idx0 = getCenterSpriteIndex(waterItem);
    const frameStride = waterItem.width * waterItem.height * waterItem.layers *
                        waterItem.xPattern * waterItem.yPattern * waterItem.zPattern;
    for (let f = 0; f < waterItem.animLength; f++) {
      const sid = waterItem.sprites[idx0 + f * frameStride] || waterItem.sprites[f];
      if (sid) {
        const rgba = spr.extract(sid);
        if (rgba) waterFrames.push({ spriteId: sid, rgba });
      }
    }
    if (waterFrames.length > 0) {
      selected[T.WATER] = { frames: waterFrames, name: waterItems[0].name || 'water', animated: true };
    }
  }

  // ── Find objects by FLAG patterns (much more accurate than name search) ──
  console.log('\nSearching for objects by flags...');

  // Helper: extract sprite and analyze
  function tryExtract(item, spriteIdx = 0) {
    const sprId = item.sprites[spriteIdx] || item.sprites[0];
    if (!sprId) return null;
    const rgba = spr.extract(sprId);
    if (!rgba) return null;
    const avg = analyzeColor(rgba);
    return { sprId, rgba, avg };
  }

  // Helper: select by flags + color filter
  function findByFlags(source, filter, colorFilter = null, preferLarger = false) {
    const candidates = source.filter(filter);
    if (candidates.length === 0) return null;

    // Sort: prefer items WITHOUT market names (actual map tiles, not store items)
    // and with higher sprite coverage
    const scored = [];
    for (const item of candidates) {
      const ex = tryExtract(item);
      if (!ex || !ex.avg || ex.avg.coverage < 0.05) continue;
      if (colorFilter && !colorFilter(ex.avg)) continue;
      const isMapTile = !item.flags.marketName || !item.flags.marketName.includes('kit');
      const score = (isMapTile ? 1000 : 0) + ex.avg.coverage * 100 + (preferLarger ? (item.width + item.height) * 50 : 0);
      scored.push({ item, ...ex, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored[0] || null;
  }

  function setSelected(tileType, result, isOverlay = false) {
    if (!result) return;
    selected[tileType] = {
      spriteId: result.sprId,
      rgba: result.rgba,
      name: result.item.flags.marketName || `item_${result.item.id}`,
      item: result.item,
      isOverlay
    };
  }

  // ── WALLS ──
  // Stone wall: blocking + blockMissiles + gray color + high coverage
  setSelected(T.STONE_WALL, findByFlags(walls,
    i => i.width <= 2 && i.height <= 2,
    avg => Math.abs(avg.r - avg.g) < 30 && Math.abs(avg.g - avg.b) < 30 && avg.r > 60 && avg.coverage > 0.6
  ));

  // Wood wall: blocking + blockMissiles + brown/warm color
  setSelected(T.WOOD_WALL, findByFlags(walls,
    i => i.width <= 2 && i.height <= 2 && i !== selected[T.STONE_WALL]?.item,
    avg => avg.r > avg.b + 20 && avg.g > avg.b && avg.r > 80 && avg.coverage > 0.5
  ));

  // Church wall: blocking + light/white color
  setSelected(T.CHURCH_WALL, findByFlags(walls,
    i => i.width <= 2 && i.height <= 2 && i !== selected[T.STONE_WALL]?.item && i !== selected[T.WOOD_WALL]?.item,
    avg => avg.r > 150 && avg.g > 150 && avg.b > 140 && avg.coverage > 0.5
  ));

  // ── VEGETATION ──
  // Tree: multi-tile vegetation, green
  const treeResult = findByFlags(vegetation,
    i => (i.width >= 2 || i.height >= 2),
    avg => avg.g > avg.r && avg.coverage > 0.1,
    true // prefer larger
  );
  setSelected(T.TREE, treeResult, true);

  // Bush: 1x1 vegetation, green, decent coverage
  setSelected(T.BUSH, findByFlags(vegetation,
    i => i.width === 1 && i.height === 1 && i !== selected[T.TREE]?.item,
    avg => avg.g > avg.r && avg.g > 60 && avg.coverage > 0.15
  ), true);

  // Dead tree: vegetation, brown/gray
  setSelected(T.DEAD_TREE, findByFlags(vegetation,
    i => (i.width >= 1) && i !== selected[T.TREE]?.item && i !== selected[T.BUSH]?.item,
    avg => (avg.r > avg.g || (Math.abs(avg.r-avg.g) < 20 && avg.r > 60)) && avg.coverage > 0.08
  ), true);

  // ── SMALL OBJECTS (non-ground, non-pickupable, blocking) ──
  const staticObjects = items.filter(i =>
    !i.flags.isGround && i.flags.isNotMoveable && !i.flags.isContainer &&
    i.width <= 2 && i.height <= 2
  );

  // Rock: gray, not walkable, small
  setSelected(T.ROCK, findByFlags(staticObjects,
    i => i.flags.isNotWalkable && i.width === 1 && i.height === 1,
    avg => Math.abs(avg.r - avg.g) < 25 && Math.abs(avg.g - avg.b) < 25 && avg.r > 60 && avg.r < 180 && avg.coverage > 0.15
  ), true);

  // Fence: not walkable but NOT block missiles, wood colored
  setSelected(T.FENCE, findByFlags(items.filter(i =>
    !i.flags.isGround && i.flags.isNotWalkable && !i.flags.isBlockMissiles &&
    i.flags.isNotMoveable && i.width <= 2 && i.height <= 2 && !i.flags.isPickupable
  ), i => true, avg => avg.r > avg.b && avg.coverage > 0.08), true);

  // Gravestone: not walkable, gray/dark, small
  setSelected(T.GRAVESTONE, findByFlags(staticObjects,
    i => i.flags.isNotWalkable && i.width === 1 && i.height <= 2 && i !== selected[T.ROCK]?.item,
    avg => Math.abs(avg.r - avg.g) < 20 && avg.r > 80 && avg.r < 200 && avg.coverage > 0.1
  ), true);

  // ── FURNITURE (not walkable, not moveable, brown/wood usually) ──
  // Table
  setSelected(T.TABLE, findByFlags(staticObjects,
    i => i.width >= 1 && i.height === 1 && !i.flags.isBlockMissiles,
    avg => avg.r > avg.b + 10 && avg.coverage > 0.1
  ), true);

  // Chair
  setSelected(T.CHAIR, findByFlags(staticObjects,
    i => i.width === 1 && i.height === 1 && i !== selected[T.TABLE]?.item && i !== selected[T.ROCK]?.item,
    avg => avg.r > avg.b && avg.coverage > 0.08
  ), true);

  // Barrel: round, brown
  setSelected(T.BARREL, findByFlags(staticObjects,
    i => i.width === 1 && i.height === 1 && i !== selected[T.TABLE]?.item && i !== selected[T.CHAIR]?.item && i !== selected[T.ROCK]?.item,
    avg => avg.r > avg.b + 20 && avg.r > 80 && avg.coverage > 0.15
  ), true);

  // Crate: box, brown
  setSelected(T.CRATE, findByFlags(items.filter(i =>
    i.flags.isContainer && i.width === 1 && i.height === 1
  ), i => true, avg => avg.r > avg.b && avg.coverage > 0.15), true);

  // Bookshelf: tall, brown
  setSelected(T.BOOKSHELF, findByFlags(staticObjects,
    i => i.flags.isBlockMissiles && i !== selected[T.STONE_WALL]?.item && i !== selected[T.WOOD_WALL]?.item,
    avg => avg.r > avg.b + 10 && avg.coverage > 0.4
  ), true);

  // Well: not walkable, has some blue (water)
  setSelected(T.WELL, findByFlags(staticObjects,
    i => i.flags.isNotWalkable && i.width <= 2 && i.height <= 2,
    avg => avg.b > 50 && avg.coverage > 0.1
  ), true);

  // ── OVERLAYS (pickupable ground decorations) ──
  const decorations = items.filter(i =>
    !i.flags.isGround && !i.flags.isNotWalkable && !i.flags.isContainer &&
    i.width === 1 && i.height === 1
  );

  // Flowers: small, colorful on ground
  setSelected(T.FLOWERS, findByFlags(decorations,
    i => !i.flags.isPickupable || true,
    avg => (avg.r > 100 || avg.g > 80) && avg.coverage > 0.03 && avg.coverage < 0.5
  ), true);

  // Mushroom: small fungi
  if (!selected[T.MUSHROOM]) {
    setSelected(T.MUSHROOM, findByFlags(decorations,
      i => i !== selected[T.FLOWERS]?.item,
      avg => avg.r > 60 && avg.coverage > 0.02 && avg.coverage < 0.4
    ), true);
  }

  // Tall grass: green, moderate coverage
  if (!selected[T.TALL_GRASS]) {
    setSelected(T.TALL_GRASS, findByFlags(decorations,
      i => i !== selected[T.FLOWERS]?.item && i !== selected[T.MUSHROOM]?.item,
      avg => avg.g > avg.r && avg.g > 60 && avg.coverage > 0.05
    ), true);
  }

  // Bone
  setSelected(T.BONE, findByFlags(decorations,
    i => i !== selected[T.FLOWERS]?.item && i !== selected[T.MUSHROOM]?.item && i !== selected[T.TALL_GRASS]?.item,
    avg => avg.r > 150 && avg.g > 140 && avg.coverage > 0.03 && avg.coverage < 0.4
  ), true);

  // ── LIGHT/SPECIAL OBJECTS ──
  // Torch: has light
  setSelected(T.TORCH_WALL, findByFlags(items.filter(i =>
    i.flags.lightIntensity > 0 && !i.flags.isGround && i.width === 1 && i.height <= 2
  ), i => true, avg => avg.r > 100 && avg.coverage > 0.05), true);

  // Anvil: small, dark, metallic
  setSelected(T.ANVIL, findByFlags(staticObjects,
    i => i.width === 1 && i.height === 1 &&
         i !== selected[T.TABLE]?.item && i !== selected[T.CHAIR]?.item &&
         i !== selected[T.BARREL]?.item && i !== selected[T.ROCK]?.item,
    avg => avg.r < 120 && avg.g < 120 && avg.b < 120 && Math.abs(avg.r-avg.g) < 20 && avg.coverage > 0.1
  ), true);

  // Furnace: has light, blocky
  setSelected(T.FURNACE, findByFlags(staticObjects.filter(i =>
    i.flags.lightIntensity > 0 || (i.flags.isNotWalkable && i.flags.isBlockMissiles)
  ), i => i !== selected[T.BOOKSHELF]?.item && i !== selected[T.STONE_WALL]?.item,
    avg => avg.r > avg.b && avg.coverage > 0.3
  ), true);

  // Altar  
  setSelected(T.ALTAR, findByFlags(staticObjects,
    i => i.flags.lightIntensity > 0 && i !== selected[T.TORCH_WALL]?.item && i !== selected[T.FURNACE]?.item,
    avg => avg.coverage > 0.15
  ), true);

  // Bed: large, not walkable
  setSelected(T.BED, findByFlags(staticObjects,
    i => (i.width >= 2 || i.height >= 2) && !i.flags.isBlockMissiles,
    avg => avg.coverage > 0.2
  ), true);

  // Cross
  setSelected(T.CROSS, findByFlags(items.filter(i =>
    !i.flags.isGround && i.width === 1 && i.height <= 2 && !i.flags.isPickupable && !i.flags.isContainer
  ), i => i !== selected[T.FENCE]?.item && i !== selected[T.TORCH_WALL]?.item,
    avg => avg.coverage > 0.05 && avg.coverage < 0.5
  ), true);

  // Window stone: hangable, gray
  setSelected(T.WINDOW_STONE, findByFlags(items.filter(i =>
    i.flags.isHangable && i.width === 1 && i.height === 1
  ), i => true, avg => Math.abs(avg.r-avg.g) < 25 && avg.coverage > 0.05), true);

  // Window wood: hangable, brown
  setSelected(T.WINDOW_WOOD, findByFlags(items.filter(i =>
    i.flags.isHangable && i.width === 1 && i.height === 1 && i !== selected[T.WINDOW_STONE]?.item
  ), i => true, avg => avg.r > avg.b + 10 && avg.coverage > 0.05), true);

  // Roof stone: top order 3, gray
  setSelected(T.ROOF_STONE, findByFlags(items.filter(i =>
    i.flags.isTopOrder3 && !i.flags.isGround && i.width === 1 && i.height === 1
  ), i => true, avg => Math.abs(avg.r-avg.g) < 20 && avg.coverage > 0.3));

  // Roof wood: top order 3, brown
  setSelected(T.ROOF_WOOD, findByFlags(items.filter(i =>
    i.flags.isTopOrder3 && !i.flags.isGround && i.width === 1 && i.height === 1 && i !== selected[T.ROOF_STONE]?.item
  ), i => true, avg => avg.r > avg.b + 10 && avg.coverage > 0.3));

  // Church pew: not walkable, wood
  setSelected(T.CHURCH_PEW, findByFlags(staticObjects,
    i => i !== selected[T.TABLE]?.item && i !== selected[T.CHAIR]?.item && i !== selected[T.BARREL]?.item && i !== selected[T.BOOKSHELF]?.item,
    avg => avg.r > avg.b + 10 && avg.r > 80 && avg.coverage > 0.15
  ), true);

  // Rug: ground decoration
  setSelected(T.RUG, findByFlags(grounds,
    i => i.flags.isGround && !i.flags.isFullGround,
    avg => avg.r > 80 && avg.coverage > 0.3
  ));

  // Hay: yellow/gold, small
  setSelected(T.HAY, findByFlags(decorations,
    i => i !== selected[T.FLOWERS]?.item && i !== selected[T.MUSHROOM]?.item,
    avg => avg.r > 140 && avg.g > 120 && avg.b < 100 && avg.coverage > 0.05
  ), true);

  // ── Report selections ──
  console.log('\n=== SELECTED SPRITES ===');
  for (const [tileType, sel] of Object.entries(selected)) {
    const name = T_NAMES[tileType] || tileType;
    if (sel.animated) {
      console.log(`  ${name} (T=${tileType}): ${sel.frames.length} frames - "${sel.name}"`);
    } else {
      console.log(`  ${name} (T=${tileType}): sprite #${sel.spriteId} - "${sel.name}" ${sel.isOverlay ? '[overlay]' : ''}`);
    }
  }

  const notMapped = Object.values(T).filter(v => !selected[v]);
  if (notMapped.length > 0) {
    console.log(`\n  Not mapped (${notMapped.length}): ${notMapped.map(v => T_NAMES[v]).join(', ')}`);
  }

  // ── Build atlas ──
  console.log('\nBuilding atlas...');
  const COLS = 16;
  const allTiles = [];
  const mapping = {};

  // Get grass canvas for compositing overlays
  let grassCanvas = null;
  if (selected[T.GRASS]) {
    grassCanvas = rgbaToCanvas(selected[T.GRASS].rgba);
  }

  for (const [tileType, sel] of Object.entries(selected)) {
    if (sel.animated) {
      // Animated tiles: store each frame
      const framePositions = [];
      for (const frame of sel.frames) {
        const idx = allTiles.length;
        allTiles.push(rgbaToCanvas(frame.rgba));
        framePositions.push({ col: idx % COLS, row: Math.floor(idx / COLS) });
      }
      mapping[tileType] = { frames: framePositions };
    } else {
      let canvas;
      if (sel.isOverlay && grassCanvas) {
        // Composite overlay on grass
        canvas = composite(grassCanvas, rgbaToCanvas(sel.rgba));
      } else {
        canvas = rgbaToCanvas(sel.rgba);
      }
      const idx = allTiles.length;
      allTiles.push(canvas);
      mapping[tileType] = { col: idx % COLS, row: Math.floor(idx / COLS) };
    }
  }

  const totalRows = Math.ceil(allTiles.length / COLS);
  const atlasCanvas = createCanvas(COLS * 32, totalRows * 32);
  const actx = atlasCanvas.getContext('2d');

  for (let i = 0; i < allTiles.length; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    actx.drawImage(allTiles[i], col * 32, row * 32);
  }

  const atlasPath = path.join(OUT_DIR, 'atlas.png');
  fs.writeFileSync(atlasPath, atlasCanvas.toBuffer('image/png'));
  console.log(`Atlas saved: ${atlasCanvas.width}x${atlasCanvas.height} (${allTiles.length} tiles)`);

  // Save mapping
  const mappingPath = path.join(OUT_DIR, 'mapping.json');
  fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
  console.log(`Mapping saved: ${Object.keys(mapping).length} tile types`);

  // ── Build ground catalog ──
  console.log('\nBuilding ground catalog...');
  const CAT_COLS = 20;
  const CELL_H = 48; // 32px sprite + 16px label
  const allGrounds = [];

  for (const item of grounds) {
    const idx = getCenterSpriteIndex(item);
    const sprId = item.sprites[idx] || item.sprites[0];
    if (!sprId) continue;
    const rgba = spr.extract(sprId);
    if (!rgba) continue;
    const avg = analyzeColor(rgba);
    const type = classifyGround(avg);
    allGrounds.push({ id: item.id, sprId, rgba, type, name: item.flags.marketName || '' });
  }

  const catRows = Math.ceil(allGrounds.length / CAT_COLS);
  const catCanvas = createCanvas(CAT_COLS * 32, catRows * CELL_H);
  const cctx = catCanvas.getContext('2d');
  cctx.fillStyle = '#1a1a1a';
  cctx.fillRect(0, 0, catCanvas.width, catCanvas.height);

  for (let i = 0; i < allGrounds.length; i++) {
    const col = i % CAT_COLS;
    const row = Math.floor(i / CAT_COLS);
    const g = allGrounds[i];

    const c = rgbaToCanvas(g.rgba);
    cctx.drawImage(c, col * 32, row * CELL_H);

    // Label with item ID
    cctx.fillStyle = '#fff';
    cctx.font = '8px monospace';
    cctx.fillText(`${g.id}`, col * 32 + 1, row * CELL_H + 32 + 10);
    cctx.fillStyle = '#888';
    cctx.fillText(g.type.substr(0, 5), col * 32 + 1, row * CELL_H + 32 + 16);
  }

  const catPath = path.join(OUT_DIR, 'catalog-grounds.png');
  fs.writeFileSync(catPath, catCanvas.toBuffer('image/png'));
  console.log(`Ground catalog saved: ${allGrounds.length} tiles`);

  // ── Build objects catalog ──
  console.log('Building objects catalog...');
  const namedItems = items.filter(i => i.flags.marketName && !i.flags.isGround);
  const objPerRow = 16;
  const objCellH = 56; // sprite + 2 lines of text
  const objRows = Math.ceil(Math.min(namedItems.length, 500) / objPerRow);
  const objCanvas = createCanvas(objPerRow * 32, objRows * objCellH);
  const octx = objCanvas.getContext('2d');
  octx.fillStyle = '#1a1a1a';
  octx.fillRect(0, 0, objCanvas.width, objCanvas.height);

  for (let i = 0; i < Math.min(namedItems.length, 500); i++) {
    const col = i % objPerRow;
    const row = Math.floor(i / objPerRow);
    const item = namedItems[i];
    const sprId = item.sprites[0];
    if (!sprId) continue;

    const rgba = spr.extract(sprId);
    if (!rgba) continue;

    // Draw grass background for overlay-type items
    if (grassCanvas) octx.drawImage(grassCanvas, col * 32, row * objCellH);
    const c = rgbaToCanvas(rgba);
    octx.drawImage(c, col * 32, row * objCellH);

    // Label
    octx.fillStyle = '#fff';
    octx.font = '7px monospace';
    const label = item.flags.marketName.substring(0, 8);
    octx.fillText(label, col * 32 + 1, row * objCellH + 32 + 9);
    octx.fillStyle = '#888';
    octx.fillText(`id:${item.id}`, col * 32 + 1, row * objCellH + 32 + 17);
  }

  const objCatPath = path.join(OUT_DIR, 'catalog-objects.png');
  fs.writeFileSync(objCatPath, objCanvas.toBuffer('image/png'));
  console.log(`Objects catalog saved: ${Math.min(namedItems.length, 500)} items`);

  console.log('\n✓ Done! Files saved to:', OUT_DIR);
}

main();
