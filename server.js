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

app.use(express.json({ limit: '10mb' }));
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
    x REAL DEFAULT 50,
    y REAL DEFAULT 50,
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
  { id: 'padre', name: 'Padre', x: 50, y: 25, sprite: 'padre', questId: 'padre_quest',
    dialog: 'Que a paz esteja com você, meu filho.', quadrant: 'E5' },
  { id: 'paladino', name: 'Paladino', x: 50, y: 35, sprite: 'paladino', questId: 'paladino_quest',
    dialog: 'Saudações, aventureiro!', quadrant: 'E5' },
  { id: 'ferreiro', name: 'Ferreiro', x: 62, y: 69, sprite: 'ferreiro', questId: null,
    dialog: 'Bem-vindo à minha ferraria! Infelizmente ainda não tenho equipamentos para venda. Volte em breve!',
    isShop: true, shopItems: [], quadrant: 'E5' },
  { id: 'artesao', name: 'Artesão', x: 32, y: 69, sprite: 'artesao', questId: null,
    dialog: 'Bem-vindo à minha oficina! Traga-me materiais e eu posso criar equipamentos para você.',
    isCrafter: true, quadrant: 'E5' }
];

// ============================
// QUADRANT DEFINITIONS
// ============================
const QUADRANTS = {
  E5: { id: 'E5', name: 'Cidade de Origens', neighbors: { left: 'E4', right: null, up: null, down: 'F5' }, spawnX: 50, spawnY: 50 },
  E4: { id: 'E4', name: 'Planície Verde', neighbors: { left: null, right: 'E5', up: null, down: null }, spawnX: 90, spawnY: 50 },
  F5: { id: 'F5', name: 'Vila de Testes', neighbors: { left: null, right: null, up: 'E5', down: null }, spawnX: 50, spawnY: 5 }
};

// ============================
// MAP GENERATION
// ============================
const MAP_W = 100;
const MAP_H = 100;
const T = { GRASS:0, DIRT:1, STONE_PATH:2, STONE_WALL:3, WATER:4, TREE:5, WOOD_FLOOR:6, CHURCH_FLOOR:7, WOOD_WALL:8, SAND:9,
  FLOWERS:10, BUSH:11, ROCK:12, RED_CARPET:13, ALTAR:14, ANVIL:15, FURNACE:16, BOOKSHELF:17, TABLE:18, CHAIR:19,
  WELL:20, FENCE:21, ROOF_STONE:22, ROOF_WOOD:23, WINDOW_STONE:24, WINDOW_WOOD:25, CROSS:26, TALL_GRASS:27, MUSHROOM:28,
  BARREL:29, CRATE:30, TORCH_WALL:31, BED:32, RUG:33, CHURCH_PEW:34, DARK_GRASS:35,
  GRAVESTONE:36, DEAD_TREE:37, BONE:38, MUD:39, HAY:40, CHURCH_WALL:41,
  ROOF_RED:42, ROOF_BLUE:43, ROOF_YELLOW:44, BENCH:45 };
const BLOCKED_TILES = new Set([T.STONE_WALL, T.WATER, T.TREE, T.WOOD_WALL, T.BUSH, T.ROCK, T.ANVIL, T.FURNACE,
  T.BOOKSHELF, T.WELL, T.FENCE, T.BARREL, T.CRATE, T.BED, T.TORCH_WALL, T.GRAVESTONE, T.DEAD_TREE, T.HAY, T.CHURCH_WALL, T.BENCH]);
