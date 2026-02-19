const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  allowUpgrades: true
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ============================
// DATABASE
// ============================
const db = new Database(path.join(__dirname, 'game.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER UNIQUE NOT NULL,
    x REAL DEFAULT 40,
    y REAL DEFAULT 30,
    hp INTEGER DEFAULT 25,
    max_hp INTEGER DEFAULT 25,
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    silver INTEGER DEFAULT 0,
    strength INTEGER DEFAULT 0,
    intelligence INTEGER DEFAULT 0,
    vitality INTEGER DEFAULT 0,
    defense INTEGER DEFAULT 0,
    luck INTEGER DEFAULT 0,
    skill_points INTEGER DEFAULT 0,
    equipped_weapon TEXT DEFAULT '',
    equipped_armor TEXT DEFAULT '',
    equipped_helmet TEXT DEFAULT '',
    equipped_chest TEXT DEFAULT '',
    equipped_legs TEXT DEFAULT '',
    equipped_boots TEXT DEFAULT '',
    equipped_ring1 TEXT DEFAULT '',
    equipped_ring2 TEXT DEFAULT '',
    equipped_weapon2 TEXT DEFAULT '',
    direction TEXT DEFAULT 'right',
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );
  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL,
    item_id TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    FOREIGN KEY (character_id) REFERENCES characters(id)
  );
  CREATE TABLE IF NOT EXISTS quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL,
    quest_id TEXT NOT NULL,
    status TEXT DEFAULT 'not_started',
    progress INTEGER DEFAULT 0,
    completed_at INTEGER DEFAULT 0,
    FOREIGN KEY (character_id) REFERENCES characters(id),
    UNIQUE(character_id, quest_id)
  );