const BLOCKED_TILES_DEFAULT = new Set(BLOCKED_TILES);

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

  // === CENTER OF MAP ===
  const cx = 50, cy = 50;

  // Helper: organic plaza shape — a rounded irregular polygon with noise
  // Wider than tall, with natural bumps
  function isPlaza(x, y) {
    const dx = x - cx, dy = y - cy;
    // Base shape: superellipse (squarish) with different radii
    const rx = 16, ry = 14; // wider than tall
    const nx = Math.abs(dx) / rx;
    const ny = Math.abs(dy) / ry;
    // Superellipse power 2.5 gives rounded-square feel
    const base = Math.pow(nx, 2.5) + Math.pow(ny, 2.5);
    // Add organic noise based on angle
    const angle = Math.atan2(dy, dx);
    const noise = Math.sin(angle * 3.0) * 0.06
                + Math.sin(angle * 5.0 + 1.5) * 0.04
                + Math.sin(angle * 7.0 + 3.0) * 0.03;
    return (base + noise) <= 1.0;
  }

  // Fill the organic plaza
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      if (isPlaza(x, y)) map[y][x] = T.STONE_PATH;

  // === PATHS leading to map edges (4 directions) ===
  // Path going LEFT (to E4)
  for (let x = 0; x < cx; x++) {
    if (map[cy - 1][x] !== T.STONE_PATH) map[cy - 1][x] = T.STONE_PATH;
    if (map[cy][x] !== T.STONE_PATH) map[cy][x] = T.STONE_PATH;
    if (map[cy + 1][x] !== T.STONE_PATH) map[cy + 1][x] = T.STONE_PATH;
  }
  // Open passage on left side (connection to E4)
  for (let y = cy - 5; y <= cy + 5; y++)
    for (let x = 0; x < 3; x++)
      map[y][x] = T.STONE_PATH;

  // Path going RIGHT
  for (let x = cx; x < MAP_W; x++) {
    if (map[cy - 1][x] !== T.STONE_PATH) map[cy - 1][x] = T.STONE_PATH;
    if (map[cy][x] !== T.STONE_PATH) map[cy][x] = T.STONE_PATH;
    if (map[cy + 1][x] !== T.STONE_PATH) map[cy + 1][x] = T.STONE_PATH;
  }
  // Open passage on right side
  for (let y = cy - 5; y <= cy + 5; y++)
    for (let x = MAP_W - 3; x < MAP_W; x++)
      if (map[y][x] === T.TREE) map[y][x] = T.STONE_PATH;

  // Path going UP
  for (let y = 0; y < cy; y++) {
    if (map[y][cx - 1] !== T.STONE_PATH) map[y][cx - 1] = T.STONE_PATH;
    if (map[y][cx] !== T.STONE_PATH) map[y][cx] = T.STONE_PATH;
    if (map[y][cx + 1] !== T.STONE_PATH) map[y][cx + 1] = T.STONE_PATH;
  }
  // Open passage on top
  for (let x = cx - 5; x <= cx + 5; x++)
    for (let y = 0; y < 3; y++)
      if (map[y][x] === T.TREE) map[y][x] = T.STONE_PATH;

  // Path going DOWN
  for (let y = cy; y < MAP_H; y++) {
    if (map[y][cx - 1] !== T.STONE_PATH) map[y][cx - 1] = T.STONE_PATH;
    if (map[y][cx] !== T.STONE_PATH) map[y][cx] = T.STONE_PATH;
    if (map[y][cx + 1] !== T.STONE_PATH) map[y][cx + 1] = T.STONE_PATH;
  }
  // Open passage on bottom
  for (let x = cx - 5; x <= cx + 5; x++)
    for (let y = MAP_H - 3; y < MAP_H; y++)
      if (map[y][x] === T.TREE) map[y][x] = T.STONE_PATH;

  // === CHURCH at the top (outside the plaza, connected by path) ===
  const churchW = 15, churchH = 13;
  const churchX = cx - 7;
  const churchY = cy - 28; // well above the plaza
  buildWalls(map, churchX, churchY, churchW, churchH, T.CHURCH_WALL, T.CHURCH_FLOOR);
  map[churchY + churchH - 1][cx] = T.CHURCH_FLOOR; // door
  for (let x = churchX + 1; x < churchX + churchW - 1; x++) map[churchY][x] = T.CHURCH_WALL;
  // Windows
  map[churchY + 3][churchX] = T.WINDOW_STONE; map[churchY + 7][churchX] = T.WINDOW_STONE;
  map[churchY + 3][churchX + churchW - 1] = T.WINDOW_STONE; map[churchY + 7][churchX + churchW - 1] = T.WINDOW_STONE;
  // Torches
  map[churchY + 4][churchX + 1] = T.TORCH_WALL; map[churchY + 8][churchX + 1] = T.TORCH_WALL;
  map[churchY + 4][churchX + churchW - 2] = T.TORCH_WALL; map[churchY + 8][churchX + churchW - 2] = T.TORCH_WALL;
  // Red carpet
  for (let y = churchY + 2; y < churchY + churchH - 1; y++) map[y][cx] = T.RED_CARPET;
  // Altar
  map[churchY + 1][cx - 1] = T.ALTAR; map[churchY + 1][cx] = T.CROSS; map[churchY + 1][cx + 1] = T.ALTAR;
  // Pews
  for (let y = churchY + 4; y <= churchY + 10; y += 2) {
    map[y][cx - 3] = T.CHURCH_PEW; map[y][cx - 2] = T.CHURCH_PEW;
    map[y][cx + 2] = T.CHURCH_PEW; map[y][cx + 3] = T.CHURCH_PEW;
  }
  map[churchY + 1][churchX + 2] = T.BOOKSHELF; map[churchY + 1][churchX + churchW - 3] = T.BOOKSHELF;

  // === WELL in the center of the plaza ===
  map[cy][cx] = T.WELL;

  // === BLACKSMITH (south-east, outside plaza) ===
  const bsX = cx + 10;
  const bsY = cy + 20;
  buildWalls(map, bsX, bsY, 12, 8, T.WOOD_WALL, T.WOOD_FLOOR);
  map[bsY][bsX + 2] = T.WOOD_FLOOR; // door north
  map[bsY][bsX + 3] = T.WOOD_FLOOR;
  // Windows
  map[bsY + 7][bsX + 5] = T.WINDOW_WOOD;
  map[bsY + 3][bsX] = T.WINDOW_WOOD;
  map[bsY + 3][bsX + 11] = T.WINDOW_WOOD;
  // Interior
  map[bsY + 1][bsX + 2] = T.FURNACE; map[bsY + 1][bsX + 3] = T.FURNACE;
  map[bsY + 3][bsX + 2] = T.ANVIL;
  map[bsY + 6][bsX + 9] = T.BARREL; map[bsY + 6][bsX + 10] = T.BARREL;
  map[bsY + 1][bsX + 9] = T.CRATE; map[bsY + 1][bsX + 10] = T.CRATE;
  map[bsY + 2][bsX + 1] = T.TORCH_WALL;
  // Path from plaza down to blacksmith
  for (let y = cy + 15; y <= bsY; y++) {
    map[y][bsX + 2] = T.STONE_PATH; map[y][bsX + 3] = T.STONE_PATH;
  }
  // Connect path horizontally to the main south road
  const bsPathY = cy + 15;
  for (let x = cx + 1; x <= bsX + 3; x++) {
    map[bsPathY][x] = T.STONE_PATH; map[bsPathY + 1][x] = T.STONE_PATH;
  }

  // === HOUSE - Casa do Artesão (south-west, outside plaza) ===
  const artX = cx - 20;
  const artY = cy + 20;
  buildWalls(map, artX, artY, 9, 8, T.WOOD_WALL, T.WOOD_FLOOR);
  map[artY][artX + 4] = T.WOOD_FLOOR; // door north
  // Windows
  map[artY + 7][artX + 4] = T.WINDOW_WOOD;
  map[artY + 3][artX] = T.WINDOW_WOOD;
  // Interior
  map[artY + 1][artX + 1] = T.TABLE; map[artY + 1][artX + 2] = T.TABLE;
  map[artY + 1][artX + 7] = T.BOOKSHELF;
  map[artY + 6][artX + 7] = T.BARREL; map[artY + 6][artX + 6] = T.CRATE;
  map[artY + 4][artX + 1] = T.ANVIL;
  map[artY + 6][artX + 1] = T.BARREL;
  map[artY + 3][artX + 4] = T.RUG; map[artY + 4][artX + 4] = T.RUG;
  // Path from plaza down to artisan
  for (let y = cy + 15; y <= artY; y++) {
    map[y][artX + 4] = T.STONE_PATH; map[y][artX + 5] = T.STONE_PATH;
  }
  // Connect path horizontally to the main south road
  for (let x = artX + 4; x <= cx - 1; x++) {
    map[bsPathY][x] = T.STONE_PATH; map[bsPathY + 1][x] = T.STONE_PATH;
  }

  // === HOUSE 2 (extra house, south of plaza) ===
  const h2X = cx - 5;
  const h2Y = cy + 22;
  buildWalls(map, h2X, h2Y, 9, 8, T.WOOD_WALL, T.WOOD_FLOOR);
  map[h2Y][h2X + 4] = T.WOOD_FLOOR; // door north
  map[h2Y + 7][h2X + 4] = T.WINDOW_WOOD;
  map[h2Y + 3][h2X] = T.WINDOW_WOOD;
  map[h2Y + 1][h2X + 1] = T.TABLE; map[h2Y + 1][h2X + 2] = T.CHAIR; map[h2Y + 1][h2X + 3] = T.CHAIR;
  map[h2Y + 6][h2X + 1] = T.BED; map[h2Y + 6][h2X + 2] = T.BED;
  map[h2Y + 1][h2X + 7] = T.BARREL;
  map[h2Y + 3][h2X + 4] = T.RUG; map[h2Y + 4][h2X + 4] = T.RUG;
  // Path connecting to horizontal road
  for (let y = bsPathY + 2; y <= h2Y; y++) {
    map[y][h2X + 4] = T.STONE_PATH; map[y][h2X + 5] = T.STONE_PATH;
  }

  // === ENVIRONMENT DECORATION ===
  for (let i = 0; i < 600; i++) {
    const tx = 4 + Math.floor(rng() * (MAP_W - 8));
    const ty = 4 + Math.floor(rng() * (MAP_H - 8));
    if (map[ty][tx] !== T.GRASS) continue;
    const distCenter = Math.sqrt((tx - cx) ** 2 + (ty - cy) ** 2);
    if (distCenter <= 22) {
      // Near town: only flowers and bushes
      const r = rng();
      if (r < 0.25) map[ty][tx] = T.FLOWERS;
      else if (r < 0.40) map[ty][tx] = T.BUSH;
    } else {
      // Wilderness
      const r = rng();
      if (r < 0.22) map[ty][tx] = T.TREE;
      else if (r < 0.35) map[ty][tx] = T.BUSH;
      else if (r < 0.42) map[ty][tx] = T.FLOWERS;
      else if (r < 0.48) map[ty][tx] = T.TALL_GRASS;
      else if (r < 0.53) map[ty][tx] = T.ROCK;
      else if (r < 0.56) map[ty][tx] = T.MUSHROOM;
    }
  }

  // Dark grass patches for variety
  for (let i = 0; i < 250; i++) {
    const tx = 4 + Math.floor(rng() * (MAP_W - 8));
    const ty = 4 + Math.floor(rng() * (MAP_H - 8));
    if (map[ty][tx] === T.GRASS) map[ty][tx] = T.DARK_GRASS;
  }

  // === CEMITÉRIO (área dos esqueletos) - NE corner ===
  const cemX = 75, cemY = 10;
  for (let y = cemY; y <= cemY + 15; y++)
    for (let x = cemX; x <= cemX + 14; x++)
      if (x < MAP_W - 3 && y >= 3) map[y][x] = T.DIRT;
  for (let x = cemX - 1; x <= cemX + 15; x++) {
    if (x < MAP_W - 3) { map[cemY - 1][x] = T.STONE_WALL; map[cemY + 16][x] = T.STONE_WALL; }
  }
  for (let y = cemY - 1; y <= cemY + 16; y++) {
    map[y][cemX - 1] = T.STONE_WALL;
    if (cemX + 15 < MAP_W - 3) map[y][cemX + 15] = T.STONE_WALL;
  }
  map[cemY + 16][cemX + 6] = T.STONE_PATH; map[cemY + 16][cemX + 7] = T.STONE_PATH;
  map[cemY - 1][cemX + 6] = T.STONE_PATH; map[cemY - 1][cemX + 7] = T.STONE_PATH;
  map[cemY + 7][cemX - 1] = T.STONE_PATH; map[cemY + 8][cemX - 1] = T.STONE_PATH;
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) {
      const gx = cemX + 1 + col * 3;
      const gy = cemY + 1 + row * 3;
      if (gx <= cemX + 13 && gy <= cemY + 14) map[gy][gx] = T.GRAVESTONE;
    }
  map[cemY][cemX] = T.DEAD_TREE; map[cemY][cemX + 13] = T.DEAD_TREE;
  map[cemY + 15][cemX] = T.DEAD_TREE; map[cemY + 15][cemX + 13] = T.DEAD_TREE;
  map[cemY + 8][cemX + 7] = T.DEAD_TREE;
  const bonePos = [[cemX+2,cemY+3],[cemX+5,cemY+2],[cemX+9,cemY+4],[cemX+11,cemY+6],
    [cemX+1,cemY+9],[cemX+3,cemY+11],[cemX+7,cemY+13],[cemX+12,cemY+12]];
  for (const [bx, by] of bonePos)
    if (by < MAP_H && bx < MAP_W && map[by][bx] === T.DIRT) map[by][bx] = T.BONE;
  for (let y = cemY - 3; y <= cemY + 19; y++)
    for (let x = cemX - 3; x <= cemX + 17; x++) {
      if (x >= cemX - 1 && x <= cemX + 15 && y >= cemY - 1 && y <= cemY + 16) continue;
      if (x >= 3 && x < MAP_W-3 && y >= 3 && y < MAP_H-3 && map[y][x] === T.GRASS)
        map[y][x] = T.DARK_GRASS;
    }

  // === FAZENDA DE SLIMES (SW corner) ===
  const slX = 8, slY = 78;
  for (let y = slY; y <= slY + 10; y++)
    for (let x = slX; x <= slX + 15; x++)
      map[y][x] = T.MUD;
  for (let x = slX - 1; x <= slX + 16; x++) { map[slY - 1][x] = T.FENCE; map[slY + 11][x] = T.FENCE; }
  for (let y = slY - 1; y <= slY + 11; y++) { map[y][slX - 1] = T.FENCE; map[y][slX + 16] = T.FENCE; }
  map[slY - 1][slX + 7] = T.MUD; map[slY - 1][slX + 8] = T.MUD;
  map[slY + 11][slX + 7] = T.MUD; map[slY + 11][slX + 8] = T.MUD;
  map[slY + 5][slX - 1] = T.MUD; map[slY + 6][slX - 1] = T.MUD;
  map[slY + 5][slX + 16] = T.MUD; map[slY + 6][slX + 16] = T.MUD;
  map[slY + 1][slX] = T.HAY; map[slY + 1][slX + 1] = T.HAY;
  map[slY + 1][slX + 13] = T.HAY; map[slY + 1][slX + 14] = T.HAY;
  map[slY + 9][slX] = T.HAY; map[slY + 9][slX + 14] = T.HAY;
  map[slY + 5][slX + 7] = T.HAY;

  // Water lake NW (small decorative lake)
  for (let y = 5; y <= 15; y++)
    for (let x = 5; x <= 20; x++) {
      const d = Math.sqrt((x-12)**2 + (y-10)**2);
      const noise = Math.sin(x*0.7)*0.8 + Math.cos(y*0.9)*0.6;
      if (d + noise < 4.5) map[y][x] = T.WATER;
      else if (d + noise < 5.5 && map[y][x] === T.GRASS) map[y][x] = T.SAND;
    }

  // === BUILDINGS metadata for roof rendering ===
  const buildings = [
    { x: churchX, y: churchY, w: churchW, h: churchH, roofTile: T.ROOF_STONE, doorX: cx, doorY: churchY + churchH - 1 },
    { x: bsX, y: bsY, w: 12, h: 8, roofTile: T.ROOF_WOOD, doorX: bsX + 2, doorY: bsY },
    { x: artX, y: artY, w: 9, h: 8, roofTile: T.ROOF_WOOD, doorX: artX + 4, doorY: artY },
    { x: h2X, y: h2Y, w: 9, h: 8, roofTile: T.ROOF_WOOD, doorX: h2X + 4, doorY: h2Y }
  ];

  return { map, buildings };
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
      if (x >= MAP_W-3 && (y < 45 || y > 55)) map[y][x] = T.TREE;
    }

  // Dirt path connecting to E5 on the right
  for (let x = 30; x < MAP_W; x++) { map[49][x] = T.DIRT; map[50][x] = T.DIRT; map[51][x] = T.DIRT; }

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

// ============================
// F5 MAP - VILA DE TESTES
// ============================
function generateMapF5() {
  const map = Array.from({length: MAP_H}, () => Array(MAP_W).fill(T.GRASS));
  const rng = mulberry32(137);
  const cx = 50, cy = 50;

  // ── Tree border (open on top to connect to E5) ──
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (x < 3 || x >= MAP_W - 3 || y >= MAP_H - 3) map[y][x] = T.TREE;
      if (y < 3 && (x < 45 || x > 55)) map[y][x] = T.TREE;
    }

  // ── Organic stone plaza (center) ──
  function isPlaza(x, y) {
    const dx = x - cx, dy = y - cy;
    const rx = 15, ry = 13;
    const nx = Math.abs(dx) / rx, ny = Math.abs(dy) / ry;
    const base = Math.pow(nx, 2.5) + Math.pow(ny, 2.5);
    const angle = Math.atan2(dy, dx);
    const noise = Math.sin(angle * 3.0) * 0.07 + Math.sin(angle * 5.0 + 1.2) * 0.04 + Math.sin(angle * 7.0 + 2.8) * 0.03;
    return (base + noise) <= 1.0;
  }
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      if (isPlaza(x, y)) map[y][x] = T.STONE_PATH;

  // ── 4 Paths to edges (3 tiles wide) ──
  // UP
  for (let y = 0; y < cy; y++) {
    if (map[y][cx - 1] !== T.STONE_PATH) map[y][cx - 1] = T.STONE_PATH;
    if (map[y][cx] !== T.STONE_PATH) map[y][cx] = T.STONE_PATH;
    if (map[y][cx + 1] !== T.STONE_PATH) map[y][cx + 1] = T.STONE_PATH;
  }
  for (let x = cx - 5; x <= cx + 5; x++) for (let y = 0; y < 3; y++) if (map[y][x] === T.TREE) map[y][x] = T.STONE_PATH;

  // DOWN
  for (let y = cy; y < MAP_H; y++) {
    if (map[y][cx - 1] !== T.STONE_PATH) map[y][cx - 1] = T.STONE_PATH;
    if (map[y][cx] !== T.STONE_PATH) map[y][cx] = T.STONE_PATH;
    if (map[y][cx + 1] !== T.STONE_PATH) map[y][cx + 1] = T.STONE_PATH;
  }
  for (let x = cx - 5; x <= cx + 5; x++) for (let y = MAP_H - 3; y < MAP_H; y++) if (map[y][x] === T.TREE) map[y][x] = T.STONE_PATH;

  // LEFT
  for (let x = 0; x < cx; x++) {
    if (map[cy - 1][x] !== T.STONE_PATH) map[cy - 1][x] = T.STONE_PATH;
    if (map[cy][x] !== T.STONE_PATH) map[cy][x] = T.STONE_PATH;
    if (map[cy + 1][x] !== T.STONE_PATH) map[cy + 1][x] = T.STONE_PATH;
  }
  for (let y = cy - 5; y <= cy + 5; y++) for (let x = 0; x < 3; x++) map[y][x] = T.STONE_PATH;

  // RIGHT
  for (let x = cx; x < MAP_W; x++) {
    if (map[cy - 1][x] !== T.STONE_PATH) map[cy - 1][x] = T.STONE_PATH;
    if (map[cy][x] !== T.STONE_PATH) map[cy][x] = T.STONE_PATH;
    if (map[cy + 1][x] !== T.STONE_PATH) map[cy + 1][x] = T.STONE_PATH;
  }
  for (let y = cy - 5; y <= cy + 5; y++) for (let x = MAP_W - 3; x < MAP_W; x++) if (map[y][x] === T.TREE) map[y][x] = T.STONE_PATH;

  // ── WELL in the center ──
  map[cy][cx] = T.WELL;

  // ── Benches along paths near plaza ──
  map[cy - 2][cx - 4] = T.BENCH; map[cy - 2][cx + 4] = T.BENCH;
  map[cy + 2][cx - 4] = T.BENCH; map[cy + 2][cx + 4] = T.BENCH;
  map[cy - 4][cx - 2] = T.BENCH; map[cy - 4][cx + 2] = T.BENCH;
  map[cy + 4][cx - 2] = T.BENCH; map[cy + 4][cx + 2] = T.BENCH;

  // ══════════════════════════════
  // CHURCH (top-right) with cemetery
  // ══════════════════════════════
  const chX = 68, chY = 8, chW = 15, chH = 13;
  buildWalls(map, chX, chY, chW, chH, T.CHURCH_WALL, T.CHURCH_FLOOR);
  const chCx = chX + Math.floor(chW / 2); // center X of church
  map[chY + chH - 1][chCx] = T.CHURCH_FLOOR; // door
  for (let x = chX + 1; x < chX + chW - 1; x++) map[chY][x] = T.CHURCH_WALL;
  // Windows
  map[chY + 3][chX] = T.WINDOW_STONE; map[chY + 7][chX] = T.WINDOW_STONE;
  map[chY + 3][chX + chW - 1] = T.WINDOW_STONE; map[chY + 7][chX + chW - 1] = T.WINDOW_STONE;
  // Torches
  map[chY + 4][chX + 1] = T.TORCH_WALL; map[chY + 8][chX + 1] = T.TORCH_WALL;
  map[chY + 4][chX + chW - 2] = T.TORCH_WALL; map[chY + 8][chX + chW - 2] = T.TORCH_WALL;
  // Red carpet
  for (let y = chY + 2; y < chY + chH - 1; y++) map[y][chCx] = T.RED_CARPET;
  // Altar + Cross
  map[chY + 1][chCx - 1] = T.ALTAR; map[chY + 1][chCx] = T.CROSS; map[chY + 1][chCx + 1] = T.ALTAR;
  // Pews
  for (let y = chY + 4; y <= chY + 10; y += 2) {
    map[y][chCx - 3] = T.CHURCH_PEW; map[y][chCx - 2] = T.CHURCH_PEW;
    map[y][chCx + 2] = T.CHURCH_PEW; map[y][chCx + 3] = T.CHURCH_PEW;
  }
  map[chY + 1][chX + 2] = T.BOOKSHELF; map[chY + 1][chX + chW - 3] = T.BOOKSHELF;
  // Path from church door down to horizontal road
  for (let y = chY + chH; y <= cy - 1; y++) { map[y][chCx] = T.STONE_PATH; map[y][chCx - 1] = T.STONE_PATH; }
  // Connect horizontally to main path
  for (let x = cx + 1; x <= chCx; x++) { map[cy - 3][x] = T.STONE_PATH; map[cy - 4][x] = T.STONE_PATH; }

  // ── Cemetery (east of church) ──
  const cemX = 72, cemY = 24;
  for (let y = cemY; y <= cemY + 12; y++)
    for (let x = cemX; x <= cemX + 14; x++)
      if (x < MAP_W - 3 && y >= 3) map[y][x] = T.DIRT;
  // Stone wall border
  for (let x = cemX - 1; x <= cemX + 15; x++) {
    if (x < MAP_W - 3) { map[cemY - 1][x] = T.STONE_WALL; map[cemY + 13][x] = T.STONE_WALL; }
  }
  for (let y = cemY - 1; y <= cemY + 13; y++) {
    map[y][cemX - 1] = T.STONE_WALL;
    if (cemX + 15 < MAP_W - 3) map[y][cemX + 15] = T.STONE_WALL;
  }
  // Gate
  map[cemY - 1][cemX + 6] = T.STONE_PATH; map[cemY - 1][cemX + 7] = T.STONE_PATH;
  // Gravestones
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 4; col++) {
      const gx = cemX + 1 + col * 3;
      const gy = cemY + 1 + row * 4;
      if (gx <= cemX + 13 && gy <= cemY + 11) map[gy][gx] = T.GRAVESTONE;
    }
  // Dead trees & bones
  map[cemY][cemX] = T.DEAD_TREE; map[cemY][cemX + 13] = T.DEAD_TREE;
  map[cemY + 12][cemX] = T.DEAD_TREE; map[cemY + 12][cemX + 13] = T.DEAD_TREE;
  const bonePos = [[cemX+2,cemY+3],[cemX+5,cemY+2],[cemX+9,cemY+1],[cemX+11,cemY+5],
    [cemX+1,cemY+8],[cemX+3,cemY+10],[cemX+7,cemY+11],[cemX+12,cemY+9]];
  for (const [bx, by] of bonePos)
    if (by < MAP_H && bx < MAP_W && map[by][bx] === T.DIRT) map[by][bx] = T.BONE;
  // Dark grass around cemetery
  for (let y = cemY - 3; y <= cemY + 16; y++)
    for (let x = cemX - 3; x <= cemX + 17; x++) {
      if (x >= cemX - 1 && x <= cemX + 15 && y >= cemY - 1 && y <= cemY + 13) continue;
      if (x >= 3 && x < MAP_W-3 && y >= 3 && y < MAP_H-3 && map[y][x] === T.GRASS)
        map[y][x] = T.DARK_GRASS;
    }

  // ══════════════════════════════
  // LAKE (top-left, decorative)
  // ══════════════════════════════
  for (let y = 5; y <= 20; y++)
    for (let x = 5; x <= 25; x++) {
      const d = Math.sqrt((x - 14) ** 2 + (y - 12) ** 2);
      const noise = Math.sin(x * 0.7) * 0.9 + Math.cos(y * 0.9) * 0.7;
      if (d + noise < 5.5) map[y][x] = T.WATER;
      else if (d + noise < 6.5 && map[y][x] === T.GRASS) map[y][x] = T.SAND;
    }

  // ══════════════════════════════
  // SLIME FARM (upper-left, below lake)
  // ══════════════════════════════
  const slX = 8, slY = 26;
  for (let y = slY; y <= slY + 10; y++)
    for (let x = slX; x <= slX + 15; x++)
      map[y][x] = T.MUD;
  for (let x = slX - 1; x <= slX + 16; x++) { map[slY - 1][x] = T.FENCE; map[slY + 11][x] = T.FENCE; }
  for (let y = slY - 1; y <= slY + 11; y++) { map[y][slX - 1] = T.FENCE; map[y][slX + 16] = T.FENCE; }
  // Gates
  map[slY - 1][slX + 7] = T.MUD; map[slY - 1][slX + 8] = T.MUD;
  map[slY + 11][slX + 7] = T.MUD; map[slY + 11][slX + 8] = T.MUD;
  // Hay bales inside
  map[slY + 1][slX] = T.HAY; map[slY + 1][slX + 1] = T.HAY;
  map[slY + 1][slX + 13] = T.HAY; map[slY + 1][slX + 14] = T.HAY;
  map[slY + 9][slX] = T.HAY; map[slY + 9][slX + 14] = T.HAY;
  map[slY + 5][slX + 7] = T.HAY;

  // ══════════════════════════════
  // HOUSES with colored roofs
  // ══════════════════════════════

  // --- House 1: Large dark blue house (left of plaza) ---
  const h1X = 8, h1Y = 42, h1W = 12, h1H = 9;
  buildWalls(map, h1X, h1Y, h1W, h1H, T.WOOD_WALL, T.WOOD_FLOOR);
  map[h1Y + h1H - 1][h1X + 5] = T.WOOD_FLOOR; // door south
  map[h1Y + h1H - 1][h1X + 6] = T.WOOD_FLOOR;
  map[h1Y + 3][h1X] = T.WINDOW_WOOD; map[h1Y + 3][h1X + h1W - 1] = T.WINDOW_WOOD;
  map[h1Y][h1X + 5] = T.WINDOW_WOOD;
  map[h1Y + 1][h1X + 1] = T.TABLE; map[h1Y + 1][h1X + 2] = T.TABLE;
  map[h1Y + 2][h1X + 1] = T.CHAIR; map[h1Y + 2][h1X + 2] = T.CHAIR;
  map[h1Y + 1][h1X + h1W - 2] = T.BOOKSHELF;
  map[h1Y + 7][h1X + 1] = T.BED; map[h1Y + 7][h1X + 2] = T.BED;
  map[h1Y + 7][h1X + h1W - 2] = T.BARREL; map[h1Y + 7][h1X + h1W - 3] = T.CRATE;
  map[h1Y + 4][h1X + 5] = T.RUG; map[h1Y + 5][h1X + 5] = T.RUG;
  map[h1Y + 3][h1X + 1] = T.TORCH_WALL;
  // Path from house to left main road
  for (let x = h1X + 5; x <= cx - 2; x++) { map[h1Y + h1H][x] = T.STONE_PATH; map[h1Y + h1H + 1][x] = T.STONE_PATH; }
  // Connect to horizontal main path
  for (let y = cy + 1; y >= h1Y + h1H; y--) { map[y][cx - 2] = T.STONE_PATH; }

  // --- House 2: Large brown house with fence (bottom-left) ---
  const h2X = 8, h2Y = 70, h2W = 13, h2H = 10;
  buildWalls(map, h2X, h2Y, h2W, h2H, T.WOOD_WALL, T.WOOD_FLOOR);
  map[h2Y][h2X + 6] = T.WOOD_FLOOR; // door north
  map[h2Y + 4][h2X] = T.WINDOW_WOOD; map[h2Y + 4][h2X + h2W - 1] = T.WINDOW_WOOD;
  map[h2Y + h2H - 1][h2X + 6] = T.WINDOW_WOOD;
  map[h2Y + 1][h2X + 1] = T.TABLE; map[h2Y + 1][h2X + 2] = T.TABLE; map[h2Y + 1][h2X + 3] = T.TABLE;
  map[h2Y + 2][h2X + 1] = T.CHAIR; map[h2Y + 2][h2X + 2] = T.CHAIR;
  map[h2Y + 8][h2X + 1] = T.BED; map[h2Y + 8][h2X + 2] = T.BED;
  map[h2Y + 8][h2X + h2W - 2] = T.BED; map[h2Y + 8][h2X + h2W - 3] = T.BED;
  map[h2Y + 1][h2X + h2W - 2] = T.BOOKSHELF; map[h2Y + 1][h2X + h2W - 3] = T.BOOKSHELF;
  map[h2Y + 5][h2X + 6] = T.RUG; map[h2Y + 6][h2X + 6] = T.RUG;
  map[h2Y + 5][h2X + 1] = T.BARREL; map[h2Y + 5][h2X + h2W - 2] = T.BARREL;
  map[h2Y + 3][h2X + 1] = T.TORCH_WALL; map[h2Y + 3][h2X + h2W - 2] = T.TORCH_WALL;
  // Fence around yard
  for (let x = h2X - 2; x <= h2X + h2W + 1; x++) { map[h2Y - 2][x] = T.FENCE; map[h2Y + h2H + 2][x] = T.FENCE; }
  for (let y = h2Y - 2; y <= h2Y + h2H + 2; y++) { map[y][h2X - 2] = T.FENCE; map[y][h2X + h2W + 1] = T.FENCE; }
  // Gate
  map[h2Y - 2][h2X + 6] = T.GRASS; map[h2Y - 2][h2X + 7] = T.GRASS;
  // Path from house to main path
  for (let y = h2Y - 3; y >= cy + 1; y--) { map[y][h2X + 6] = T.STONE_PATH; map[y][h2X + 7] = T.STONE_PATH; }
  for (let x = h2X + 6; x <= cx - 1; x++) { map[cy + 3][x] = T.STONE_PATH; map[cy + 4][x] = T.STONE_PATH; }

  // --- House 3: Brown house (below plaza, center) ---
  const h3X = 38, h3Y = 68, h3W = 10, h3H = 8;
  buildWalls(map, h3X, h3Y, h3W, h3H, T.WOOD_WALL, T.WOOD_FLOOR);
  map[h3Y][h3X + 4] = T.WOOD_FLOOR; // door north
  map[h3Y + 3][h3X] = T.WINDOW_WOOD; map[h3Y + 3][h3X + h3W - 1] = T.WINDOW_WOOD;
  map[h3Y + 1][h3X + 1] = T.TABLE; map[h3Y + 1][h3X + 2] = T.CHAIR;
  map[h3Y + 6][h3X + 1] = T.BED; map[h3Y + 6][h3X + 2] = T.BED;
  map[h3Y + 1][h3X + h3W - 2] = T.BARREL;
  map[h3Y + 6][h3X + h3W - 2] = T.CRATE;
  map[h3Y + 3][h3X + 4] = T.RUG; map[h3Y + 4][h3X + 4] = T.RUG;
  // Path
  for (let y = cy + 2; y <= h3Y; y++) { map[y][h3X + 4] = T.STONE_PATH; map[y][h3X + 5] = T.STONE_PATH; }

  // --- House 4: Red roof house (right side, mid-bottom) ---
  const h4X = 62, h4Y = 65, h4W = 10, h4H = 8;
  buildWalls(map, h4X, h4Y, h4W, h4H, T.WOOD_WALL, T.WOOD_FLOOR);
  map[h4Y][h4X + 4] = T.WOOD_FLOOR; // door north
  map[h4Y + 3][h4X] = T.WINDOW_WOOD; map[h4Y + 3][h4X + h4W - 1] = T.WINDOW_WOOD;
  map[h4Y + 1][h4X + 1] = T.FURNACE; map[h4Y + 1][h4X + 2] = T.FURNACE;
  map[h4Y + 1][h4X + h4W - 2] = T.ANVIL;
  map[h4Y + 6][h4X + 1] = T.BARREL; map[h4Y + 6][h4X + 2] = T.BARREL;
  map[h4Y + 6][h4X + h4W - 2] = T.CRATE; map[h4Y + 6][h4X + h4W - 3] = T.CRATE;
  map[h4Y + 3][h4X + 1] = T.TORCH_WALL;
  // Path
  for (let y = cy + 2; y <= h4Y; y++) { map[y][h4X + 4] = T.STONE_PATH; map[y][h4X + 5] = T.STONE_PATH; }
  for (let x = cx + 1; x <= h4X + 4; x++) { map[cy + 3][x] = T.STONE_PATH; }

  // --- House 5: Small blue roof (bottom-right row, first) ---
  const h5X = 58, h5Y = 82, h5W = 8, h5H = 7;
  buildWalls(map, h5X, h5Y, h5W, h5H, T.WOOD_WALL, T.WOOD_FLOOR);
  map[h5Y][h5X + 3] = T.WOOD_FLOOR; // door north
  map[h5Y + 3][h5X] = T.WINDOW_WOOD;
  map[h5Y + 1][h5X + 1] = T.TABLE; map[h5Y + 1][h5X + 2] = T.CHAIR;
  map[h5Y + 5][h5X + 1] = T.BED; map[h5Y + 5][h5X + 2] = T.BED;
  map[h5Y + 1][h5X + h5W - 2] = T.BARREL;
  // Path
  for (let y = h4Y + h4H; y <= h5Y; y++) { map[y][h5X + 3] = T.STONE_PATH; map[y][h5X + 4] = T.STONE_PATH; }

  // --- House 6: Small red roof (bottom-right row, second) ---
  const h6X = 70, h6Y = 82, h6W = 8, h6H = 7;
  buildWalls(map, h6X, h6Y, h6W, h6H, T.WOOD_WALL, T.WOOD_FLOOR);
  map[h6Y][h6X + 3] = T.WOOD_FLOOR; // door north
  map[h6Y + 3][h6X + h6W - 1] = T.WINDOW_WOOD;
  map[h6Y + 1][h6X + 1] = T.TABLE; map[h6Y + 1][h6X + 2] = T.CHAIR;
  map[h6Y + 5][h6X + 1] = T.BED;
  map[h6Y + 5][h6X + h6W - 2] = T.CRATE;
  // Path
  for (let y = h4Y + h4H; y <= h6Y; y++) { map[y][h6X + 3] = T.STONE_PATH; map[y][h6X + 4] = T.STONE_PATH; }

  // --- House 7: Small yellow roof (bottom-right row, third) ---
  const h7X = 82, h7Y = 82, h7W = 8, h7H = 7;
  buildWalls(map, h7X, h7Y, h7W, h7H, T.WOOD_WALL, T.WOOD_FLOOR);
  map[h7Y][h7X + 3] = T.WOOD_FLOOR; // door north
  map[h7Y + 3][h7X] = T.WINDOW_WOOD;
  map[h7Y + 1][h7X + 1] = T.BOOKSHELF;
  map[h7Y + 5][h7X + 1] = T.BED; map[h7Y + 5][h7X + 2] = T.BED;
  map[h7Y + 1][h7X + h7W - 2] = T.BARREL;
  // Path
  for (let y = h4Y + h4H; y <= h7Y; y++) { map[y][h7X + 3] = T.STONE_PATH; map[y][h7X + 4] = T.STONE_PATH; }

  // Horizontal path connecting the 3 small houses
  for (let x = h5X; x <= h7X + h7W; x++) { map[h5Y - 1][x] = T.STONE_PATH; map[h5Y - 2][x] = T.STONE_PATH; }
  // Connect to main horizontal road
  for (let y = cy + 1; y <= h5Y - 2; y++) { map[y][h5X + 8] = T.STONE_PATH; }

  // ── Additional small paths connecting houses to main roads ──
  // Connect h4 path to the row of 3 houses
  for (let x = h5X + 3; x <= h6X + 4; x++) map[h4Y + h4H + 2][x] = T.STONE_PATH;

  // ══════════════════════════════
  // ENVIRONMENT DECORATION
  // ══════════════════════════════
  for (let i = 0; i < 700; i++) {
    const tx = 4 + Math.floor(rng() * (MAP_W - 8));
    const ty = 4 + Math.floor(rng() * (MAP_H - 8));
    if (map[ty][tx] !== T.GRASS) continue;
    const distCenter = Math.sqrt((tx - cx) ** 2 + (ty - cy) ** 2);
    if (distCenter <= 22) {
      const r = rng();
      if (r < 0.25) map[ty][tx] = T.FLOWERS;
      else if (r < 0.40) map[ty][tx] = T.BUSH;
    } else {
      const r = rng();
      if (r < 0.18) map[ty][tx] = T.TREE;
      else if (r < 0.30) map[ty][tx] = T.BUSH;
      else if (r < 0.40) map[ty][tx] = T.FLOWERS;
      else if (r < 0.48) map[ty][tx] = T.TALL_GRASS;
      else if (r < 0.53) map[ty][tx] = T.ROCK;
      else if (r < 0.56) map[ty][tx] = T.MUSHROOM;
    }
  }

  // Dark grass patches
  for (let i = 0; i < 300; i++) {
    const tx = 4 + Math.floor(rng() * (MAP_W - 8));
    const ty = 4 + Math.floor(rng() * (MAP_H - 8));
    if (map[ty][tx] === T.GRASS) map[ty][tx] = T.DARK_GRASS;
  }

  // ── Flower clusters near plaza ──
  const flowerSpots = [[cx - 8, cy - 8], [cx + 8, cy - 8], [cx - 8, cy + 8], [cx + 8, cy + 8],
    [cx - 12, cy], [cx + 12, cy], [cx, cy - 10], [cx, cy + 10]];
  for (const [fx, fy] of flowerSpots) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = fx + dx, ny = fy + dy;
        if (nx >= 3 && nx < MAP_W - 3 && ny >= 3 && ny < MAP_H - 3 && map[ny][nx] === T.GRASS)
          map[ny][nx] = T.FLOWERS;
      }
  }

  // ── BUILDINGS metadata ──
  const buildings = [
    { x: chX, y: chY, w: chW, h: chH, roofTile: T.ROOF_STONE, doorX: chCx, doorY: chY + chH - 1 },
    { x: h1X, y: h1Y, w: h1W, h: h1H, roofTile: T.ROOF_BLUE, doorX: h1X + 5, doorY: h1Y + h1H - 1 },
    { x: h2X, y: h2Y, w: h2W, h: h2H, roofTile: T.ROOF_WOOD, doorX: h2X + 6, doorY: h2Y },
    { x: h3X, y: h3Y, w: h3W, h: h3H, roofTile: T.ROOF_WOOD, doorX: h3X + 4, doorY: h3Y },
    { x: h4X, y: h4Y, w: h4W, h: h4H, roofTile: T.ROOF_RED, doorX: h4X + 4, doorY: h4Y },
    { x: h5X, y: h5Y, w: h5W, h: h5H, roofTile: T.ROOF_BLUE, doorX: h5X + 3, doorY: h5Y },
    { x: h6X, y: h6Y, w: h6W, h: h6H, roofTile: T.ROOF_RED, doorX: h6X + 3, doorY: h6Y },
    { x: h7X, y: h7Y, w: h7W, h: h7H, roofTile: T.ROOF_YELLOW, doorX: h7X + 3, doorY: h7Y }
  ];

  return { map, buildings };
}