`);

// Add completed_at column if missing (existing DBs)
try { db.exec('ALTER TABLE quests ADD COLUMN completed_at INTEGER DEFAULT 0'); } catch(e) {}
// Add progress_data column for multi-target quests
try { db.exec("ALTER TABLE quests ADD COLUMN progress_data TEXT DEFAULT '{}'"); } catch(e) {}
// Add new equipment slots if missing (existing DBs)
try { db.exec("ALTER TABLE characters ADD COLUMN equipped_helmet TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE characters ADD COLUMN equipped_chest TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE characters ADD COLUMN equipped_legs TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE characters ADD COLUMN equipped_boots TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE characters ADD COLUMN equipped_ring1 TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE characters ADD COLUMN equipped_ring2 TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE characters ADD COLUMN equipped_weapon2 TEXT DEFAULT ''"); } catch(e) {}
// Ensure is_admin column exists (for DBs created before admin feature)
try { db.exec("ALTER TABLE accounts ADD COLUMN is_admin INTEGER DEFAULT 0"); } catch(e) {}
// Add quadrant column for zone system
try { db.exec("ALTER TABLE characters ADD COLUMN quadrant TEXT DEFAULT 'E5'"); } catch(e) {}

// Admin account
const adminRow = db.prepare('SELECT id FROM accounts WHERE username = ?').get('admin');
if (!adminRow) {
  const hash = bcrypt.hashSync('#Batata123', 10);
  const res = db.prepare('INSERT INTO accounts (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hash);
  db.prepare(`INSERT INTO characters (account_id, silver, max_hp, hp, level, xp, skill_points, strength, intelligence, vitality, defense, luck)
    VALUES (?, 99999, 100, 100, 50, 0, 50, 10, 10, 10, 10, 10)`).run(res.lastInsertRowid);
} else {
  // Ensure existing admin account has is_admin flag
  db.prepare('UPDATE accounts SET is_admin = 1 WHERE username = ?').run('admin');
}

// Give espada_enferrujada to admin and Sheldon if they don't have one
(function giveStarterSwords() {
  const accs = db.prepare("SELECT id, username FROM accounts WHERE username IN ('admin', 'Sheldon')").all();
  for (const acc of accs) {
    const char = db.prepare('SELECT id FROM characters WHERE account_id = ?').get(acc.id);
    if (!char) continue;
    const has = db.prepare("SELECT id FROM inventory WHERE character_id = ? AND item_id = 'espada_enferrujada'").get(char.id);
    if (!has) {
      db.prepare("INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, 'espada_enferrujada', 1)").run(char.id);
      console.log(`Espada enferrujada dada para ${acc.username}`);
    }
  }
})();

// ============================
// GAME DATA DEFINITIONS
// ============================
const ITEMS = {
  espada_enferrujada: {
    id: 'espada_enferrujada', name: 'Espada Enferrujada', type: 'weapon',
    hands: 1, damage: 2, icon: '/assets/icons/swords/enferrujada.png',
    description: 'Uma espada velha e enferrujada. Dano: 2'
  },
  pocao_cura: {
    id: 'pocao_cura', name: 'Poção de Cura', type: 'consumable',
    healAmount: 10, description: 'Restaura 10 de vida.'
  },
  couro_simples: {
    id: 'couro_simples', name: 'Couro Simples', type: 'material',
    icon: '/assets/sprites/cow/courosimples.png',
    stackMax: 10,
    description: 'Um pedaço de couro rústico retirado de uma vaca.'
  },
  tunica_couro_simples: {
    id: 'tunica_couro_simples', name: 'Túnica de Couro Simples', type: 'chest',
    defense: 2, icon: '/assets/icons/peitorais/tunicacourosimples.png',
    description: 'Uma túnica feita de couro simples. Defesa: +2'
  }
};

// Receitas de crafting do Artesão
const CRAFT_RECIPES = {
  tunica_couro_simples: {
    resultId: 'tunica_couro_simples', resultQty: 1,
    name: 'Túnica de Couro Simples',
    ingredients: [{ itemId: 'couro_simples', qty: 5 }],
    description: 'Requer 5x Couro Simples'
  }
};

const QUEST_DEFS = {
  padre_quest: {
    id: 'padre_quest', name: 'Ameaça dos Esqueletos', npcId: 'padre',
    description: 'Elimine 5 Esqueletos', target: 'skeleton', targetCount: 5,
    rewards: { silver: 20, xp: 100 },
    nextQuestId: 'padre_quest_2',
    requires: 'paladino_quest_2',
    dialogOffer: 'Meu filho, esqueletos estão aterrorizando os arredores! Elimine 5 esqueletos e eu te recompensarei com 20 pratas e experiência.',
    dialogComplete: 'Que Deus te abençoe, bravo guerreiro! Aqui está sua recompensa.',
    dialogProgress: 'Continue lutando contra os esqueletos. A cidade conta com você!'
  },
  padre_quest_2: {
    id: 'padre_quest_2', name: 'Purificação dos Campos', npcId: 'padre',
    description: 'Elimine 10 Esqueletos e 10 Slimes',
    targets: [
      { type: 'skeleton', count: 10 },
      { type: 'slime', count: 10 }
    ],
    rewards: { silver: 50, xp: 200 },
    dialogOffer: 'Você provou seu valor, guerreiro! Mas a ameaça ainda persiste. Elimine 10 Esqueletos e 10 Slimes para purificar os campos. Recompensa: 50 pratas e muita experiência.',
    dialogComplete: 'Incrível! Os campos estão purificados graças a você! Aqui está sua merecida recompensa.',
    dialogProgress: 'Continue eliminando os monstros. Os campos ainda não estão seguros!'
  },
  paladino_quest: {
    id: 'paladino_quest', name: 'Peste dos Slimes', npcId: 'paladino',
    description: 'Elimine 5 Slimes', target: 'slime', targetCount: 5,
    rewards: { silver: 10, xp: 50 },
    nextQuestId: 'paladino_quest_2',
    dialogOffer: 'Aventureiro! Os slimes estão se multiplicando na região sul. Elimine 5 deles e te darei 10 pratas e experiência.',
    dialogComplete: 'Excelente trabalho! A região está mais segura. Aqui está sua recompensa.',
    dialogProgress: 'Continue eliminando os slimes. Você está indo bem!'
  },
  paladino_quest_2: {
    id: 'paladino_quest_2', name: 'Invasão dos Slimes', npcId: 'paladino',
    description: 'Elimine 20 Slimes',
    targets: [
      { type: 'slime', count: 20 }
    ],
    rewards: { silver: 35, xp: 150 },
    dialogOffer: 'Aventureiro, os slimes estão se espalhando mais do que nunca! Precisamos de uma limpeza maior. Elimine 20 slimes e te darei 35 pratas e boa experiência.',
    dialogComplete: 'Magnífico! Você é um verdadeiro herói! Aqui está sua recompensa.',
    dialogProgress: 'Continue eliminando os slimes. Ainda há muitos por aí!'
  }
};

// ============================
// QUEST HELPER FUNCTIONS
// ============================
function getCurrentQuestForNpc(firstQuestId, charId) {
  let questId = firstQuestId;
  while (questId) {
    const qRow = db.prepare('SELECT * FROM quests WHERE character_id = ? AND quest_id = ?').get(charId, questId);
    if (!qRow || qRow.status !== 'completed') {
      return questId;
    }
    const qDef = QUEST_DEFS[questId];
    questId = qDef && qDef.nextQuestId ? qDef.nextQuestId : null;
  }
  return null;
}

function isQuestComplete(qDef, qRow) {
  if (qDef.targets) {
    let progressData = {};
    try { progressData = JSON.parse(qRow.progress_data || '{}'); } catch(e) {}
    return qDef.targets.every(t => (progressData[t.type] || 0) >= t.count);
  }
  return qRow.progress >= qDef.targetCount;
}

function getEnemyTypeName(type) {
  const names = { skeleton: 'Esqueletos', slime: 'Slimes', cow: 'Vacas' };
  return names[type] || type;
}

function getQuestProgressStr(qDef, qRow) {
  if (qDef.targets) {
    let progressData = {};
    try { progressData = JSON.parse(qRow.progress_data || '{}'); } catch(e) {}
    return qDef.targets.map(t => {
      const name = getEnemyTypeName(t.type);
      return `${name}: ${progressData[t.type] || 0}/${t.count}`;
    }).join(', ');
  }
  return `${qRow.progress}/${qDef.targetCount}`;
}

const NPC_DEFS = [
  { id: 'padre', name: 'Padre', x: 40, y: 15, sprite: 'padre', questId: 'padre_quest',
    dialog: 'Que a paz esteja com você, meu filho.', quadrant: 'E5' },
  { id: 'paladino', name: 'Paladino', x: 41, y: 26, sprite: 'paladino', questId: 'paladino_quest',
    dialog: 'Saudações, aventureiro!', quadrant: 'E5' },
  { id: 'ferreiro', name: 'Ferreiro', x: 60, y: 26, sprite: 'ferreiro', questId: null,
    dialog: 'Bem-vindo à minha ferraria! Infelizmente ainda não tenho equipamentos para venda. Volte em breve!',
    isShop: true, shopItems: [], quadrant: 'E5' },
  { id: 'artesao', name: 'Artesão', x: 14, y: 20, sprite: 'artesao', questId: null,
    dialog: 'Bem-vindo à minha oficina! Traga-me materiais e eu posso criar equipamentos para você.',
    isCrafter: true, quadrant: 'E5' }
];

// ============================
// QUADRANT DEFINITIONS
// ============================
const QUADRANTS = {
  E5: { id: 'E5', name: 'Cidade de Origens', neighbors: { left: 'E4', right: null, up: null, down: null }, spawnX: 40, spawnY: 30 },
  E4: { id: 'E4', name: 'Planície Verde', neighbors: { left: null, right: 'E5', up: null, down: null }, spawnX: 70, spawnY: 30 }
};

// ============================
// MAP GENERATION
// ============================
const MAP_W = 80;
const MAP_H = 60;
const T = { GRASS:0, DIRT:1, STONE_PATH:2, STONE_WALL:3, WATER:4, TREE:5, WOOD_FLOOR:6, CHURCH_FLOOR:7, WOOD_WALL:8, SAND:9,
  FLOWERS:10, BUSH:11, ROCK:12, RED_CARPET:13, ALTAR:14, ANVIL:15, FURNACE:16, BOOKSHELF:17, TABLE:18, CHAIR:19,
  WELL:20, FENCE:21, ROOF_STONE:22, ROOF_WOOD:23, WINDOW_STONE:24, WINDOW_WOOD:25, CROSS:26, TALL_GRASS:27, MUSHROOM:28,
  BARREL:29, CRATE:30, TORCH_WALL:31, BED:32, RUG:33, CHURCH_PEW:34, DARK_GRASS:35,
  GRAVESTONE:36, DEAD_TREE:37, BONE:38, MUD:39, HAY:40 };
const BLOCKED_TILES = new Set([T.STONE_WALL, T.WATER, T.TREE, T.WOOD_WALL, T.BUSH, T.ROCK, T.ANVIL, T.FURNACE,
  T.BOOKSHELF, T.WELL, T.FENCE, T.BARREL, T.CRATE, T.BED, T.TORCH_WALL, T.GRAVESTONE, T.DEAD_TREE, T.HAY]);

function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateMapE5() {
  const map = Array.from({length: MAP_H}, () => Array(MAP_W).fill(T.GRASS));
  const rng = mulberry32(42);

  // Tree border
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      if (x < 3 || x >= MAP_W-3 || y < 3 || y >= MAP_H-3) map[y][x] = T.TREE;

  // Open passage on left side (connection to E4)
  for (let y = 15; y <= 45; y++)
    for (let x = 0; x < 3; x++)
      map[y][x] = T.GRASS;

  // Water lake NE with more natural shape
  for (let y = 4; y <= 14; y++)
    for (let x = 58; x <= 76; x++) {
      const d = Math.sqrt((x-67)**2 + (y-9)**2);
      const noise = Math.sin(x*0.7)*0.8 + Math.cos(y*0.9)*0.6;
      if (d + noise < 4.5) map[y][x] = T.WATER;
      else if (d + noise < 5.5 && map[y][x] === T.GRASS) map[y][x] = T.SAND;
    }

  // Main road E-W (wider, more detailed)
  for (let x = 0; x <= 74; x++) { map[27][x] = T.STONE_PATH; map[28][x] = T.STONE_PATH; }
  // Church path
  for (let y = 25; y <= 27; y++) for (let x = 38; x <= 42; x++) map[y][x] = T.STONE_PATH;
  // West path (houses) 
  for (let y = 22; y <= 34; y++) { map[y][14] = T.STONE_PATH; map[y][15] = T.STONE_PATH; }
  // East path (blacksmith)
  for (let y = 22; y <= 27; y++) { map[y][60] = T.STONE_PATH; map[y][61] = T.STONE_PATH; }
  // Small plaza in front of church
  for (let y = 25; y <= 27; y++)
    for (let x = 36; x <= 44; x++) map[y][x] = T.STONE_PATH;

  // === CHURCH === (bigger, more detailed)
  buildWalls(map, 33, 13, 15, 13, T.STONE_WALL, T.CHURCH_FLOOR);
  map[25][40] = T.CHURCH_FLOOR; // main door
  // Church roof decoration (top row)
  for (let x = 34; x <= 46; x++) map[13][x] = T.STONE_WALL;
  // Windows on church walls
  map[16][33] = T.WINDOW_STONE; map[20][33] = T.WINDOW_STONE;
  map[16][47] = T.WINDOW_STONE; map[20][47] = T.WINDOW_STONE;
  // Torch on walls
  map[17][34] = T.TORCH_WALL; map[21][34] = T.TORCH_WALL;
  map[17][46] = T.TORCH_WALL; map[21][46] = T.TORCH_WALL;
  // Red carpet aisle
  for (let y = 15; y <= 24; y++) map[y][40] = T.RED_CARPET;
  // Altar at the back
  map[14][39] = T.ALTAR; map[14][40] = T.ALTAR; map[14][41] = T.ALTAR;
  // Cross above altar
  map[14][40] = T.CROSS;
  // Church pews
  for (let y = 17; y <= 23; y += 2) {
    map[y][36] = T.CHURCH_PEW; map[y][37] = T.CHURCH_PEW;
    map[y][43] = T.CHURCH_PEW; map[y][44] = T.CHURCH_PEW;
  }
  // Bookshelves in church
  map[14][35] = T.BOOKSHELF; map[14][45] = T.BOOKSHELF;

  // === HOUSE 1 (left, top) - Casa do Artesão ===
  buildWalls(map, 10, 16, 9, 8, T.WOOD_WALL, T.WOOD_FLOOR);
  map[23][14] = T.WOOD_FLOOR; // door south
  // Window
  map[16][14] = T.WINDOW_WOOD;
  map[19][10] = T.WINDOW_WOOD;
  // Furniture - itens de artesão
  map[17][11] = T.TABLE; map[17][12] = T.TABLE;
  map[17][17] = T.BOOKSHELF;
  map[22][17] = T.BARREL; map[22][18] = T.CRATE;
  map[20][11] = T.ANVIL;
  map[22][11] = T.BARREL;
  // Rug
  map[19][14] = T.RUG; map[20][14] = T.RUG;

  // === HOUSE 2 (left, bottom) ===
  buildWalls(map, 10, 33, 9, 8, T.WOOD_WALL, T.WOOD_FLOOR);
  map[33][14] = T.WOOD_FLOOR; // door north
  // Window
  map[40][14] = T.WINDOW_WOOD;
  map[36][10] = T.WINDOW_WOOD;
  // Furniture
  map[34][11] = T.TABLE; map[34][12] = T.CHAIR; map[34][13] = T.CHAIR;
  map[39][11] = T.BED; map[39][12] = T.BED;
  map[34][17] = T.BARREL;
  map[37][14] = T.RUG; map[38][14] = T.RUG;

  // === BLACKSMITH ===
  buildWalls(map, 55, 16, 12, 8, T.WOOD_WALL, T.WOOD_FLOOR);
  map[23][60] = T.WOOD_FLOOR; // door south
  map[23][61] = T.WOOD_FLOOR; // wider door
  // Windows on blacksmith
  map[16][60] = T.WINDOW_WOOD;
  map[19][55] = T.WINDOW_WOOD;
  map[19][66] = T.WINDOW_WOOD;
  // Anvil and furnace inside
  map[17][57] = T.FURNACE; map[17][58] = T.FURNACE;
  map[19][57] = T.ANVIL;
  // Barrels and crates
  map[22][64] = T.BARREL; map[22][65] = T.BARREL;
  map[17][64] = T.CRATE; map[17][65] = T.CRATE;
  // Torch inside
  map[18][56] = T.TORCH_WALL;

  // === WELL in town plaza ===
  map[26][35] = T.WELL;

  // === FENCES around houses ===
  for (let x = 8; x <= 20; x++) {
    if (map[15][x] === T.GRASS) map[15][x] = T.FENCE;
    if (map[42][x] === T.GRASS) map[42][x] = T.FENCE;
  }
  for (let y = 15; y <= 25; y++) if (map[y][8] === T.GRASS) map[y][8] = T.FENCE;
  for (let y = 15; y <= 25; y++) if (map[y][20] === T.GRASS) map[y][20] = T.FENCE;
  for (let y = 31; y <= 42; y++) if (map[y][8] === T.GRASS) map[y][8] = T.FENCE;
  for (let y = 31; y <= 42; y++) if (map[y][20] === T.GRASS) map[y][20] = T.FENCE;

  // === ENVIRONMENT DECORATION ===
  // Scatter flowers, tall grass, bushes, mushrooms, rocks
  for (let i = 0; i < 350; i++) {
    const tx = 4 + Math.floor(rng() * (MAP_W - 8));
    const ty = 4 + Math.floor(rng() * (MAP_H - 8));
    if (map[ty][tx] !== T.GRASS) continue;
    // Avoid building areas
    if (tx >= 8 && tx <= 68 && ty >= 12 && ty <= 42) {
      // Only flowers and tall grass in town
      const r = rng();
      if (r < 0.3) map[ty][tx] = T.FLOWERS;
      else if (r < 0.5) map[ty][tx] = T.TALL_GRASS;
    } else {
      // Wilderness: more variety
      const r = rng();
      if (r < 0.25) map[ty][tx] = T.TREE;
      else if (r < 0.35) map[ty][tx] = T.BUSH;
      else if (r < 0.42) map[ty][tx] = T.FLOWERS;
      else if (r < 0.50) map[ty][tx] = T.TALL_GRASS;
      else if (r < 0.55) map[ty][tx] = T.ROCK;
      else if (r < 0.58) map[ty][tx] = T.MUSHROOM;
    }
  }

  // Dark grass patches for variety
  for (let i = 0; i < 120; i++) {
    const tx = 4 + Math.floor(rng() * (MAP_W - 8));
    const ty = 4 + Math.floor(rng() * (MAP_H - 8));
    if (map[ty][tx] === T.GRASS) map[ty][tx] = T.DARK_GRASS;
  }

  // === CEMITÉRIO (área dos esqueletos) ===
  // Chão de terra
  for (let y = 36; y <= 51; y++)
    for (let x = 58; x <= 72; x++)
      map[y][x] = T.DIRT;

  // Muro de pedra ao redor
  for (let x = 57; x <= 73; x++) { map[35][x] = T.STONE_WALL; map[52][x] = T.STONE_WALL; }
  for (let y = 35; y <= 52; y++) { map[y][57] = T.STONE_WALL; map[y][73] = T.STONE_WALL; }

  // Portões de entrada (4 lados)
  // Sul
  map[52][64] = T.STONE_PATH; map[52][65] = T.STONE_PATH;
  // Norte
  map[35][64] = T.STONE_PATH; map[35][65] = T.STONE_PATH;
  // Oeste
  map[43][57] = T.STONE_PATH; map[44][57] = T.STONE_PATH;
  // Leste
  map[43][73] = T.STONE_PATH; map[44][73] = T.STONE_PATH;

  // Lápides em fileiras organizadas
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) {
      const gx = 60 + col * 3;
      const gy = 37 + row * 3;
      if (gx <= 71 && gy <= 50)
        map[gy][gx] = T.GRAVESTONE;
    }

  // Árvores mortas
  map[36][59] = T.DEAD_TREE; map[36][71] = T.DEAD_TREE;
  map[51][59] = T.DEAD_TREE; map[51][71] = T.DEAD_TREE;
  map[44][67] = T.DEAD_TREE;

  // Ossos espalhados
  const bonePos = [[61,39],[64,38],[68,40],[70,42],[59,45],[62,47],[66,49],[71,48],[63,51],[69,36]];
  for (const [bx, by] of bonePos)
    if (map[by][bx] === T.DIRT) map[by][bx] = T.BONE;

  // Grama escura ao redor do cemitério
  for (let y = 33; y <= 54; y++)
    for (let x = 55; x <= 75; x++) {
      if (x >= 57 && x <= 73 && y >= 35 && y <= 52) continue;
      if (x >= 3 && x < MAP_W-3 && y >= 3 && y < MAP_H-3 && map[y][x] === T.GRASS)
        map[y][x] = T.DARK_GRASS;
    }

  // === FAZENDA DE SLIMES (área cercada) ===
  // Chão de lama
  for (let y = 43; y <= 52; y++)
    for (let x = 7; x <= 22; x++)
      map[y][x] = T.MUD;

  // Cerca ao redor
  for (let x = 6; x <= 23; x++) { map[42][x] = T.FENCE; map[53][x] = T.FENCE; }
  for (let y = 42; y <= 53; y++) { map[y][6] = T.FENCE; map[y][23] = T.FENCE; }

  // Portões (4 lados)
  // Norte
  map[42][14] = T.MUD; map[42][15] = T.MUD;
  // Sul
  map[53][14] = T.MUD; map[53][15] = T.MUD;
  // Oeste
  map[47][6] = T.MUD; map[48][6] = T.MUD;
  // Leste
  map[47][23] = T.MUD; map[48][23] = T.MUD;

  // Fardos de feno
  map[44][8] = T.HAY; map[44][9] = T.HAY;
  map[44][20] = T.HAY; map[44][21] = T.HAY;
  map[51][8] = T.HAY; map[51][21] = T.HAY;
  map[48][15] = T.HAY;

  return map;
}

function buildWalls(map, sx, sy, w, h, wallTile, floorTile) {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) {
      if (dy === 0 || dy === h-1 || dx === 0 || dx === w-1)
        map[sy+dy][sx+dx] = wallTile;
      else
        map[sy+dy][sx+dx] = floorTile;
    }
}

// ============================
// E4 MAP - PLANÍCIE VERDE
// ============================
function generateMapE4() {
  const map = Array.from({length: MAP_H}, () => Array(MAP_W).fill(T.GRASS));
  const rng = mulberry32(99);

  // Tree border (open on right side where it connects to E5)
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (x < 3 || y < 3 || y >= MAP_H-3) map[y][x] = T.TREE;
      if (x >= MAP_W-3 && (y < 15 || y > 45)) map[y][x] = T.TREE;
    }

  // Dirt path connecting to E5 on the right
  for (let x = 30; x < MAP_W; x++) { map[27][x] = T.DIRT; map[28][x] = T.DIRT; }

  // Small pond
  for (let y = 22; y <= 32; y++)
    for (let x = 15; x <= 25; x++) {
      const d = Math.sqrt((x-20)**2 + (y-27)**2);
      const noise = Math.sin(x*0.5)*0.5 + Math.cos(y*0.7)*0.3;
      if (d + noise < 3.5) map[y][x] = T.WATER;
      else if (d + noise < 4.5 && map[y][x] === T.GRASS) map[y][x] = T.SAND;
    }

  // Scattered decoration - plains feel
  for (let i = 0; i < 500; i++) {
    const tx = 4 + Math.floor(rng() * (MAP_W - 8));
    const ty = 4 + Math.floor(rng() * (MAP_H - 8));
    if (map[ty][tx] !== T.GRASS) continue;
    const r = rng();
    if (r < 0.20) map[ty][tx] = T.FLOWERS;
    else if (r < 0.38) map[ty][tx] = T.TALL_GRASS;
    else if (r < 0.42) map[ty][tx] = T.BUSH;
    else if (r < 0.45) map[ty][tx] = T.TREE;
    else if (r < 0.47) map[ty][tx] = T.ROCK;
    else if (r < 0.49) map[ty][tx] = T.MUSHROOM;
  }

  // Dark grass patches for variety
  for (let i = 0; i < 200; i++) {
    const tx = 4 + Math.floor(rng() * (MAP_W - 8));
    const ty = 4 + Math.floor(rng() * (MAP_H - 8));
    if (map[ty][tx] === T.GRASS) map[ty][tx] = T.DARK_GRASS;
  }

  // A few fence sections for farmland feel
  for (let x = 40; x <= 55; x++) { map[15][x] = T.FENCE; map[24][x] = T.FENCE; }
  for (let y = 15; y <= 24; y++) { map[y][40] = T.FENCE; map[y][55] = T.FENCE; }
  // Open gates
  map[15][47] = T.GRASS; map[15][48] = T.GRASS;
  map[24][47] = T.GRASS; map[24][48] = T.GRASS;

  // Hay bales inside fenced area
  map[17][43] = T.HAY; map[17][44] = T.HAY;
  map[22][52] = T.HAY; map[22][53] = T.HAY;
  map[20][48] = T.HAY;

  return map;
}

const gameMaps = {
  E5: generateMapE5(),
  E4: generateMapE4()
};

function isBlocked(x, y, quadrant) {
  if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return true;
  const map = gameMaps[quadrant || 'E5'];
  return BLOCKED_TILES.has(map[Math.floor(y)][Math.floor(x)]);
}

function canMoveTo(x, y, quadrant) {
  const pad = 0.25;
  return !isBlocked(x - pad, y - pad, quadrant) && !isBlocked(x + pad, y - pad, quadrant)
    && !isBlocked(x - pad, y + pad, quadrant) && !isBlocked(x + pad, y + pad, quadrant);
}

// ============================
// ENEMIES
// ============================
const enemies = [];

function spawnEnemies() {
  const rng = mulberry32(123);
  // E5 - Esqueletos (cemitério)
  for (let i = 0; i < 8; i++) {
    let x, y, attempts = 0;
    do { x = 59 + Math.floor(rng() * 13); y = 37 + Math.floor(rng() * 14); attempts++; }
    while (isBlocked(x, y, 'E5') && attempts < 50);
    enemies.push({
      id: `skeleton_${i}`, type: 'skeleton', x, y, spawnX: x, spawnY: y,
      hp: 15, maxHp: 15, damage: 1, dead: false, deathTime: 0,
      direction: 'right', lastAttack: 0, lastWander: 0,
      quadrant: 'E5'
    });
  }
  // E5 - Slimes (fazenda)
  for (let i = 0; i < 8; i++) {
    let x, y, attempts = 0;
    do { x = 7 + Math.floor(rng() * 16); y = 43 + Math.floor(rng() * 10); attempts++; }
    while (isBlocked(x, y, 'E5') && attempts < 50);
    enemies.push({
      id: `slime_${i}`, type: 'slime', x, y, spawnX: x, spawnY: y,
      hp: 5, maxHp: 5, damage: 0, dead: false, deathTime: 0,
      direction: 'right', lastAttack: 0, lastWander: 0,
      quadrant: 'E5'
    });
  }
  // E4 - Vacas (Planície Verde)
  const grassTiles = new Set([T.GRASS, T.DARK_GRASS, T.TALL_GRASS, T.FLOWERS]);
  for (let i = 0; i < 8; i++) {
    let x, y, attempts = 0;
    do {
      x = 5 + Math.floor(rng() * (MAP_W - 10));
      y = 5 + Math.floor(rng() * (MAP_H - 10));
      attempts++;
    } while ((
      isBlocked(x, y, 'E4') ||
      !grassTiles.has(gameMaps['E4'][Math.floor(y)][Math.floor(x)])
    ) && attempts < 200);
    enemies.push({
      id: `cow_${i}`, type: 'cow', x, y, spawnX: x, spawnY: y,
      hp: 20, maxHp: 20, damage: 0, dead: false, deathTime: 0,
      direction: 'right', lastAttack: 0, lastWander: 0,
      fleeTarget: null, lastHitTime: 0, animState: 'idle', animTimer: 0,
      quadrant: 'E4'
    });
  }
}
spawnEnemies();

// ============================
// GROUND ITEMS
// ============================
const groundItems = [];
let groundItemIdCounter = 0;

function spawnGroundItem(itemId, quantity, x, y, quadrant) {
  const item = ITEMS[itemId];
  if (!item) return;
  groundItemIdCounter++;
  groundItems.push({
    gid: groundItemIdCounter,
    itemId, quantity, x, y,
    name: item.name,
    icon: item.icon || null,
    type: item.type,
    spawnTime: Date.now(),
    quadrant: quadrant || 'E5'
  });
}

// ============================
// PLAYERS
// ============================
const players = {};

function loadCharacter(accountId) {
  const char = db.prepare('SELECT * FROM characters WHERE account_id = ?').get(accountId);
  const inv = db.prepare('SELECT * FROM inventory WHERE character_id = ?').all(char.id);
  const quests = db.prepare('SELECT * FROM quests WHERE character_id = ?').all(char.id);
  return { ...char, inventory: inv, quests };
}

function saveCharacter(p) {
  if (!p || !p.charId) return;
  db.prepare(`UPDATE characters SET x=?, y=?, hp=?, max_hp=?, level=?, xp=?, silver=?,
    strength=?, intelligence=?, vitality=?, defense=?, luck=?, skill_points=?,
    equipped_weapon=?, equipped_armor=?, equipped_helmet=?, equipped_chest=?,
    equipped_legs=?, equipped_boots=?, equipped_ring1=?, equipped_ring2=?,
    equipped_weapon2=?, direction=?, quadrant=? WHERE id=?`).run(
    p.x, p.y, p.hp, p.max_hp, p.level, p.xp, p.silver,
    p.strength, p.intelligence, p.vitality, p.defense, p.luck, p.skill_points,
    p.equipped_weapon, p.equipped_armor, p.equipped_helmet || '', p.equipped_chest || '',
    p.equipped_legs || '', p.equipped_boots || '', p.equipped_ring1 || '', p.equipped_ring2 || '',
    p.equipped_weapon2 || '', p.direction, p.quadrant || 'E5', p.charId
  );
}

function getPlayerDamage(p) {
  let dmg = 1; // bare hand
  // Arma mão 1
  if (p.equipped_weapon && ITEMS[p.equipped_weapon]) {
    const wep = ITEMS[p.equipped_weapon];
    if (p.intelligence >= (wep.reqIntelligence || 0)) {
      dmg = wep.damage;
    }
  }
  // Arma mão 2 (se não for arma de 2 mãos na mão 1)
  if (p.equipped_weapon2 && ITEMS[p.equipped_weapon2]) {
    const wep2 = ITEMS[p.equipped_weapon2];
    if (wep2.type === 'weapon' && wep2.damage) {
      dmg += Math.floor(wep2.damage * 0.5); // mão secundária dá 50% do dano
    }
  }
  return dmg + p.strength;
}

function getPlayerDefenseBonus(p) {
  let def = 0;
  const slots = ['equipped_armor', 'equipped_helmet', 'equipped_chest', 'equipped_legs', 'equipped_boots', 'equipped_ring1', 'equipped_ring2', 'equipped_weapon2'];
  for (const slot of slots) {
    const itemId = p[slot];
    if (itemId && ITEMS[itemId] && ITEMS[itemId].defense) {
      def += ITEMS[itemId].defense;
    }
  }
  return def;
}

function xpForLevel(level) { return level * 100; }

function checkLevelUp(p) {
  let leveled = false;
  while (p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level++;
    p.skill_points++;
    p.max_hp = 25 + p.vitality;
    p.hp = p.max_hp;
    leveled = true;
  }
  return leveled;
}

function grantXP(p, amount) {
  p.xp += amount;
  if (checkLevelUp(p)) {
    p.socket.emit('levelUp', { level: p.level, hp: p.hp, max_hp: p.max_hp, skill_points: p.skill_points });
    io.emit('chat', { sender: 'Sistema', message: `${p.username} subiu para o nível ${p.level}!`, color: '#ffd700' });
  }
  p.socket.emit('xpUpdate', { xp: p.xp, xpNeeded: xpForLevel(p.level) });
}

function sendFullState(p) {
  p.socket.emit('charData', {
    username: p.username, x: p.x, y: p.y, hp: p.hp, max_hp: p.max_hp,
    level: p.level, xp: p.xp, xpNeeded: xpForLevel(p.level), silver: p.silver,
    strength: p.strength, intelligence: p.intelligence, vitality: p.vitality,
    defense: p.defense, luck: p.luck, skill_points: p.skill_points,
    equipped_weapon: p.equipped_weapon, equipped_armor: p.equipped_armor,
    equipped_helmet: p.equipped_helmet || '', equipped_chest: p.equipped_chest || '',
    equipped_legs: p.equipped_legs || '', equipped_boots: p.equipped_boots || '',
    equipped_ring1: p.equipped_ring1 || '', equipped_ring2: p.equipped_ring2 || '',
    equipped_weapon2: p.equipped_weapon2 || '',
    direction: p.direction, isAdmin: p.isAdmin,
    quadrant: p.quadrant || 'E5'
  });
  // Send inventory
  const inv = db.prepare('SELECT * FROM inventory WHERE character_id = ?').all(p.charId);
  p.socket.emit('inventoryUpdate', inv.map(i => ({ ...i, ...ITEMS[i.item_id] })));
  // Send quests
  const quests = db.prepare('SELECT * FROM quests WHERE character_id = ?').all(p.charId);
  p.socket.emit('questsUpdate', quests.map(q => ({ ...q, ...QUEST_DEFS[q.quest_id] })));
}

// ============================
// SOCKET.IO
// ============================
io.on('connection', (socket) => {
  console.log('Conexão:', socket.id);

  socket.on('register', ({ username, password }, cb) => {
    if (!username || !password || username.length < 3 || password.length < 4) {
      return cb({ error: 'Nome deve ter 3+ caracteres e senha 4+ caracteres.' });
    }
    const exists = db.prepare('SELECT id FROM accounts WHERE username = ?').get(username);
    if (exists) return cb({ error: 'Este nome já está em uso! Escolha outro.' });
    const hash = bcrypt.hashSync(password, 10);
    const res = db.prepare('INSERT INTO accounts (username, password_hash) VALUES (?, ?)').run(username, hash);
    db.prepare('INSERT INTO characters (account_id) VALUES (?)').run(res.lastInsertRowid);
    cb({ success: true });
  });

  socket.on('login', ({ username, password }, cb) => {
    const acc = db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
    if (!acc) return cb({ error: 'Conta não encontrada.' });
    if (!bcrypt.compareSync(password, acc.password_hash)) return cb({ error: 'Senha incorreta.' });
    // Check if already logged in - remove stale sessions from same account
    for (const [sid, pl] of Object.entries(players)) {
      if (pl.accountId === acc.id) {
        // If same socket reconnected, remove old session
        if (!pl.socket.connected) {
          saveCharacter(pl);
          delete players[sid];
        } else {
          return cb({ error: 'Esta conta já está conectada.' });
        }
      }
    }
    const char = loadCharacter(acc.id);
    const playerQuadrant = char.quadrant || 'E5';
    const p = {
      socket, accountId: acc.id, charId: char.id,
      username: acc.username, isAdmin: acc.is_admin === 1,
      x: char.x, y: char.y, hp: char.hp, max_hp: char.max_hp,
      level: char.level, xp: char.xp, silver: char.silver,
      strength: char.strength, intelligence: char.intelligence,
      vitality: char.vitality, defense: char.defense, luck: char.luck,
      skill_points: char.skill_points,
      equipped_weapon: char.equipped_weapon, equipped_armor: char.equipped_armor,
      equipped_helmet: char.equipped_helmet || '', equipped_chest: char.equipped_chest || '',
      equipped_legs: char.equipped_legs || '', equipped_boots: char.equipped_boots || '',
      equipped_ring1: char.equipped_ring1 || '', equipped_ring2: char.equipped_ring2 || '',
      equipped_weapon2: char.equipped_weapon2 || '',
      direction: char.direction || 'right',
      moving: false, lastCombatTime: 0, lastRegenTime: Date.now(),
      targetId: null, lastAttackTime: 0,
      quadrant: playerQuadrant
    };
    p.max_hp = 25 + p.vitality;
    if (p.hp > p.max_hp) p.hp = p.max_hp;
    players[socket.id] = p;
    // Send map & NPCs for current quadrant
    const qDef = QUADRANTS[playerQuadrant];
    socket.emit('mapData', {
      map: gameMaps[playerQuadrant], width: MAP_W, height: MAP_H, tileTypes: T,
      quadrant: playerQuadrant, quadrantName: qDef.name, neighbors: qDef.neighbors
    });
    socket.emit('npcData', NPC_DEFS.filter(n => n.quadrant === playerQuadrant));
    sendFullState(p);
    io.emit('chat', { sender: 'Sistema', message: `${p.username} entrou no jogo.`, color: '#8f8' });
    cb({ success: true });
  });

  socket.on('move', (data) => {
    const p = players[socket.id];
    if (!p) return;
    const { x, y, direction, moving } = data;
    // Validate movement (basic anti-cheat: max 0.2 tiles per tick)
    const dx = x - p.x, dy = y - p.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > 1) return; // too far, reject
    if (canMoveTo(x, y, p.quadrant)) {
      p.x = x; p.y = y;
    }
    p.direction = direction;
    p.moving = moving;
  });

  // Quadrant transition
  socket.on('changeQuadrant', ({ direction }) => {
    const p = players[socket.id];
    if (!p) return;
    const qDef = QUADRANTS[p.quadrant];
    if (!qDef) return;
    const newQuadrant = qDef.neighbors[direction];
    if (!newQuadrant || !QUADRANTS[newQuadrant]) return;
    const newQDef = QUADRANTS[newQuadrant];
    // Reposition player on the opposite edge, preserving the other axis
    if (direction === 'left') { p.x = MAP_W - 4; /* keep p.y */ }
    else if (direction === 'right') { p.x = 4; /* keep p.y */ }
    else if (direction === 'up') { p.y = MAP_H - 4; /* keep p.x */ }
    else if (direction === 'down') { p.y = 4; /* keep p.x */ }
    // Ensure player lands on a non-blocked tile
    if (!canMoveTo(p.x, p.y, newQuadrant)) {
      // Try nearby positions
      let found = false;
      for (let r = 1; r <= 10 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const tx = p.x + dx, ty = p.y + dy;
            if (tx >= 1 && tx < MAP_W - 1 && ty >= 1 && ty < MAP_H - 1 && canMoveTo(tx, ty, newQuadrant)) {
              p.x = tx; p.y = ty; found = true;
            }
          }
        }
      }
      if (!found) { p.x = newQDef.spawnX; p.y = newQDef.spawnY; }
    }
    p.quadrant = newQuadrant;
    // Send new map & NPCs
    socket.emit('mapData', {
      map: gameMaps[newQuadrant], width: MAP_W, height: MAP_H, tileTypes: T,
      quadrant: newQuadrant, quadrantName: newQDef.name, neighbors: newQDef.neighbors
    });
    socket.emit('npcData', NPC_DEFS.filter(n => n.quadrant === newQuadrant));
    sendFullState(p);
    saveCharacter(p);
    socket.emit('chat', { sender: 'Sistema', message: `Entrou em ${newQDef.name} [${newQuadrant}]`, color: '#aaddff' });
  });

  socket.on('attack', ({ targetId }) => {
    try {
    const p = players[socket.id];
    if (!p || p.hp <= 0) return;
    const now = Date.now();
    if (now - p.lastAttackTime < 1000) return; // cooldown
    const enemy = enemies.find(e => e.id === targetId && e.quadrant === p.quadrant);
    if (!enemy || enemy.dead) return;
    const dist = Math.sqrt((p.x - enemy.x)**2 + (p.y - enemy.y)**2);
    if (dist > 2) return; // out of range
    p.lastAttackTime = now;
    p.lastCombatTime = now;
    const dmg = getPlayerDamage(p);
    enemy.hp -= dmg;
    // Track hit time for cow flee behavior
    if (enemy.type === 'cow') {
      enemy.lastHitTime = now;
      enemy.animState = 'walking';
    }
    socket.emit('damageDealt', { targetId, damage: dmg, remainingHp: enemy.hp });
    if (enemy.hp <= 0) {
      enemy.dead = true;
      enemy.deathTime = now;
      // Loot
      let loot = [];
      if (enemy.type !== 'cow') {
        p.silver += 1;
        loot.push('1 Prata');
      }
      // Drop chance for espada - drops to ground (max 25%)
      const dropChance = Math.min(0.25, 0.05 + (p.luck * 0.005));
      if (enemy.type === 'skeleton' && Math.random() < dropChance) {
        spawnGroundItem('espada_enferrujada', 1, enemy.x + (Math.random() - 0.5) * 0.5, enemy.y + (Math.random() - 0.5) * 0.5, p.quadrant);
        loot.push('Espada Enferrujada');
        socket.emit('chat', { sender: 'Sistema', message: '⚔️ Uma Espada Enferrujada caiu no chão!', color: '#ff0' });
      }
      // Cow drops couro simples (0, 1, or 2)
      if (enemy.type === 'cow') {
        const couroQty = Math.floor(Math.random() * 3); // 0, 1, or 2
        if (couroQty > 0) {
          for (let ci = 0; ci < couroQty; ci++) {
            spawnGroundItem('couro_simples', 1, enemy.x + (Math.random() - 0.5) * 0.8, enemy.y + (Math.random() - 0.5) * 0.8, p.quadrant);
          }
          loot.push(`${couroQty}x Couro Simples`);
          socket.emit('chat', { sender: 'Sistema', message: `🐄 ${couroQty}x Couro Simples caiu no chão!`, color: '#c8a060' });
        }
      }
      // XP
      const xpGain = enemy.type === 'skeleton' ? 15 : (enemy.type === 'cow' ? 5 : 5);
      grantXP(p, xpGain);
      socket.emit('loot', { enemyId: targetId, loot, silver: p.silver, xpGain, x: enemy.x, y: enemy.y });
      // Quest progress
      updateQuestProgress(p, enemy.type);
      // Refresh inventory
      const inv = db.prepare('SELECT * FROM inventory WHERE character_id = ?').all(p.charId);
      socket.emit('inventoryUpdate', inv.map(i => ({ ...i, ...ITEMS[i.item_id] })));
      sendFullState(p);
    }
    } catch (err) {
      console.error('[ERRO] Attack handler:', err.message);
    }
  });

  socket.on('interact', ({ npcId }) => {
    const p = players[socket.id];
    if (!p) return;
    const npc = NPC_DEFS.find(n => n.id === npcId);
    if (!npc) return;
    const dist = Math.sqrt((p.x - npc.x)**2 + (p.y - npc.y)**2);
    if (dist > 3) return;
    // Artesão crafting
    if (npc.isCrafter) {
      socket.emit('npcDialog', {
        npcName: npc.name, message: npc.dialog, questId: null, action: 'none',
        isCrafter: true, recipes: Object.values(CRAFT_RECIPES).map(r => {
          const canCraft = r.ingredients.every(ing => {
            const invRows = db.prepare('SELECT SUM(quantity) as total FROM inventory WHERE character_id = ? AND item_id = ?').get(p.charId, ing.itemId);
            return invRows && invRows.total >= ing.qty;
          });
          return { ...r, canCraft };
        })
      });
      return;
    }
    if (npc.questId) {
      const currentQuestId = getCurrentQuestForNpc(npc.questId, p.charId);
      if (currentQuestId) {
        const qDef = QUEST_DEFS[currentQuestId];
        // Check prerequisites
        if (qDef.requires) {
          const reqQuest = db.prepare('SELECT * FROM quests WHERE character_id = ? AND quest_id = ? AND status = ?').get(p.charId, qDef.requires, 'completed');
          if (!reqQuest) {
            socket.emit('npcDialog', { npcName: npc.name, message: npc.dialog, questId: null, action: 'none' });
            return;
          }
        }
        let qRow = db.prepare('SELECT * FROM quests WHERE character_id = ? AND quest_id = ?').get(p.charId, currentQuestId);
        if (!qRow || qRow.status === 'not_started') {
          socket.emit('npcDialog', { npcName: npc.name, message: qDef.dialogOffer, questId: currentQuestId, action: 'offer' });
        } else if (qRow.status === 'in_progress') {
          if (isQuestComplete(qDef, qRow)) {
            socket.emit('npcDialog', { npcName: npc.name, message: qDef.dialogComplete, questId: currentQuestId, action: 'complete' });
          } else {
            const progressStr = getQuestProgressStr(qDef, qRow);
            socket.emit('npcDialog', { npcName: npc.name, message: qDef.dialogProgress + ` (${progressStr})`, questId: currentQuestId, action: 'progress' });
          }
        }
      } else {
        socket.emit('npcDialog', { npcName: npc.name, message: npc.dialog, questId: null, action: 'none' });
      }
    } else {
      socket.emit('npcDialog', { npcName: npc.name, message: npc.dialog, questId: null, action: 'none' });
    }
  });

  socket.on('acceptQuest', ({ questId }) => {
    const p = players[socket.id];
    if (!p) return;
    const qDef = QUEST_DEFS[questId];
    if (!qDef) return;
    const existing = db.prepare('SELECT * FROM quests WHERE character_id = ? AND quest_id = ?').get(p.charId, questId);
    if (existing && existing.status !== 'not_started') return;
    if (existing) {
      db.prepare('UPDATE quests SET status = ?, progress = 0, progress_data = ? WHERE character_id = ? AND quest_id = ?').run('in_progress', '{}', p.charId, questId);
    } else {
      db.prepare('INSERT INTO quests (character_id, quest_id, status, progress, progress_data) VALUES (?, ?, ?, 0, ?)').run(p.charId, questId, 'in_progress', '{}');
    }
    const quests = db.prepare('SELECT * FROM quests WHERE character_id = ?').all(p.charId);
    socket.emit('questsUpdate', quests.map(q => ({ ...q, ...QUEST_DEFS[q.quest_id] })));
    socket.emit('chat', { sender: 'Sistema', message: `Missão aceita: ${qDef.name}`, color: '#0ff' });
  });

  socket.on('completeQuest', ({ questId }) => {
    const p = players[socket.id];
    if (!p) return;
    const qDef = QUEST_DEFS[questId];
    if (!qDef) return;
    const qRow = db.prepare('SELECT * FROM quests WHERE character_id = ? AND quest_id = ?').get(p.charId, questId);
    if (!qRow || qRow.status !== 'in_progress') return;
    if (!isQuestComplete(qDef, qRow)) return;
    db.prepare('UPDATE quests SET status = ?, completed_at = ? WHERE character_id = ? AND quest_id = ?').run('completed', Date.now(), p.charId, questId);
    p.silver += qDef.rewards.silver;
    grantXP(p, qDef.rewards.xp);
    const quests = db.prepare('SELECT * FROM quests WHERE character_id = ?').all(p.charId);
    socket.emit('questsUpdate', quests.map(q => ({ ...q, ...QUEST_DEFS[q.quest_id] })));
    socket.emit('chat', { sender: 'Sistema', message: `Missão concluída: ${qDef.name}! +${qDef.rewards.silver} pratas, +${qDef.rewards.xp} XP`, color: '#0f0' });
    sendFullState(p);
  });

  socket.on('useSkillPoint', ({ skill }) => {
    const p = players[socket.id];
    if (!p || p.skill_points <= 0) return;
    const validSkills = ['vitality', 'strength', 'intelligence', 'defense', 'luck'];
    if (!validSkills.includes(skill)) return;
    p.skill_points--;
    p[skill]++;
    if (skill === 'vitality') {
      p.max_hp = 25 + p.vitality;
      p.hp = Math.min(p.hp + 1, p.max_hp);
    }
    saveCharacter(p);
    sendFullState(p);
  });

  socket.on('equipItem', ({ itemId, targetSlot }) => {
    const p = players[socket.id];
    if (!p) return;
    const item = ITEMS[itemId];
    if (!item) return;
    const invRow = db.prepare('SELECT * FROM inventory WHERE character_id = ? AND item_id = ?').get(p.charId, itemId);
    if (!invRow) return;

    if (item.type === 'weapon') {
      if (item.reqIntelligence && p.intelligence < item.reqIntelligence) {
        socket.emit('chat', { sender: 'Sistema', message: `Você precisa de ${item.reqIntelligence} de Inteligência para usar ${item.name}.`, color: '#f44' });
        return;
      }
      // Arma sempre vai na Mão 1 (Mão 2 é exclusivo pra escudo)
      if (item.hands === 2) {
        // Arma de 2 mãos: ocupa mão 1 e limpa escudo
        p.equipped_weapon = itemId;
        p.equipped_weapon2 = '';
      } else {
        // Arma de 1 mão: só pode ter UMA arma equipada (na mão 1)
        p.equipped_weapon = itemId;
      }
    } else if (item.type === 'helmet') {
      p.equipped_helmet = itemId;
    } else if (item.type === 'chest') {
      p.equipped_chest = itemId;
    } else if (item.type === 'legs') {
      p.equipped_legs = itemId;
    } else if (item.type === 'boots') {
      p.equipped_boots = itemId;
    } else if (item.type === 'ring') {
      if (targetSlot === 'ring2') {
        p.equipped_ring2 = itemId;
      } else if (!p.equipped_ring1) {
        p.equipped_ring1 = itemId;
      } else if (!p.equipped_ring2) {
        p.equipped_ring2 = itemId;
      } else {
        p.equipped_ring1 = itemId;
      }
    } else if (item.type === 'shield') {
      // Escudo vai no slot de arma 2
      const wep1 = ITEMS[p.equipped_weapon];
      if (wep1 && wep1.hands === 2) {
        socket.emit('chat', { sender: 'Sistema', message: 'Não pode usar escudo com arma de 2 mãos.', color: '#f44' });
        return;
      }
      p.equipped_weapon2 = itemId;
    } else if (item.type === 'armor') {
      p.equipped_armor = itemId;
    }
    saveCharacter(p);
    sendFullState(p);
    socket.emit('chat', { sender: 'Sistema', message: `Equipou: ${item.name}`, color: '#0ff' });
  });

  socket.on('unequipItem', ({ slot }) => {
    const p = players[socket.id];
    if (!p) return;
    const validSlots = ['weapon', 'armor', 'helmet', 'chest', 'legs', 'boots', 'ring1', 'ring2', 'weapon2'];
    if (!validSlots.includes(slot)) return;
    p['equipped_' + slot] = '';
    saveCharacter(p);
    sendFullState(p);
  });

  socket.on('craft', ({ recipeId }) => {
    const p = players[socket.id];
    if (!p) return;
    const recipe = CRAFT_RECIPES[recipeId];
    if (!recipe) return;
    // Verify ingredients
    for (const ing of recipe.ingredients) {
      const invRow = db.prepare('SELECT SUM(quantity) as total FROM inventory WHERE character_id = ? AND item_id = ?').get(p.charId, ing.itemId);
      if (!invRow || invRow.total < ing.qty) {
        socket.emit('chat', { sender: 'Sistema', message: `Materiais insuficientes para criar ${recipe.name}.`, color: '#f44' });
        return;
      }
    }
    // Consume ingredients
    for (const ing of recipe.ingredients) {
      let remaining = ing.qty;
      const rows = db.prepare('SELECT * FROM inventory WHERE character_id = ? AND item_id = ? ORDER BY quantity ASC').all(p.charId, ing.itemId);
      for (const row of rows) {
        if (remaining <= 0) break;
        if (row.quantity <= remaining) {
          remaining -= row.quantity;
          db.prepare('DELETE FROM inventory WHERE id = ?').run(row.id);
        } else {
          db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE id = ?').run(remaining, row.id);
          remaining = 0;
        }
      }
    }
    // Add result
    addItemToInventory(p.charId, recipe.resultId, recipe.resultQty);
    const inv = db.prepare('SELECT * FROM inventory WHERE character_id = ?').all(p.charId);
    socket.emit('inventoryUpdate', inv.map(i => ({ ...i, ...ITEMS[i.item_id] })));
    sendFullState(p);
    socket.emit('chat', { sender: 'Sistema', message: `🛠️ Criou: ${recipe.name}!`, color: '#0f0' });
  });

  socket.on('useItem', ({ itemId }) => {
    const p = players[socket.id];
    if (!p) return;
    const item = ITEMS[itemId];
    if (!item || item.type !== 'consumable') return;
    const invRow = db.prepare('SELECT * FROM inventory WHERE character_id = ? AND item_id = ?').get(p.charId, itemId);
    if (!invRow || invRow.quantity <= 0) return;
    if (item.healAmount) {
      p.hp = Math.min(p.max_hp, p.hp + item.healAmount);
    }
    if (invRow.quantity <= 1) {
      db.prepare('DELETE FROM inventory WHERE id = ?').run(invRow.id);
    } else {
      db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(invRow.id);
    }
    const inv = db.prepare('SELECT * FROM inventory WHERE character_id = ?').all(p.charId);
    socket.emit('inventoryUpdate', inv.map(i => ({ ...i, ...ITEMS[i.item_id] })));
    sendFullState(p);
    socket.emit('chat', { sender: 'Sistema', message: `Usou: ${item.name}`, color: '#0f0' });
  });

  // Pickup ground item (F key)
  socket.on('pickupItem', ({ gid }) => {
    const p = players[socket.id];
    if (!p || p.hp <= 0) return;
    const idx = groundItems.findIndex(gi => gi.gid === gid && gi.quadrant === p.quadrant);
    if (idx === -1) return;
    const gi = groundItems[idx];
    const dist = Math.sqrt((p.x - gi.x)**2 + (p.y - gi.y)**2);
    if (dist > 2) return;
    // Add to inventory
    addItemToInventory(p.charId, gi.itemId, gi.quantity);
    groundItems.splice(idx, 1);
    socket.emit('chat', { sender: 'Sistema', message: `Pegou: ${gi.name}${gi.quantity > 1 ? ' x' + gi.quantity : ''}`, color: '#0ff' });
    const inv = db.prepare('SELECT * FROM inventory WHERE character_id = ?').all(p.charId);
    socket.emit('inventoryUpdate', inv.map(i => ({ ...i, ...ITEMS[i.item_id] })));
    sendFullState(p);
  });

  // Drop item from inventory to ground
  socket.on('dropItem', ({ invId, itemId, quantity }) => {
    const p = players[socket.id];
    if (!p || p.hp <= 0) return;
    let invRow;
    if (invId) {
      invRow = db.prepare('SELECT * FROM inventory WHERE id = ? AND character_id = ?').get(invId, p.charId);
    } else {
      invRow = db.prepare('SELECT * FROM inventory WHERE character_id = ? AND item_id = ?').get(p.charId, itemId);
    }
    if (!invRow || invRow.quantity <= 0) return;
    const item = ITEMS[invRow.item_id];
    if (!item) return;
    const dropQty = Math.min(quantity || 1, invRow.quantity);
    if (invRow.quantity <= dropQty) {
      db.prepare('DELETE FROM inventory WHERE id = ?').run(invRow.id);
    } else {
      db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE id = ?').run(dropQty, invRow.id);
    }
    // Unequip if currently equipped
    const equipSlots = ['equipped_weapon', 'equipped_armor', 'equipped_helmet', 'equipped_chest', 'equipped_legs', 'equipped_boots', 'equipped_ring1', 'equipped_ring2', 'equipped_weapon2'];
    for (const slot of equipSlots) {
      if (p[slot] === invRow.item_id) p[slot] = '';
    }
    // Spawn on ground near player
    spawnGroundItem(invRow.item_id, dropQty, p.x + (Math.random() - 0.5) * 0.8, p.y + (Math.random() - 0.5) * 0.8, p.quadrant);
    saveCharacter(p);
    const inv = db.prepare('SELECT * FROM inventory WHERE character_id = ?').all(p.charId);
    socket.emit('inventoryUpdate', inv.map(i => ({ ...i, ...ITEMS[i.item_id] })));
    sendFullState(p);
    socket.emit('chat', { sender: 'Sistema', message: `Largou: ${item.name}${dropQty > 1 ? ' x' + dropQty : ''}`, color: '#f88' });
  });

  socket.on('chat', ({ message }) => {
    const p = players[socket.id];
    if (!p || !message || message.trim().length === 0) return;
    const msg = message.trim().substring(0, 200);
    // Guardar mensagem para balão de fala (5 segundos)
    p.chatBubble = { message: msg, time: Date.now() };
    io.emit('chat', { sender: p.username, message: msg, color: '#fff' });
  });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) {
      saveCharacter(p);
      io.emit('chat', { sender: 'Sistema', message: `${p.username} saiu do jogo.`, color: '#f88' });
      delete players[socket.id];
    }
    console.log('Desconexão:', socket.id);
  });
});

function addItemToInventory(charId, itemId, qty) {
  const item = ITEMS[itemId];
  // Itens não-empilháveis: weapon, armor, helmet, chest, legs, boots, ring, shield
  const noStack = ['weapon', 'armor', 'helmet', 'chest', 'legs', 'boots', 'ring', 'shield'];
  if (item && noStack.includes(item.type)) {
    // Cada item não-empilhável fica em slot separado
    for (let i = 0; i < qty; i++) {
      db.prepare('INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, 1)').run(charId, itemId);
    }
  } else if (item && item.stackMax) {
    // Itens com stack máximo (ex: couro_simples max 10)
    let remaining = qty;
    // Tentar preencher stacks existentes primeiro
    const existingRows = db.prepare('SELECT * FROM inventory WHERE character_id = ? AND item_id = ? ORDER BY id ASC').all(charId, itemId);
    for (const row of existingRows) {
      if (remaining <= 0) break;
      const canAdd = item.stackMax - row.quantity;
      if (canAdd > 0) {
        const toAdd = Math.min(canAdd, remaining);
        db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE id = ?').run(toAdd, row.id);
        remaining -= toAdd;
      }
    }
    // Criar novos slots para o restante
    while (remaining > 0) {
      const stackQty = Math.min(item.stackMax, remaining);
      db.prepare('INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, ?)').run(charId, itemId, stackQty);
      remaining -= stackQty;
    }
  } else {
    const existing = db.prepare('SELECT * FROM inventory WHERE character_id = ? AND item_id = ?').get(charId, itemId);
    if (existing) {
      db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE id = ?').run(qty, existing.id);
    } else {
      db.prepare('INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, ?)').run(charId, itemId, qty);
    }
  }
}

function updateQuestProgress(p, enemyType) {
  const activeQuests = db.prepare("SELECT * FROM quests WHERE character_id = ? AND status = 'in_progress'").all(p.charId);
  for (const q of activeQuests) {
    const qDef = QUEST_DEFS[q.quest_id];
    if (!qDef) continue;
    let updated = false;

    if (qDef.targets) {
      // Multi-target quest
      const targetDef = qDef.targets.find(t => t.type === enemyType);
      if (!targetDef) continue;
      let progressData = {};
      try { progressData = JSON.parse(q.progress_data || '{}'); } catch(e) {}
      const currentCount = progressData[enemyType] || 0;
      if (currentCount >= targetDef.count) continue;
      progressData[enemyType] = currentCount + 1;
      db.prepare('UPDATE quests SET progress_data = ? WHERE id = ?').run(JSON.stringify(progressData), q.id);
      updated = true;
      const progressStr = getQuestProgressStr(qDef, { ...q, progress_data: JSON.stringify(progressData) });
      p.socket.emit('chat', { sender: 'Sistema', message: `${qDef.name}: ${progressStr}`, color: '#0ff' });
      const allComplete = qDef.targets.every(t => (progressData[t.type] || 0) >= t.count);
      if (allComplete) {
        p.socket.emit('chat', { sender: 'Sistema',
          message: `Missão "${qDef.name}" completa! Volte ao NPC para receber a recompensa.`, color: '#ff0' });
      }
    } else if (qDef.target === enemyType && q.progress < qDef.targetCount) {
      // Single-target quest
      db.prepare('UPDATE quests SET progress = progress + 1 WHERE id = ?').run(q.id);
      const newProg = q.progress + 1;
      updated = true;
      p.socket.emit('chat', { sender: 'Sistema',
        message: `${qDef.name}: ${newProg}/${qDef.targetCount}`, color: '#0ff' });
      if (newProg >= qDef.targetCount) {
        p.socket.emit('chat', { sender: 'Sistema',
          message: `Missão "${qDef.name}" completa! Volte ao NPC para receber a recompensa.`, color: '#ff0' });
      }
    }

    if (updated) {
      const quests = db.prepare('SELECT * FROM quests WHERE character_id = ?').all(p.charId);
      p.socket.emit('questsUpdate', quests.map(qr => ({ ...qr, ...QUEST_DEFS[qr.quest_id] })));
    }
  }
}

// ============================
// GAME LOOP (100ms tick)
// ============================
setInterval(() => {
  const now = Date.now();
  const playerList = Object.values(players);

  // Enemy AI
  for (const enemy of enemies) {
    if (enemy.dead) {
      if (now - enemy.deathTime > 30000) {
        enemy.dead = false;
        enemy.hp = enemy.maxHp;
        enemy.x = enemy.spawnX;
        enemy.y = enemy.spawnY;
      }
      continue;
    }
    // Find nearest player IN SAME QUADRANT
    let nearest = null, nearDist = Infinity;
    for (const p of playerList) {
      if (p.hp <= 0 || p.quadrant !== enemy.quadrant) continue;
      const d = Math.sqrt((p.x - enemy.x)**2 + (p.y - enemy.y)**2);
      if (d < nearDist) { nearDist = d; nearest = p; }
    }
    // Direction
    if (nearest) enemy.direction = nearest.x < enemy.x ? 'left' : 'right';
    enemy.moving = false;

    if (enemy.type === 'skeleton') {
      if (nearest && nearDist < 7) {
        // Chase
        if (nearDist > 1.2) {
          const dx = nearest.x - enemy.x, dy = nearest.y - enemy.y;
          const step = 0.04;
          const nx = enemy.x + (dx / nearDist) * step;
          const ny = enemy.y + (dy / nearDist) * step;
          if (canMoveTo(nx, ny, enemy.quadrant)) { enemy.x = nx; enemy.y = ny; enemy.moving = true; }
        }
        // Attack
        if (nearDist < 1.5 && now - enemy.lastAttack > 2000) {
          enemy.lastAttack = now;
          const totalDef = nearest.defense + getPlayerDefenseBonus(nearest);
          const dmg = Math.max(0, enemy.damage - totalDef);
          if (dmg > 0) {
            nearest.hp -= dmg;
            nearest.lastCombatTime = now;
            nearest.socket.emit('damageTaken', { from: enemy.id, damage: dmg, hp: nearest.hp });
            if (nearest.hp <= 0) {
              // Player death
              nearest.hp = nearest.max_hp;
              nearest.x = 40; nearest.y = 30;
              nearest.silver = Math.floor(nearest.silver * 0.9);
              nearest.lastCombatTime = 0;
              nearest.targetId = null;
              // Respawn in E5 if in another quadrant
              if (nearest.quadrant !== 'E5') {
                nearest.quadrant = 'E5';
                const qDef = QUADRANTS['E5'];
                nearest.socket.emit('mapData', {
                  map: gameMaps['E5'], width: MAP_W, height: MAP_H, tileTypes: T,
                  quadrant: 'E5', quadrantName: qDef.name, neighbors: qDef.neighbors
                });
                nearest.socket.emit('npcData', NPC_DEFS.filter(n => n.quadrant === 'E5'));
              }
              nearest.socket.emit('death', { silver: nearest.silver });
              sendFullState(nearest);
              io.emit('chat', { sender: 'Sistema', message: `${nearest.username} foi derrotado!`, color: '#f44' });
            }
          }
        }
      } else {
        // Wander
        if (now - enemy.lastWander > 3000) {
          enemy.lastWander = now;
          const wx = enemy.x + (Math.random() - 0.5) * 2;
          const wy = enemy.y + (Math.random() - 0.5) * 2;
          const dSpawn = Math.sqrt((wx - enemy.spawnX)**2 + (wy - enemy.spawnY)**2);
          if (dSpawn < 5 && canMoveTo(wx, wy, enemy.quadrant)) { enemy.x = wx; enemy.y = wy; }
        }
      }
    } else if (enemy.type === 'slime') {
      // Slimes just wander (no attack)
      if (now - enemy.lastWander > 3000) {
        enemy.lastWander = now;
        const wx = enemy.x + (Math.random() - 0.5) * 1.5;
        const wy = enemy.y + (Math.random() - 0.5) * 1.5;
        const dSpawn = Math.sqrt((wx - enemy.spawnX)**2 + (wy - enemy.spawnY)**2);
        if (dSpawn < 4 && canMoveTo(wx, wy, enemy.quadrant)) { enemy.x = wx; enemy.y = wy; }
      }
    } else if (enemy.type === 'cow') {
      // Cow behavior
      const wasHitRecently = (now - (enemy.lastHitTime || 0)) < 5000;
      enemy.animTimer = (enemy.animTimer || 0) + 100;

      if (wasHitRecently && nearest) {
        // Flee from attacker (slowly)
        const dx = enemy.x - nearest.x;
        const dy = enemy.y - nearest.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > 0.1 && dist < 15) {
          const step = 0.025; // slower than player
          const nx = enemy.x + (dx / dist) * step;
          const ny = enemy.y + (dy / dist) * step;
          if (canMoveTo(nx, ny, enemy.quadrant)) { enemy.x = nx; enemy.y = ny; enemy.moving = true; }
          enemy.direction = dx > 0 ? 'right' : 'left';
        }
        enemy.animState = 'walking';
      } else {
        // Peaceful: alternate idle/eating, occasionally wander
        if (now - enemy.lastWander > 4000) {
          enemy.lastWander = now;
          // 50% chance to wander
          if (Math.random() < 0.5) {
            const wx = enemy.x + (Math.random() - 0.5) * 2;
            const wy = enemy.y + (Math.random() - 0.5) * 2;
            const dSpawn = Math.sqrt((wx - enemy.spawnX)**2 + (wy - enemy.spawnY)**2);
            if (dSpawn < 6 && canMoveTo(wx, wy, enemy.quadrant)) {
              enemy.x = wx; enemy.y = wy;
              enemy.direction = wx > enemy.x ? 'right' : 'left';
            }
            enemy.animState = 'walking';
          } else {
            enemy.animState = 'idle';
          }
        }
        // Toggle idle/eating every 2 seconds when peaceful and not walking
        if (enemy.animState === 'idle' && enemy.animTimer > 2000) {
          enemy.animTimer = 0;
          enemy.animState = (Math.random() < 0.5) ? 'idle' : 'eating';
        } else if (enemy.animState === 'eating' && enemy.animTimer > 2000) {
          enemy.animTimer = 0;
          enemy.animState = 'idle';
        }
      }
    }
  }

  // HP Regen (out of combat)
  for (const p of playerList) {
    if (p.hp > 0 && p.hp < p.max_hp && now - p.lastCombatTime > 10000) {
      if (now - p.lastRegenTime > 10000) {
        p.lastRegenTime = now;
        p.hp = Math.min(p.max_hp, p.hp + 1);
        p.socket.emit('hpUpdate', { hp: p.hp, max_hp: p.max_hp });
      }
    }
  }

  // Broadcast game state to each player
  for (const p of playerList) {
    const nearbyPlayers = {};
    for (const op of playerList) {
      if (op.socket.id === p.socket.id) continue;
      if (op.quadrant !== p.quadrant) continue; // Only show players in same quadrant
      const d = Math.sqrt((op.x - p.x)**2 + (op.y - p.y)**2);
      if (d < 20) {
        const opData = {
          username: op.username, x: op.x, y: op.y,
          direction: op.direction, moving: op.moving,
          hp: op.hp, max_hp: op.max_hp, level: op.level,
          equipped_weapon: op.equipped_weapon,
          equipped_chest: op.equipped_chest || '',
          isAdmin: op.isAdmin
        };
        // Incluir balão de fala se ainda estiver ativo (5 segundos)
        if (op.chatBubble && (Date.now() - op.chatBubble.time < 5000)) {
          opData.chatBubble = op.chatBubble.message;
        }
        nearbyPlayers[op.socket.id] = opData;
      }
    }
    const nearbyEnemies = enemies.filter(e => {
      if (e.dead || e.quadrant !== p.quadrant) return false;
      return Math.sqrt((e.x - p.x)**2 + (e.y - p.y)**2) < 20;
    }).map(e => ({
      id: e.id, type: e.type, x: e.x, y: e.y,
      hp: e.hp, maxHp: e.maxHp, direction: e.direction, moving: e.moving || false,
      animState: e.animState || 'idle'
    }));

    // Ground items nearby (same quadrant)
    const nearbyGround = groundItems.filter(gi => {
      if (gi.quadrant !== p.quadrant) return false;
      return Math.sqrt((gi.x - p.x)**2 + (gi.y - p.y)**2) < 20;
    }).map(gi => ({
      gid: gi.gid, itemId: gi.itemId, name: gi.name, icon: gi.icon,
      quantity: gi.quantity, x: gi.x, y: gi.y
    }));

    // NPC quest status for this player (only NPCs in same quadrant)
    const npcQuestStatus = {};
    for (const npc of NPC_DEFS) {
      if (!npc.questId || npc.quadrant !== p.quadrant) continue;
      const currentQId = getCurrentQuestForNpc(npc.questId, p.charId);
      if (currentQId) {
        const qDef = QUEST_DEFS[currentQId];
        const qRow = db.prepare('SELECT * FROM quests WHERE character_id = ? AND quest_id = ?').get(p.charId, currentQId);
        // Check prerequisites
        if (qDef.requires) {
          const reqDone = db.prepare('SELECT * FROM quests WHERE character_id = ? AND quest_id = ? AND status = ?').get(p.charId, qDef.requires, 'completed');
          if (!reqDone) { npcQuestStatus[npc.id] = 'locked'; continue; }
        }
        if (!qRow || qRow.status === 'not_started') {
          npcQuestStatus[npc.id] = 'available'; // yellow !
        } else if (qRow.status === 'in_progress') {
          if (isQuestComplete(qDef, qRow)) {
            npcQuestStatus[npc.id] = 'complete'; // can turn in
          } else {
            npcQuestStatus[npc.id] = 'in_progress';
          }
        }
      } else {
        npcQuestStatus[npc.id] = 'done'; // all quests done
      }
    }

    p.socket.volatile.emit('gameState', { players: nearbyPlayers, enemies: nearbyEnemies, groundItems: nearbyGround, npcQuestStatus });
  }

  // Cleanup ground items older than 5 minutes
  const expireTime = 5 * 60 * 1000;
  for (let i = groundItems.length - 1; i >= 0; i--) {
    if (now - groundItems[i].spawnTime > expireTime) groundItems.splice(i, 1);
  }
}, 100);

// Auto-save every 30 seconds
setInterval(() => {
  for (const p of Object.values(players)) saveCharacter(p);
}, 30000);

// ============================
// START SERVER
// ============================
// Prevent server crash on unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[ERRO] Exceção não capturada:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[ERRO] Promise rejeitada:', reason);
});

const PORT = 3240;
server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  Originals World - Servidor Online!`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Seus amigos podem conectar via:`);
  console.log(`  http://SEU_IP:${PORT}`);
  console.log(`========================================\n`);
});