// ============================
// F5 MAP - MAPA SIMPLES (calçadas retas)
// ============================
function generateMapF5() {
  const map = Array.from({length: MAP_H}, () => Array(MAP_W).fill(T.GRASS));
  const rng = mulberry32(55);
  const cx = 50, cy = 50;

  // Tree border (open on top for E5 connection)
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (x < 3 || x >= MAP_W - 3 || y >= MAP_H - 3) map[y][x] = T.TREE;
      if (y < 3 && (x < 45 || x > 55)) map[y][x] = T.TREE;
    }

  // Simple cross-shaped stone paths (3 tiles wide, all straight)
  for (let x = 3; x < MAP_W - 3; x++) { map[cy-1][x] = T.STONE_PATH; map[cy][x] = T.STONE_PATH; map[cy+1][x] = T.STONE_PATH; }
  for (let y = 3; y < MAP_H - 3; y++) { map[y][cx-1] = T.STONE_PATH; map[y][cx] = T.STONE_PATH; map[y][cx+1] = T.STONE_PATH; }

  // Open top passage
  for (let x = cx - 5; x <= cx + 5; x++) for (let y = 0; y < 3; y++) map[y][x] = T.STONE_PATH;

  // Small square plaza at center (10x10)
  for (let y = cy - 5; y <= cy + 5; y++)
    for (let x = cx - 5; x <= cx + 5; x++)
      map[y][x] = T.STONE_PATH;

  // Well at center
  map[cy][cx] = T.WELL;

  // Simple house NW
  const h1X = 15, h1Y = 15;
  buildWalls(map, h1X, h1Y, 10, 8, T.WOOD_WALL, T.WOOD_FLOOR);
  map[h1Y + 7][h1X + 4] = T.WOOD_FLOOR; // door
  map[h1Y + 1][h1X + 1] = T.TABLE; map[h1Y + 1][h1X + 2] = T.CHAIR;
  map[h1Y + 6][h1X + 1] = T.BED; map[h1Y + 6][h1X + 2] = T.BED;
  map[h1Y + 3][h1X] = T.WINDOW_WOOD;
  map[h1Y + 1][h1X + 8] = T.BARREL;

  // Simple house NE
  const h2X = 70, h2Y = 15;
  buildWalls(map, h2X, h2Y, 10, 8, T.WOOD_WALL, T.WOOD_FLOOR);
  map[h2Y + 7][h2X + 4] = T.WOOD_FLOOR; // door
  map[h2Y + 1][h2X + 1] = T.BOOKSHELF;
  map[h2Y + 6][h2X + 8] = T.CRATE; map[h2Y + 6][h2X + 7] = T.BARREL;
  map[h2Y + 3][h2X + 9] = T.WINDOW_WOOD;

  // Simple house SW  
  const h3X = 15, h3Y = 70;
  buildWalls(map, h3X, h3Y, 10, 8, T.WOOD_WALL, T.WOOD_FLOOR);
  map[h3Y][h3X + 4] = T.WOOD_FLOOR; // door north
  map[h3Y + 1][h3X + 1] = T.FURNACE; map[h3Y + 1][h3X + 2] = T.ANVIL;
  map[h3Y + 6][h3X + 1] = T.BARREL; map[h3Y + 6][h3X + 8] = T.CRATE;
  map[h3Y + 3][h3X] = T.WINDOW_WOOD;

  // Simple house SE
  const h4X = 70, h4Y = 70;
  buildWalls(map, h4X, h4Y, 10, 8, T.WOOD_WALL, T.WOOD_FLOOR);
  map[h4Y][h4X + 4] = T.WOOD_FLOOR; // door north
  map[h4Y + 1][h4X + 1] = T.TABLE; map[h4Y + 1][h4X + 2] = T.TABLE;
  map[h4Y + 2][h4X + 1] = T.CHAIR; map[h4Y + 2][h4X + 2] = T.CHAIR;
  map[h4Y + 6][h4X + 1] = T.BED; map[h4Y + 6][h4X + 2] = T.BED;
  map[h4Y + 3][h4X + 9] = T.WINDOW_WOOD;

  // Small lake
  for (let y = 8; y <= 14; y++)
    for (let x = 35; x <= 45; x++) {
      const d = Math.sqrt((x-40)**2 + (y-11)**2);
      if (d < 3.5) map[y][x] = T.WATER;
      else if (d < 4.5 && map[y][x] === T.GRASS) map[y][x] = T.SAND;
    }

  // Scatter decoration
  for (let i = 0; i < 400; i++) {
    const tx = 4 + Math.floor(rng() * (MAP_W - 8));
    const ty = 4 + Math.floor(rng() * (MAP_H - 8));
    if (map[ty][tx] !== T.GRASS) continue;
    const r = rng();
    if (r < 0.15) map[ty][tx] = T.FLOWERS;
    else if (r < 0.25) map[ty][tx] = T.TALL_GRASS;
    else if (r < 0.35) map[ty][tx] = T.BUSH;
    else if (r < 0.42) map[ty][tx] = T.TREE;
    else if (r < 0.45) map[ty][tx] = T.ROCK;
    else if (r < 0.47) map[ty][tx] = T.MUSHROOM;
  }

  // Dark grass patches
  for (let i = 0; i < 150; i++) {
    const tx = 4 + Math.floor(rng() * (MAP_W - 8));
    const ty = 4 + Math.floor(rng() * (MAP_H - 8));
    if (map[ty][tx] === T.GRASS) map[ty][tx] = T.DARK_GRASS;
  }

  // Fences around a garden area
  for (let x = 55; x <= 65; x++) { map[30][x] = T.FENCE; map[40][x] = T.FENCE; }
  for (let y = 30; y <= 40; y++) { map[y][55] = T.FENCE; map[y][65] = T.FENCE; }
  map[40][60] = T.GRASS; // gate

  const buildings = [];
  return { map, buildings };
}

const e5Result = generateMapE5();
const f5Result = generateMapF5();
const gameMaps = {
  E5: e5Result.map,
  E4: generateMapE4(),
  F5: f5Result.map
};
const gameBuildings = {
  E5: e5Result.buildings,
  E4: [],
  F5: f5Result.buildings
};

// Image objects per quadrant: { id, src (base64 data URL), x, y, width, height (in tiles) }
const gameMapObjects = { E5: [], E4: [], F5: [] };

// Per-cell solid grid per quadrant: Set of "x,y" keys that are individually solid
const solidCells = { E5: new Set(), E4: new Set(), F5: new Set() };

// ============================
// MAP EDITOR API
// ============================
app.get('/api/editor/map/:quadrant', (req, res) => {
  const q = req.params.quadrant;
  if (!gameMaps[q]) return res.status(404).json({ error: 'Quadrant not found' });
  res.json({
    map: gameMaps[q], width: MAP_W, height: MAP_H, tileTypes: T,
    objects: gameMapObjects[q] || [], blockedTiles: [...BLOCKED_TILES],
    npcs: NPC_DEFS.filter(n => n.quadrant === q).map(n => ({ id: n.id, name: n.name, x: n.x, y: n.y, sprite: n.sprite })),
    solidCells: solidCells[q] ? [...solidCells[q]] : []
  });
});

// Upload/place an image object on the map
app.post('/api/editor/objects/:quadrant', (req, res) => {
  const q = req.params.quadrant;
  if (!gameMaps[q]) return res.status(404).json({ error: 'Quadrant not found' });
  const { src, x, y, width, height } = req.body;
  if (!src || x == null || y == null || !width || !height) {
    return res.status(400).json({ error: 'Missing fields: src, x, y, width, height' });
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const obj = { id, src, x: +x, y: +y, width: +width, height: +height };
  if (!gameMapObjects[q]) gameMapObjects[q] = [];
  gameMapObjects[q].push(obj);
  // Notify players
  notifyQuadrantMapUpdate(q);
  console.log(`[Editor] Objeto de imagem adicionado em ${q} (${x},${y} ${width}x${height})`);
  res.json({ success: true, object: obj });
});

// Update an image object (move/resize)
app.put('/api/editor/objects/:quadrant/:id', (req, res) => {
  const q = req.params.quadrant;
  const id = req.params.id;
  if (!gameMapObjects[q]) return res.status(404).json({ error: 'Quadrant not found' });
  const obj = gameMapObjects[q].find(o => o.id === id);
  if (!obj) return res.status(404).json({ error: 'Object not found' });
  const { x, y, width, height } = req.body;
  if (x != null) obj.x = +x;
  if (y != null) obj.y = +y;
  if (width != null && +width > 0) obj.width = +width;
  if (height != null && +height > 0) obj.height = +height;
  notifyQuadrantMapUpdate(q);
  console.log(`[Editor] Objeto atualizado em ${q}: ${id} (${obj.x},${obj.y} ${obj.width}x${obj.height})`);
  res.json({ success: true, object: obj });
});

// Delete an image object
app.delete('/api/editor/objects/:quadrant/:id', (req, res) => {
  const q = req.params.quadrant;
  const id = req.params.id;
  if (!gameMapObjects[q]) return res.status(404).json({ error: 'Quadrant not found' });
  const idx = gameMapObjects[q].findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Object not found' });
  gameMapObjects[q].splice(idx, 1);
  notifyQuadrantMapUpdate(q);
  console.log(`[Editor] Objeto de imagem removido de ${q}: ${id}`);
  res.json({ success: true });
});

// List image objects
app.get('/api/editor/objects/:quadrant', (req, res) => {
  const q = req.params.quadrant;
  res.json({ objects: gameMapObjects[q] || [] });
});

// Get/Set blocked tiles
app.get('/api/editor/blocked', (req, res) => {
  res.json({ blocked: [...BLOCKED_TILES] });
});

app.post('/api/editor/blocked', (req, res) => {
  const { blocked } = req.body;
  if (!Array.isArray(blocked)) return res.status(400).json({ error: 'blocked must be an array of tile IDs' });
  BLOCKED_TILES.clear();
  for (const id of blocked) BLOCKED_TILES.add(+id);
  console.log(`[Editor] BLOCKED_TILES atualizado: [${[...BLOCKED_TILES].join(',')}]`);
  res.json({ success: true, blocked: [...BLOCKED_TILES] });
});

// ============================
// NPC EDITOR API
// ============================
app.get('/api/editor/npcs/:quadrant', (req, res) => {
  const q = req.params.quadrant;
  const npcs = NPC_DEFS.filter(n => n.quadrant === q).map(n => ({ id: n.id, name: n.name, x: n.x, y: n.y, sprite: n.sprite }));
  res.json({ npcs });
});

app.put('/api/editor/npcs/:id', (req, res) => {
  const npc = NPC_DEFS.find(n => n.id === req.params.id);
  if (!npc) return res.status(404).json({ error: 'NPC not found' });
  const { x, y } = req.body;
  if (x != null) npc.x = +x;
  if (y != null) npc.y = +y;
  // Notify players in the quadrant
  for (const [sid, p] of Object.entries(players)) {
    if (p.quadrant === npc.quadrant) {
      p.socket.emit('npcData', NPC_DEFS.filter(n => n.quadrant === npc.quadrant));
    }
  }
  console.log(`[Editor] NPC ${npc.id} movido para (${npc.x}, ${npc.y})`);
  res.json({ success: true, npc: { id: npc.id, name: npc.name, x: npc.x, y: npc.y, sprite: npc.sprite } });
});

// ============================
// PER-CELL SOLID GRID API
// ============================
app.get('/api/editor/solidcells/:quadrant', (req, res) => {
  const q = req.params.quadrant;
  res.json({ cells: solidCells[q] ? [...solidCells[q]] : [] });
});

app.post('/api/editor/solidcells/:quadrant', (req, res) => {
  const q = req.params.quadrant;
  const { add, remove } = req.body; // add: ["x,y", ...], remove: ["x,y", ...]
  if (!solidCells[q]) solidCells[q] = new Set();
  if (Array.isArray(add)) {
    for (const key of add) solidCells[q].add(key);
  }
  if (Array.isArray(remove)) {
    for (const key of remove) solidCells[q].delete(key);
  }
  console.log(`[Editor] SolidCells ${q}: ${solidCells[q].size} cells`);
  res.json({ success: true, count: solidCells[q].size });
});

// Helper to notify all players in a quadrant
function notifyQuadrantMapUpdate(q) {
  let count = 0;
  for (const [sid, p] of Object.entries(players)) {
    if (p.quadrant === q) {
      const qDef = QUADRANTS[q];
      p.socket.emit('mapData', {
        map: gameMaps[q], width: MAP_W, height: MAP_H, tileTypes: T,
        quadrant: q, quadrantName: qDef.name, neighbors: qDef.neighbors,
        buildings: gameBuildings[q] || [],
        objects: gameMapObjects[q] || []
      });
      count++;
    }
  }
  console.log(`[Editor] Notificados ${count} jogadores em ${q}`);
}

app.post('/api/editor/map/:quadrant', (req, res) => {
  const q = req.params.quadrant;
  if (!gameMaps[q]) return res.status(404).json({ error: 'Quadrant not found' });
  const newMap = req.body.map;
  if (!newMap || !Array.isArray(newMap) || newMap.length !== MAP_H) {
    return res.status(400).json({ error: 'Invalid map data' });
  }
  // Apply the new map
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      gameMaps[q][y][x] = newMap[y][x];
    }
  }
  // Notify all connected players in this quadrant to reload map
  notifyQuadrantMapUpdate(q);
  console.log(`[Editor] Mapa ${q} atualizado!`);
  res.json({ success: true });
});

function isBlocked(x, y, quadrant) {
  if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return true;
  const q = quadrant || 'E5';
  const map = gameMaps[q];
  const fx = Math.floor(x), fy = Math.floor(y);
  if (BLOCKED_TILES.has(map[fy][fx])) return true;
  // Check per-cell solid grid
  if (solidCells[q] && solidCells[q].has(`${fx},${fy}`)) return true;
  // Check image objects collision
  const objs = gameMapObjects[q] || [];
  for (const obj of objs) {
    if (x >= obj.x && x < obj.x + obj.width && y >= obj.y && y < obj.y + obj.height) return true;
  }
  return false;
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
    do { x = 76 + Math.floor(rng() * 13); y = 11 + Math.floor(rng() * 14); attempts++; }
    while (isBlocked(x, y, 'E5') && attempts < 50);
    enemies.push({
      id: `skeleton_${i}`, type: 'skeleton', x, y, spawnX: x, spawnY: y,
      hp: 15, maxHp: 15, damage: 5, dead: false, deathTime: 0,
      direction: 'right', lastAttack: 0, lastWander: 0,
      quadrant: 'E5'
    });
  }
  // E5 - Slimes (fazenda)
  for (let i = 0; i < 8; i++) {
    let x, y, attempts = 0;
    do { x = 9 + Math.floor(rng() * 14); y = 76 + Math.floor(rng() * 9); attempts++; }
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
      quadrant: playerQuadrant, quadrantName: qDef.name, neighbors: qDef.neighbors,
      buildings: gameBuildings[playerQuadrant] || [],
      objects: gameMapObjects[playerQuadrant] || []
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
      quadrant: newQuadrant, quadrantName: newQDef.name, neighbors: newQDef.neighbors,
      buildings: gameBuildings[newQuadrant] || [],
      objects: gameMapObjects[newQuadrant] || []
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
                  quadrant: 'E5', quadrantName: qDef.name, neighbors: qDef.neighbors,
                  buildings: gameBuildings['E5'] || [],
                  objects: gameMapObjects['E5'] || []
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
