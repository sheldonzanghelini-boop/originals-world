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
let groundItems = []; // itens no chão
let npcQuestStatus = {}; // quest status per NPC
let lastLoginCredentials = null; // para re-login automático

// Quadrant system
let currentQuadrant = 'E5';
let currentQuadrantName = 'Cidade de Origens';
let quadrantNeighbors = { left: null, right: null, up: null, down: null };
let transitioning = false;

// Item data map (client-side)
const ITEMS_CLIENT = {
  espada_enferrujada: { name: 'Espada Enferrujada', icon: '/assets/icons/swords/enferrujada.png' },
  pocao_cura: { name: 'Poção de Cura', icon: null },
  couro_simples: { name: 'Couro Simples', icon: '/assets/sprites/cow/courosimples.png' },
  tunica_couro_simples: { name: 'Túnica de Couro Simples', icon: '/assets/icons/peitorais/tunicacourosimples.png' }
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

  // Check if clicked on enemy — target and attack immediately
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

  // Check if clicked on ground item — pick up
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
  const tile = gameMap[ty][tx];
  const s = TILE_SIZE;
  const seed = (tx * 7 + ty * 13) % 7;
  const seed2 = (tx * 11 + ty * 3) % 5;
  const seed3 = (tx * 5 + ty * 9) % 11;

  switch (tile) {
    case T.GRASS: {
      // Tibia-style grass: rich green with pixel detail
      ctx.fillStyle = '#3a8030';
      ctx.fillRect(sx, sy, s, s);
      // Subtle variation patches
      ctx.fillStyle = '#429038';
      ctx.fillRect(sx + (seed*3)%s, sy + (seed*5)%s, s*0.3, s*0.25);
      ctx.fillStyle = '#357a2a';
      ctx.fillRect(sx + (seed2*4)%s, sy + (seed2*6)%s, s*0.2, s*0.2);
      // Small grass tufts
      ctx.fillStyle = '#4a9a40';
      if (seed===0) { ctx.fillRect(sx+2,sy+4,2,3); ctx.fillRect(sx+s*0.6,sy+s*0.7,2,3); }
      if (seed===1) { ctx.fillRect(sx+s*0.4,sy+2,2,3); ctx.fillRect(sx+s*0.8,sy+s*0.5,2,2); }
      if (seed===2) { ctx.fillRect(sx+s*0.2,sy+s*0.6,2,3); }
      if (seed===3) { ctx.fillRect(sx+s*0.7,sy+3,2,3); ctx.fillRect(sx+3,sy+s*0.5,2,2); }
      // Dark specks
      ctx.fillStyle = '#2d6a22';
      if (seed3%3===0) ctx.fillRect(sx+s*0.5,sy+s*0.3,1,1);
      if (seed3%4===0) ctx.fillRect(sx+s*0.2,sy+s*0.8,1,1);
      break;
    }

    case T.DARK_GRASS: {
      ctx.fillStyle = '#2d6822';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#25601a';
      ctx.fillRect(sx + (seed*4)%s, sy + (seed*3)%s, s*0.35, s*0.3);
      ctx.fillStyle = '#357828';
      if (seed%2===0) { ctx.fillRect(sx+s*0.5,sy+s*0.2,2,3); ctx.fillRect(sx+3,sy+s*0.6,2,2); }
      if (seed%3===0) ctx.fillRect(sx+s*0.3,sy+s*0.4,2,3);
      // Leaves on ground
      ctx.fillStyle = '#1f5515';
      if (seed3%2===0) ctx.fillRect(sx+s*0.6,sy+s*0.7,3,2);
      break;
    }

    case T.TALL_GRASS: {
      ctx.fillStyle = '#3a8030';
      ctx.fillRect(sx, sy, s, s);
      // Dense grass blades
      ctx.strokeStyle = '#50a848';
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const bx = sx + 2 + (i * s * 0.16);
        const sway = ((seed + i) % 3 - 1) * 2;
        ctx.beginPath();
        ctx.moveTo(bx, sy+s);
        ctx.lineTo(bx + sway, sy + s*0.15);
        ctx.stroke();
      }
      ctx.strokeStyle = '#60b858';
      ctx.beginPath();
      ctx.moveTo(sx+s*0.3, sy+s*0.95); ctx.lineTo(sx+s*0.25, sy+s*0.1);
      ctx.moveTo(sx+s*0.7, sy+s*0.95); ctx.lineTo(sx+s*0.72, sy+s*0.12);
      ctx.stroke();
      break;
    }

    case T.FLOWERS: {
      ctx.fillStyle = '#3a8030';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#429038';
      ctx.fillRect(sx + (seed*3)%s, sy + (seed*5)%s, s*0.3, s*0.2);
      // Tibia-style flowers: small colorful dots
      const fc = ['#ff5577','#ffaa33','#ff3355','#ffdd33','#ee66aa','#aaccff'];
      for (let i = 0; i < 4; i++) {
        const fx = sx + 3 + ((seed + i * 7) % (s - 6));
        const fy = sy + 3 + ((seed * 3 + i * 11) % (s - 6));
        ctx.fillStyle = '#3a7a2f';
        ctx.fillRect(fx, fy + 2, 1, 3);
        ctx.fillStyle = fc[(seed + i) % fc.length];
        ctx.fillRect(fx - 1, fy, 3, 3);
        ctx.fillStyle = '#ffe844';
        ctx.fillRect(fx, fy + 1, 1, 1);
      }
      break;
    }

    case T.MUSHROOM: {
      ctx.fillStyle = '#3a8030';
      ctx.fillRect(sx, sy, s, s);
      // Stem
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(sx+s*0.42, sy+s*0.6, s*0.16, s*0.25);
      // Cap
      ctx.fillStyle = '#cc2020';
      ctx.fillRect(sx+s*0.3, sy+s*0.4, s*0.4, s*0.22);
      ctx.fillRect(sx+s*0.35, sy+s*0.35, s*0.3, s*0.08);
      // White dots
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx+s*0.35, sy+s*0.42, 2, 2);
      ctx.fillRect(sx+s*0.55, sy+s*0.45, 2, 2);
      ctx.fillRect(sx+s*0.45, sy+s*0.38, 1, 1);
      break;
    }

    case T.BUSH: {
      ctx.fillStyle = '#3a8030';
      ctx.fillRect(sx, sy, s, s);
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(sx+s*0.15,sy+s*0.7,s*0.7,s*0.2);
      // Bush body - blocky Tibia style
      ctx.fillStyle = '#1e5510';
      ctx.fillRect(sx+s*0.12,sy+s*0.2,s*0.76,s*0.6);
      ctx.fillRect(sx+s*0.2,sy+s*0.12,s*0.6,s*0.7);
      // Highlight
      ctx.fillStyle = '#2a6a1e';
      ctx.fillRect(sx+s*0.2,sy+s*0.15,s*0.55,s*0.35);
      // Leaf details
      ctx.fillStyle = '#3a8830';
      ctx.fillRect(sx+s*0.25,sy+s*0.2,s*0.12,s*0.1);
      ctx.fillRect(sx+s*0.5,sy+s*0.3,s*0.15,s*0.08);
      break;
    }

    case T.ROCK: {
      ctx.fillStyle = '#3a8030';
      ctx.fillRect(sx, sy, s, s);
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(sx+s*0.15,sy+s*0.7,s*0.72,s*0.18);
      // Rock body
      ctx.fillStyle = '#808080';
      ctx.fillRect(sx+s*0.1,sy+s*0.25,s*0.8,s*0.55);
      ctx.fillRect(sx+s*0.2,sy+s*0.2,s*0.6,s*0.06);
      // Top highlight
      ctx.fillStyle = '#999';
      ctx.fillRect(sx+s*0.15,sy+s*0.25,s*0.7,s*0.15);
      // Dark bottom
      ctx.fillStyle = '#666';
      ctx.fillRect(sx+s*0.1,sy+s*0.65,s*0.8,s*0.15);
      // Cracks
      ctx.fillStyle = '#555';
      ctx.fillRect(sx+s*0.4,sy+s*0.35,1,s*0.25);
      ctx.fillRect(sx+s*0.6,sy+s*0.3,1,s*0.2);
      break;
    }

    case T.DIRT: {
      ctx.fillStyle = '#8a6e48';
      ctx.fillRect(sx, sy, s, s);
      // Texture variation
      ctx.fillStyle = '#7a5e38';
      ctx.fillRect(sx+(seed*5)%s, sy+(seed2*4)%s, s*0.25, s*0.2);
      ctx.fillStyle = '#9a7e58';
      ctx.fillRect(sx+(seed2*6)%s, sy+(seed*3)%s, s*0.2, s*0.15);
      // Pebbles
      ctx.fillStyle = '#6a5030';
      if (seed===0) { ctx.fillRect(sx+s*0.3,sy+s*0.4,3,2); ctx.fillRect(sx+s*0.7,sy+s*0.7,2,2); }
      if (seed===2) ctx.fillRect(sx+s*0.5,sy+s*0.2,2,2);
      if (seed===4) ctx.fillRect(sx+s*0.15,sy+s*0.6,2,3);
      break;
    }

    case T.STONE_PATH: {
      // Tibia-style cobblestone: individual stone blocks with grout
      ctx.fillStyle = '#888';
      ctx.fillRect(sx, sy, s, s);
      // Grout lines
      ctx.fillStyle = '#666';
      ctx.fillRect(sx, sy+s*0.48, s, 2);
      if ((tx+ty)%2===0) {
        ctx.fillRect(sx+s*0.48, sy, 2, s*0.48);
        ctx.fillRect(sx+s*0.24, sy+s*0.5, 2, s*0.5);
        ctx.fillRect(sx+s*0.72, sy+s*0.5, 2, s*0.5);
      } else {
        ctx.fillRect(sx+s*0.24, sy, 2, s*0.48);
        ctx.fillRect(sx+s*0.72, sy, 2, s*0.48);
        ctx.fillRect(sx+s*0.48, sy+s*0.5, 2, s*0.5);
      }
      // Stone highlights
      ctx.fillStyle = '#9a9a9a';
      if ((tx+ty)%2===0) {
        ctx.fillRect(sx+1,sy+1,s*0.46,2);
        ctx.fillRect(sx+s*0.52,sy+1,s*0.46,2);
      } else {
        ctx.fillRect(sx+1,sy+s*0.52,s*0.22,2);
        ctx.fillRect(sx+s*0.26,sy+s*0.52,s*0.44,2);
      }
      // Dark edges
      ctx.fillStyle = '#777';
      ctx.fillRect(sx,sy+s-2,s,2);
      ctx.fillRect(sx+s-2,sy,2,s);
      break;
    }

    case T.STONE_WALL: {
      // Tibia-style stone wall: 3D brick effect with mortar
      ctx.fillStyle = '#707070';
      ctx.fillRect(sx, sy, s, s);
      // Top edge highlight (3D effect)
      ctx.fillStyle = '#909090';
      ctx.fillRect(sx, sy, s, s*0.12);
      // Brick pattern
      ctx.fillStyle = '#626262';
      ctx.fillRect(sx, sy+s*0.48, s, 2);
      if ((tx+ty)%2===0) {
        ctx.fillRect(sx+s*0.5, sy, 2, s*0.48);
        ctx.fillRect(sx+s*0.25, sy+s*0.5, 2, s*0.5);
        ctx.fillRect(sx+s*0.75, sy+s*0.5, 2, s*0.5);
      } else {
        ctx.fillRect(sx+s*0.25, sy, 2, s*0.48);
        ctx.fillRect(sx+s*0.75, sy, 2, s*0.48);
        ctx.fillRect(sx+s*0.5, sy+s*0.5, 2, s*0.5);
      }
      // Dark bottom (3D illusion)
      ctx.fillStyle = '#555';
      ctx.fillRect(sx, sy+s-2, s, 2);
      ctx.fillRect(sx+s-1, sy, 1, s);
      // Subtle moss/damage
      ctx.fillStyle = '#5a6a5a';
      if (seed%4===0) ctx.fillRect(sx+s*0.1,sy+s*0.7,3,2);
      if (seed%5===0) ctx.fillRect(sx+s*0.6,sy+s*0.2,2,2);
      break;
    }

    case T.CHURCH_WALL: {
      // Ornate church stone wall
      ctx.fillStyle = '#7a7068';
      ctx.fillRect(sx, sy, s, s);
      // Top edge highlight
      ctx.fillStyle = '#908878';
      ctx.fillRect(sx, sy, s, s*0.12);
      // Brick pattern
      ctx.fillStyle = '#686058';
      ctx.fillRect(sx, sy+s*0.48, s, 2);
      if ((tx+ty)%2===0) {
        ctx.fillRect(sx+s*0.5, sy, 2, s*0.48);
        ctx.fillRect(sx+s*0.25, sy+s*0.5, 2, s*0.5);
        ctx.fillRect(sx+s*0.75, sy+s*0.5, 2, s*0.5);
      } else {
        ctx.fillRect(sx+s*0.25, sy, 2, s*0.48);
        ctx.fillRect(sx+s*0.75, sy, 2, s*0.48);
        ctx.fillRect(sx+s*0.5, sy+s*0.5, 2, s*0.5);
      }
      // Dark bottom
      ctx.fillStyle = '#585048';
      ctx.fillRect(sx, sy+s-2, s, 2);
      ctx.fillRect(sx+s-1, sy, 1, s);
      // Slight golden/warm tint detail
      ctx.fillStyle = '#8a7a68';
      if (seed%3===0) ctx.fillRect(sx+s*0.2,sy+s*0.6,3,2);
      break;
    }

    case T.WINDOW_STONE: {
      ctx.fillStyle = '#707070';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#909090';
      ctx.fillRect(sx, sy, s, s*0.12);
      // Window frame
      ctx.fillStyle = '#4a3a28';
      ctx.fillRect(sx+s*0.15,sy+s*0.12,s*0.7,s*0.76);
      // Glass panes (4 squares)
      ctx.fillStyle = '#6699cc';
      ctx.fillRect(sx+s*0.2, sy+s*0.17, s*0.27, s*0.3);
      ctx.fillRect(sx+s*0.53, sy+s*0.17, s*0.27, s*0.3);
      ctx.fillRect(sx+s*0.2, sy+s*0.53, s*0.27, s*0.3);
      ctx.fillRect(sx+s*0.53, sy+s*0.53, s*0.27, s*0.3);
      // Glass highlight
      ctx.fillStyle = 'rgba(180,220,255,0.3)';
      ctx.fillRect(sx+s*0.22, sy+s*0.19, s*0.1, s*0.12);
      ctx.fillRect(sx+s*0.55, sy+s*0.19, s*0.1, s*0.12);
      // Cross frame
      ctx.fillStyle = '#4a3a28';
      ctx.fillRect(sx+s*0.47, sy+s*0.12, s*0.06, s*0.76);
      ctx.fillRect(sx+s*0.15, sy+s*0.47, s*0.7, s*0.06);
      break;
    }

    case T.WINDOW_WOOD: {
      ctx.fillStyle = '#6a4828';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#7a5838';
      ctx.fillRect(sx, sy, s, s*0.1);
      // Board lines
      ctx.fillStyle = '#5a3818';
      ctx.fillRect(sx+s*0.33,sy,1,s); ctx.fillRect(sx+s*0.66,sy,1,s);
      // Window frame
      ctx.fillStyle = '#4a3018';
      ctx.fillRect(sx+s*0.15,sy+s*0.12,s*0.7,s*0.76);
      // Glass
      ctx.fillStyle = '#7aaad8';
      ctx.fillRect(sx+s*0.2, sy+s*0.17, s*0.27, s*0.3);
      ctx.fillRect(sx+s*0.53, sy+s*0.17, s*0.27, s*0.3);
      ctx.fillRect(sx+s*0.2, sy+s*0.53, s*0.27, s*0.3);
      ctx.fillRect(sx+s*0.53, sy+s*0.53, s*0.27, s*0.3);
      // Light glow
      ctx.fillStyle = 'rgba(255,240,200,0.2)';
      ctx.fillRect(sx+s*0.22, sy+s*0.55, s*0.1, s*0.12);
      // Cross frame
      ctx.fillStyle = '#4a3018';
      ctx.fillRect(sx+s*0.47, sy+s*0.12, s*0.06, s*0.76);
      ctx.fillRect(sx+s*0.15, sy+s*0.47, s*0.7, s*0.06);
      break;
    }

    case T.TORCH_WALL: {
      ctx.fillStyle = '#707070';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#626262';
      ctx.fillRect(sx, sy+s*0.48, s, 2);
      // Bracket
      ctx.fillStyle = '#555';
      ctx.fillRect(sx+s*0.44,sy+s*0.4,s*0.12,s*0.45);
      // Handle
      ctx.fillStyle = '#4a3a28';
      ctx.fillRect(sx+s*0.42,sy+s*0.35,s*0.16,s*0.08);
      // Flame
      ctx.fillStyle = '#ff6600';
      ctx.fillRect(sx+s*0.38,sy+s*0.18,s*0.24,s*0.2);
      ctx.fillStyle = '#ff9900';
      ctx.fillRect(sx+s*0.4,sy+s*0.2,s*0.2,s*0.14);
      ctx.fillStyle = '#ffcc00';
      ctx.fillRect(sx+s*0.44,sy+s*0.22,s*0.12,s*0.08);
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx+s*0.47,sy+s*0.25,s*0.06,s*0.04);
      // Glow
      ctx.fillStyle = 'rgba(255,150,30,0.12)';
      ctx.fillRect(sx,sy,s,s);
      break;
    }

    case T.WATER: {
      // Tibia-style water: deep blue with pixel wave animation
      const wPhase = waterAnimFrame || 0;
      ctx.fillStyle = '#1a4a90';
      ctx.fillRect(sx, sy, s, s);
      // Water depth variation
      ctx.fillStyle = '#1e5298';
      ctx.fillRect(sx+(seed*4)%s, sy+(seed2*3)%s, s*0.3, s*0.25);
      // Animated wave lines
      ctx.fillStyle = 'rgba(100,160,255,0.25)';
      const waveOff = (wPhase * 4 + tx * 3) % 16;
      ctx.fillRect(sx + waveOff % s, sy + s*0.2, s*0.3, 2);
      ctx.fillRect(sx + (waveOff + 8) % s, sy + s*0.65, s*0.25, 2);
      // Shimmer pixels
      ctx.fillStyle = 'rgba(200,230,255,0.2)';
      if ((wPhase + seed) % 3 === 0) {
        ctx.fillRect(sx+s*0.3,sy+s*0.4,2,2);
        ctx.fillRect(sx+s*0.7,sy+s*0.2,2,1);
      }
      if ((wPhase + seed2) % 4 === 0) {
        ctx.fillRect(sx+s*0.5,sy+s*0.7,2,2);
      }
      // Dark depth spots
      ctx.fillStyle = '#153e80';
      if (seed%3===0) ctx.fillRect(sx+s*0.6,sy+s*0.5,s*0.15,s*0.1);
      break;
    }

    case T.TREE: {
      // Tibia-style tree: grass base with detailed tree
      ctx.fillStyle = '#3a8030';
      ctx.fillRect(sx, sy, s, s);
      // Shadow on ground
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(sx+s*0.1,sy+s*0.7,s*0.8,s*0.25);
      // Trunk
      ctx.fillStyle = '#5a3c1a';
      ctx.fillRect(sx+s*0.38,sy+s*0.55,s*0.24,s*0.38);
      ctx.fillStyle = '#4a2c10';
      ctx.fillRect(sx+s*0.44,sy+s*0.6,s*0.06,s*0.3);
      ctx.fillStyle = '#6a4c2a';
      ctx.fillRect(sx+s*0.38,sy+s*0.55,s*0.24,s*0.06);
      // Canopy - layered blocks
      ctx.fillStyle = '#1a5510';
      ctx.fillRect(sx+s*0.1,sy+s*0.15,s*0.8,s*0.45);
      ctx.fillRect(sx+s*0.18,sy+s*0.08,s*0.64,s*0.1);
      ctx.fillStyle = '#226618';
      ctx.fillRect(sx+s*0.15,sy+s*0.18,s*0.4,s*0.28);
      ctx.fillStyle = '#2a7720';
      ctx.fillRect(sx+s*0.2,sy+s*0.12,s*0.3,s*0.18);
      // Leaf highlights
      ctx.fillStyle = '#3a8828';
      ctx.fillRect(sx+s*0.22,sy+s*0.15,s*0.12,s*0.08);
      ctx.fillRect(sx+s*0.55,sy+s*0.2,s*0.15,s*0.06);
      ctx.fillRect(sx+s*0.35,sy+s*0.1,s*0.08,s*0.06);
      // Leaf shadows
      ctx.fillStyle = '#145508';
      ctx.fillRect(sx+s*0.5,sy+s*0.4,s*0.3,s*0.12);
      ctx.fillRect(sx+s*0.15,sy+s*0.45,s*0.2,s*0.08);
      break;
    }

    case T.WOOD_FLOOR: {
      // Tibia-style wooden floor: planks with grain
      ctx.fillStyle = '#a07040';
      ctx.fillRect(sx, sy, s, s);
      // Plank lines
      ctx.fillStyle = '#8a5a30';
      ctx.fillRect(sx, sy+s*0.24, s, 1);
      ctx.fillRect(sx, sy+s*0.49, s, 1);
      ctx.fillRect(sx, sy+s*0.74, s, 1);
      // Board offset lines
      ctx.fillStyle = '#8a5a30';
      if ((tx+ty)%2===0) {
        ctx.fillRect(sx+s*0.4, sy, 1, s*0.24);
        ctx.fillRect(sx+s*0.7, sy+s*0.25, 1, s*0.24);
        ctx.fillRect(sx+s*0.3, sy+s*0.5, 1, s*0.24);
        ctx.fillRect(sx+s*0.6, sy+s*0.75, 1, s*0.25);
      } else {
        ctx.fillRect(sx+s*0.6, sy, 1, s*0.24);
        ctx.fillRect(sx+s*0.3, sy+s*0.25, 1, s*0.24);
        ctx.fillRect(sx+s*0.7, sy+s*0.5, 1, s*0.24);
        ctx.fillRect(sx+s*0.4, sy+s*0.75, 1, s*0.25);
      }
      // Wood grain highlights
      ctx.fillStyle = '#b08050';
      if (seed%2===0) ctx.fillRect(sx+s*0.15,sy+s*0.08,s*0.3,1);
      if (seed%3===0) ctx.fillRect(sx+s*0.5,sy+s*0.58,s*0.2,1);
      // Knots
      ctx.fillStyle = '#7a4a20';
      if (seed===1) ctx.fillRect(sx+s*0.5,sy+s*0.35,3,3);
      if (seed===4) ctx.fillRect(sx+s*0.25,sy+s*0.6,2,2);
      break;
    }

    case T.CHURCH_FLOOR: {
      // Tibia-style church floor: marble checkerboard
      if ((tx+ty)%2===0) {
        ctx.fillStyle = '#d8d0b8';
        ctx.fillRect(sx, sy, s, s);
        ctx.fillStyle = '#e0d8c0';
        ctx.fillRect(sx+1, sy+1, s-2, s-2);
        // Marble veins
        ctx.fillStyle = '#c8c0a8';
        ctx.fillRect(sx+s*0.2,sy+s*0.3,s*0.4,1);
        ctx.fillRect(sx+s*0.5,sy+s*0.6,s*0.3,1);
      } else {
        ctx.fillStyle = '#b8b098';
        ctx.fillRect(sx, sy, s, s);
        ctx.fillStyle = '#c0b8a0';
        ctx.fillRect(sx+1, sy+1, s-2, s-2);
        ctx.fillStyle = '#a8a088';
        ctx.fillRect(sx+s*0.3,sy+s*0.4,s*0.35,1);
      }
      // Tile border
      ctx.fillStyle = '#a09880';
      ctx.fillRect(sx,sy,s,1); ctx.fillRect(sx,sy,1,s);
      break;
    }

    case T.RED_CARPET: {
      // Tibia-style red carpet
      ctx.fillStyle = '#d8d0b8';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#8b1818';
      ctx.fillRect(sx+s*0.06,sy,s*0.88,s);
      // Center stripe
      ctx.fillStyle = '#a02525';
      ctx.fillRect(sx+s*0.15,sy,s*0.7,s);
      // Gold border
      ctx.fillStyle = '#d4a040';
      ctx.fillRect(sx+s*0.06,sy,2,s);
      ctx.fillRect(sx+s*0.88,sy,2,s);
      // Pattern
      ctx.fillStyle = '#9a2020';
      if (ty%2===0) {
        ctx.fillRect(sx+s*0.3,sy+s*0.3,s*0.4,s*0.4);
      }
      break;
    }

    case T.ALTAR: {
      ctx.fillStyle = '#d8d0b8';
      ctx.fillRect(sx, sy, s, s);
      // Altar body
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(sx+s*0.08,sy+s*0.3,s*0.84,s*0.62);
      // Top surface
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(sx+s*0.08,sy+s*0.3,s*0.84,s*0.1);
      // Gold edge
      ctx.fillStyle = '#d4a040';
      ctx.fillRect(sx+s*0.08,sy+s*0.29,s*0.84,2);
      ctx.fillRect(sx+s*0.08,sy+s*0.9,s*0.84,2);
      // Candles
      ctx.fillStyle = '#f0e8c0';
      ctx.fillRect(sx+s*0.18,sy+s*0.12,s*0.08,s*0.2);
      ctx.fillRect(sx+s*0.74,sy+s*0.12,s*0.08,s*0.2);
      // Flames
      ctx.fillStyle = '#ff8800';
      ctx.fillRect(sx+s*0.19,sy+s*0.06,s*0.06,s*0.08);
      ctx.fillRect(sx+s*0.75,sy+s*0.06,s*0.06,s*0.08);
      ctx.fillStyle = '#ffcc00';
      ctx.fillRect(sx+s*0.2,sy+s*0.08,s*0.04,s*0.04);
      ctx.fillRect(sx+s*0.76,sy+s*0.08,s*0.04,s*0.04);
      break;
    }

    case T.CROSS: {
      ctx.fillStyle = '#d8d0b8';
      ctx.fillRect(sx, sy, s, s);
      // Golden cross
      ctx.fillStyle = '#d4a040';
      ctx.fillRect(sx+s*0.42,sy+s*0.05,s*0.16,s*0.85);
      ctx.fillRect(sx+s*0.22,sy+s*0.2,s*0.56,s*0.16);
      // Highlight
      ctx.fillStyle = '#e4b050';
      ctx.fillRect(sx+s*0.42,sy+s*0.05,s*0.16,s*0.04);
      ctx.fillRect(sx+s*0.22,sy+s*0.2,s*0.56,s*0.04);
      // Shadow
      ctx.fillStyle = '#b08030';
      ctx.fillRect(sx+s*0.42,sy+s*0.86,s*0.16,s*0.04);
      ctx.fillRect(sx+s*0.56,sy+s*0.2,2,s*0.16);
      break;
    }

    case T.CHURCH_PEW: {
      ctx.fillStyle = '#d8d0b8';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#a09880';
      ctx.fillRect(sx,sy,s,1); ctx.fillRect(sx,sy,1,s);
      // Bench
      ctx.fillStyle = '#5a3015';
      ctx.fillRect(sx+s*0.08,sy+s*0.25,s*0.84,s*0.55);
      // Top surface
      ctx.fillStyle = '#6a4025';
      ctx.fillRect(sx+s*0.08,sy+s*0.25,s*0.84,s*0.12);
      // Back rest
      ctx.fillStyle = '#7a5035';
      ctx.fillRect(sx+s*0.08,sy+s*0.12,s*0.84,s*0.16);
      // Detail
      ctx.fillStyle = '#4a2008';
      ctx.fillRect(sx+s*0.12,sy+s*0.7,s*0.06,s*0.12);
      ctx.fillRect(sx+s*0.82,sy+s*0.7,s*0.06,s*0.12);
      break;
    }

    case T.ANVIL: {
      ctx.fillStyle = '#a07040';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#8a5a30';
      ctx.fillRect(sx, sy+s*0.49, s, 1);
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(sx+s*0.15,sy+s*0.75,s*0.7,s*0.12);
      // Anvil base
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(sx+s*0.25,sy+s*0.6,s*0.5,s*0.25);
      // Anvil top
      ctx.fillStyle = '#4a4a4a';
      ctx.fillRect(sx+s*0.12,sy+s*0.38,s*0.76,s*0.24);
      // Horn
      ctx.fillStyle = '#555';
      ctx.fillRect(sx+s*0.05,sy+s*0.42,s*0.1,s*0.12);
      // Surface highlight
      ctx.fillStyle = '#656565';
      ctx.fillRect(sx+s*0.15,sy+s*0.38,s*0.7,s*0.06);
      break;
    }

    case T.FURNACE: {
      ctx.fillStyle = '#a07040';
      ctx.fillRect(sx, sy, s, s);
      // Furnace body
      ctx.fillStyle = '#4a3030';
      ctx.fillRect(sx+s*0.08,sy+s*0.08,s*0.84,s*0.84);
      // Stone frame
      ctx.fillStyle = '#5a4040';
      ctx.fillRect(sx+s*0.08,sy+s*0.08,s*0.84,s*0.1);
      ctx.fillRect(sx+s*0.08,sy+s*0.08,s*0.1,s*0.84);
      ctx.fillRect(sx+s*0.82,sy+s*0.08,s*0.1,s*0.84);
      // Fire opening
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(sx+s*0.22,sy+s*0.42,s*0.56,s*0.4);
      // Fire
      ctx.fillStyle = '#cc3300';
      ctx.fillRect(sx+s*0.28,sy+s*0.55,s*0.44,s*0.22);
      ctx.fillStyle = '#ff6600';
      ctx.fillRect(sx+s*0.32,sy+s*0.58,s*0.36,s*0.15);
      ctx.fillStyle = '#ffaa00';
      ctx.fillRect(sx+s*0.38,sy+s*0.6,s*0.24,s*0.1);
      ctx.fillStyle = '#ffdd44';
      ctx.fillRect(sx+s*0.44,sy+s*0.62,s*0.12,s*0.06);
      // Glow
      ctx.fillStyle = 'rgba(255,80,0,0.08)';
      ctx.fillRect(sx,sy,s,s);
      break;
    }

    case T.BOOKSHELF: {
      ctx.fillStyle = '#d8d0b8';
      ctx.fillRect(sx, sy, s, s);
      // Shelf frame
      ctx.fillStyle = '#4a2810';
      ctx.fillRect(sx+s*0.06,sy+s*0.04,s*0.88,s*0.92);
      // Shelves
      ctx.fillStyle = '#5a3820';
      ctx.fillRect(sx+s*0.06,sy+s*0.32,s*0.88,s*0.04);
      ctx.fillRect(sx+s*0.06,sy+s*0.62,s*0.88,s*0.04);
      // Books
      const bColors = ['#8b1818','#18408b','#186828','#8b6818','#6818688'];
      for (let i = 0; i < 5; i++) {
        const bx = sx + s*0.1 + i * s*0.16;
        ctx.fillStyle = bColors[(seed+i)%5];
        ctx.fillRect(bx, sy+s*0.08, s*0.12, s*0.24);
        ctx.fillRect(bx, sy+s*0.38, s*0.12, s*0.24);
        ctx.fillRect(bx, sy+s*0.68, s*0.12, s*0.24);
      }
      // Book highlights
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(sx+s*0.1,sy+s*0.08,s*0.12,s*0.04);
      break;
    }

    case T.TABLE: {
      ctx.fillStyle = '#a07040';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#8a5a30';
      ctx.fillRect(sx, sy+s*0.49, s, 1);
      // Table surface
      ctx.fillStyle = '#7a5030';
      ctx.fillRect(sx+s*0.06,sy+s*0.22,s*0.88,s*0.56);
      // Top highlight
      ctx.fillStyle = '#8a6040';
      ctx.fillRect(sx+s*0.06,sy+s*0.22,s*0.88,s*0.1);
      // Legs
      ctx.fillStyle = '#5a3018';
      ctx.fillRect(sx+s*0.1,sy+s*0.78,s*0.08,s*0.18);
      ctx.fillRect(sx+s*0.82,sy+s*0.78,s*0.08,s*0.18);
      break;
    }

    case T.CHAIR: {
      ctx.fillStyle = '#a07040';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#8a5a30';
      ctx.fillRect(sx, sy+s*0.49, s, 1);
      // Back
      ctx.fillStyle = '#5a3018';
      ctx.fillRect(sx+s*0.2,sy+s*0.12,s*0.6,s*0.3);
      // Back detail
      ctx.fillStyle = '#6a4028';
      ctx.fillRect(sx+s*0.25,sy+s*0.16,s*0.5,s*0.08);
      ctx.fillRect(sx+s*0.25,sy+s*0.3,s*0.5,s*0.08);
      // Seat
      ctx.fillStyle = '#6a4028';
      ctx.fillRect(sx+s*0.18,sy+s*0.44,s*0.64,s*0.16);
      // Legs
      ctx.fillStyle = '#4a2008';
      ctx.fillRect(sx+s*0.22,sy+s*0.6,s*0.06,s*0.32);
      ctx.fillRect(sx+s*0.72,sy+s*0.6,s*0.06,s*0.32);
      break;
    }

    case T.BED: {
      ctx.fillStyle = '#a07040';
      ctx.fillRect(sx, sy, s, s);
      // Frame
      ctx.fillStyle = '#5a3018';
      ctx.fillRect(sx+s*0.04,sy+s*0.12,s*0.92,s*0.8);
      // Mattress
      ctx.fillStyle = '#e0d8c0';
      ctx.fillRect(sx+s*0.08,sy+s*0.18,s*0.84,s*0.68);
      // Blanket
      ctx.fillStyle = '#7a1818';
      ctx.fillRect(sx+s*0.08,sy+s*0.45,s*0.84,s*0.42);
      ctx.fillStyle = '#8a2828';
      ctx.fillRect(sx+s*0.08,sy+s*0.45,s*0.84,s*0.08);
      // Pillow
      ctx.fillStyle = '#f0ead8';
      ctx.fillRect(sx+s*0.12,sy+s*0.2,s*0.35,s*0.2);
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx+s*0.14,sy+s*0.22,s*0.3,s*0.06);
      break;
    }

    case T.RUG: {
      ctx.fillStyle = '#a07040';
      ctx.fillRect(sx, sy, s, s);
      // Rug
      ctx.fillStyle = '#7a2020';
      ctx.fillRect(sx+s*0.04,sy+s*0.04,s*0.92,s*0.92);
      ctx.fillStyle = '#8a3030';
      ctx.fillRect(sx+s*0.12,sy+s*0.12,s*0.76,s*0.76);
      // Gold border pattern
      ctx.fillStyle = '#d4a040';
      ctx.fillRect(sx+s*0.06,sy+s*0.06,s*0.88,2);
      ctx.fillRect(sx+s*0.06,sy+s*0.92,s*0.88,2);
      ctx.fillRect(sx+s*0.06,sy+s*0.06,2,s*0.88);
      ctx.fillRect(sx+s*0.92,sy+s*0.06,2,s*0.88);
      // Inner border
      ctx.fillRect(sx+s*0.15,sy+s*0.15,s*0.7,1);
      ctx.fillRect(sx+s*0.15,sy+s*0.84,s*0.7,1);
      ctx.fillRect(sx+s*0.15,sy+s*0.15,1,s*0.7);
      ctx.fillRect(sx+s*0.84,sy+s*0.15,1,s*0.7);
      break;
    }

    case T.BARREL: {
      ctx.fillStyle = '#a07040';
      ctx.fillRect(sx, sy, s, s);
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(sx+s*0.15,sy+s*0.78,s*0.7,s*0.12);
      // Barrel body
      ctx.fillStyle = '#6a4420';
      ctx.fillRect(sx+s*0.18,sy+s*0.12,s*0.64,s*0.76);
      // Wider middle
      ctx.fillStyle = '#7a5430';
      ctx.fillRect(sx+s*0.14,sy+s*0.3,s*0.72,s*0.4);
      // Metal rings
      ctx.fillStyle = '#555';
      ctx.fillRect(sx+s*0.16,sy+s*0.22,s*0.68,2);
      ctx.fillRect(sx+s*0.16,sy+s*0.72,s*0.68,2);
      // Top
      ctx.fillStyle = '#8a6440';
      ctx.fillRect(sx+s*0.2,sy+s*0.1,s*0.6,s*0.06);
      // Highlight
      ctx.fillStyle = '#8a6440';
      ctx.fillRect(sx+s*0.2,sy+s*0.35,s*0.15,s*0.1);
      break;
    }

    case T.CRATE: {
      ctx.fillStyle = '#a07040';
      ctx.fillRect(sx, sy, s, s);
      // Crate body
      ctx.fillStyle = '#8a6840';
      ctx.fillRect(sx+s*0.12,sy+s*0.12,s*0.76,s*0.76);
      // Top highlight
      ctx.fillStyle = '#9a7850';
      ctx.fillRect(sx+s*0.12,sy+s*0.12,s*0.76,s*0.08);
      // Planks
      ctx.fillStyle = '#7a5830';
      ctx.fillRect(sx+s*0.12,sy+s*0.36,s*0.76,2);
      ctx.fillRect(sx+s*0.12,sy+s*0.6,s*0.76,2);
      ctx.fillRect(sx+s*0.36,sy+s*0.12,2,s*0.76);
      ctx.fillRect(sx+s*0.62,sy+s*0.12,2,s*0.76);
      // Nails
      ctx.fillStyle = '#aaa';
      ctx.fillRect(sx+s*0.36,sy+s*0.36,2,2);
      ctx.fillRect(sx+s*0.62,sy+s*0.36,2,2);
      ctx.fillRect(sx+s*0.36,sy+s*0.6,2,2);
      ctx.fillRect(sx+s*0.62,sy+s*0.6,2,2);
      break;
    }

    case T.WELL: {
      ctx.fillStyle = '#888';
      ctx.fillRect(sx, sy, s, s);
      // Well base
      ctx.fillStyle = '#666';
      ctx.fillRect(sx+s*0.08,sy+s*0.25,s*0.84,s*0.68);
      // Well wall top
      ctx.fillStyle = '#7a7a7a';
      ctx.fillRect(sx+s*0.08,sy+s*0.25,s*0.84,s*0.12);
      // Water inside
      ctx.fillStyle = '#1a4a90';
      ctx.fillRect(sx+s*0.18,sy+s*0.4,s*0.64,s*0.42);
      // Posts
      ctx.fillStyle = '#5a3818';
      ctx.fillRect(sx+s*0.12,sy+s*0.08,s*0.08,s*0.55);
      ctx.fillRect(sx+s*0.8,sy+s*0.08,s*0.08,s*0.55);
      // Roof beam
      ctx.fillStyle = '#6a4828';
      ctx.fillRect(sx+s*0.08,sy+s*0.06,s*0.84,s*0.06);
      // Rope
      ctx.fillStyle = '#8a7a50';
      ctx.fillRect(sx+s*0.48,sy+s*0.12,2,s*0.3);
      break;
    }

    case T.FENCE: {
      ctx.fillStyle = '#3a8030';
      ctx.fillRect(sx, sy, s, s);
      // Posts
      ctx.fillStyle = '#6a4828';
      ctx.fillRect(sx+s*0.08,sy+s*0.18,s*0.1,s*0.74);
      ctx.fillRect(sx+s*0.82,sy+s*0.18,s*0.1,s*0.74);
      // Post tops
      ctx.fillStyle = '#7a5838';
      ctx.fillRect(sx+s*0.06,sy+s*0.14,s*0.14,s*0.06);
      ctx.fillRect(sx+s*0.8,sy+s*0.14,s*0.14,s*0.06);
      // Rails
      ctx.fillStyle = '#7a5838';
      ctx.fillRect(sx,sy+s*0.32,s,s*0.08);
      ctx.fillRect(sx,sy+s*0.58,s,s*0.08);
      // Rail highlight
      ctx.fillStyle = '#8a6848';
      ctx.fillRect(sx,sy+s*0.32,s,2);
      ctx.fillRect(sx,sy+s*0.58,s,2);
      break;
    }

    case T.WOOD_WALL: {
      // Tibia-style wood wall: horizontal planks with 3D edge
      ctx.fillStyle = '#6a4828';
      ctx.fillRect(sx, sy, s, s);
      // Top highlight
      ctx.fillStyle = '#7a5838';
      ctx.fillRect(sx, sy, s, s*0.1);
      // Horizontal plank lines
      ctx.fillStyle = '#5a3818';
      ctx.fillRect(sx, sy+s*0.32, s, 1);
      ctx.fillRect(sx, sy+s*0.64, s, 1);
      // Vertical board lines
      if ((tx+ty)%2===0) {
        ctx.fillRect(sx+s*0.5, sy, 1, s*0.32);
        ctx.fillRect(sx+s*0.3, sy+s*0.33, 1, s*0.31);
        ctx.fillRect(sx+s*0.7, sy+s*0.65, 1, s*0.35);
      } else {
        ctx.fillRect(sx+s*0.35, sy, 1, s*0.32);
        ctx.fillRect(sx+s*0.65, sy+s*0.33, 1, s*0.31);
        ctx.fillRect(sx+s*0.45, sy+s*0.65, 1, s*0.35);
      }
      // Dark bottom
      ctx.fillStyle = '#4a2810';
      ctx.fillRect(sx, sy+s-2, s, 2);
      ctx.fillRect(sx+s-1, sy, 1, s);
      // Nail
      ctx.fillStyle = '#888';
      if (seed%3===0) ctx.fillRect(sx+s*0.4,sy+s*0.45,2,2);
      break;
    }

    case T.SAND: {
      ctx.fillStyle = '#d4bc88';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#c4ac78';
      ctx.fillRect(sx+(seed*5)%s, sy+(seed2*4)%s, s*0.25, s*0.2);
      ctx.fillStyle = '#dcc898';
      ctx.fillRect(sx+(seed2*6)%s, sy+(seed*3)%s, s*0.2, s*0.15);
      // Sand specks
      ctx.fillStyle = '#b49c68';
      if (seed===0) ctx.fillRect(sx+s*0.3,sy+s*0.5,2,1);
      if (seed===2) ctx.fillRect(sx+s*0.6,sy+s*0.3,2,1);
      if (seed===4) ctx.fillRect(sx+s*0.15,sy+s*0.7,1,2);
      // Shells
      ctx.fillStyle = '#e8dcc0';
      if (seed3===0) ctx.fillRect(sx+s*0.7,sy+s*0.6,3,2);
      break;
    }

    case T.GRAVESTONE: {
      ctx.fillStyle = '#6a5a40';
      ctx.fillRect(sx, sy, s, s);
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(sx+s*0.2,sy+s*0.75,s*0.6,s*0.12);
      // Stone
      ctx.fillStyle = '#808080';
      ctx.fillRect(sx+s*0.22,sy+s*0.25,s*0.56,s*0.6);
      // Round top
      ctx.fillRect(sx+s*0.28,sy+s*0.18,s*0.44,s*0.1);
      ctx.fillRect(sx+s*0.34,sy+s*0.12,s*0.32,s*0.08);
      // Highlight
      ctx.fillStyle = '#909090';
      ctx.fillRect(sx+s*0.24,sy+s*0.25,s*0.52,s*0.06);
      // Cross engraving
      ctx.fillStyle = '#9a9a9a';
      ctx.fillRect(sx+s*0.46,sy+s*0.2,s*0.08,s*0.35);
      ctx.fillRect(sx+s*0.36,sy+s*0.28,s*0.28,s*0.06);
      // Wear
      ctx.fillStyle = '#6a6a6a';
      if (seed%2===0) ctx.fillRect(sx+s*0.3,sy+s*0.7,s*0.12,s*0.08);
      break;
    }

    case T.DEAD_TREE: {
      ctx.fillStyle = '#6a5a40';
      ctx.fillRect(sx, sy, s, s);
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(sx+s*0.15,sy+s*0.78,s*0.7,s*0.12);
      // Trunk
      ctx.fillStyle = '#3a2510';
      ctx.fillRect(sx+s*0.38,sy+s*0.35,s*0.24,s*0.58);
      ctx.fillStyle = '#4a3520';
      ctx.fillRect(sx+s*0.38,sy+s*0.35,s*0.24,s*0.06);
      // Branches
      ctx.fillStyle = '#3a2510';
      // Left branches
      ctx.fillRect(sx+s*0.15,sy+s*0.25,s*0.25,s*0.04);
      ctx.fillRect(sx+s*0.08,sy+s*0.12,s*0.1,s*0.04);
      ctx.fillRect(sx+s*0.15,sy+s*0.15,s*0.04,s*0.12);
      // Right branches
      ctx.fillRect(sx+s*0.6,sy+s*0.2,s*0.28,s*0.04);
      ctx.fillRect(sx+s*0.82,sy+s*0.1,s*0.1,s*0.04);
      ctx.fillRect(sx+s*0.82,sy+s*0.1,s*0.04,s*0.14);
      // Upper branch
      ctx.fillRect(sx+s*0.45,sy+s*0.08,s*0.04,s*0.28);
      ctx.fillRect(sx+s*0.3,sy+s*0.06,s*0.2,s*0.04);
      break;
    }

    case T.BONE: {
      ctx.fillStyle = '#8a6e48';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#7a5e38';
      if (seed%2===0) ctx.fillRect(sx+s*0.1,sy+s*0.7,s*0.1,s*0.06);
      // Bone
      ctx.fillStyle = '#e0d8c0';
      ctx.save();
      ctx.translate(sx+s*0.5, sy+s*0.5);
      ctx.rotate((seed * 0.8) % (Math.PI * 2));
      ctx.fillRect(-s*0.28, -s*0.03, s*0.56, s*0.06);
      // Bone ends
      ctx.fillRect(-s*0.3, -s*0.06, s*0.06, s*0.12);
      ctx.fillRect(s*0.24, -s*0.06, s*0.06, s*0.12);
      ctx.restore();
      break;
    }

    case T.MUD: {
      ctx.fillStyle = '#604020';
      ctx.fillRect(sx, sy, s, s);
      // Puddles
      ctx.fillStyle = '#503010';
      if (seed===0) ctx.fillRect(sx+s*0.2,sy+s*0.3,s*0.3,s*0.15);
      if (seed===2) ctx.fillRect(sx+s*0.5,sy+s*0.6,s*0.25,s*0.12);
      if (seed===4) ctx.fillRect(sx+s*0.15,sy+s*0.65,s*0.2,s*0.1);
      // Wet shine
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      if (seed%3===0) ctx.fillRect(sx+s*0.4,sy+s*0.25,s*0.15,s*0.08);
      // Texture
      ctx.fillStyle = '#705030';
      ctx.fillRect(sx+(seed*4)%s,sy+(seed2*5)%s,s*0.2,s*0.15);
      break;
    }

    case T.HAY: {
      ctx.fillStyle = '#604020';
      ctx.fillRect(sx, sy, s, s);
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(sx+s*0.12,sy+s*0.78,s*0.76,s*0.12);
      // Hay bale body
      ctx.fillStyle = '#c09838';
      ctx.fillRect(sx+s*0.08,sy+s*0.18,s*0.84,s*0.68);
      // Top
      ctx.fillStyle = '#d0a848';
      ctx.fillRect(sx+s*0.08,sy+s*0.18,s*0.84,s*0.1);
      // Straw lines
      ctx.fillStyle = '#a88028';
      ctx.fillRect(sx+s*0.08,sy+s*0.38,s*0.84,1);
      ctx.fillRect(sx+s*0.08,sy+s*0.55,s*0.84,1);
      ctx.fillRect(sx+s*0.08,sy+s*0.72,s*0.84,1);
      // Rope
      ctx.fillStyle = '#6a4818';
      ctx.fillRect(sx+s*0.48,sy+s*0.18,s*0.06,s*0.68);
      // Loose straw
      ctx.fillStyle = '#d0a848';
      ctx.fillRect(sx+s*0.05,sy+s*0.82,s*0.08,2);
      ctx.fillRect(sx+s*0.88,sy+s*0.85,s*0.08,2);
      break;
    }

    case T.ROOF_STONE: {
      ctx.fillStyle = '#606060';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#707070';
      ctx.fillRect(sx, sy, s, s*0.1);
      ctx.fillStyle = '#505050';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(sx, sy + s*0.1 + i*s*0.3, s, 1);
      }
      break;
    }

    case T.ROOF_WOOD: {
      ctx.fillStyle = '#7a4828';
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = '#8a5838';
      ctx.fillRect(sx, sy, s, s*0.1);
      ctx.fillStyle = '#6a3818';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(sx, sy + s*0.1 + i*s*0.3, s, 1);
      }
      break;
    }

    default: {
      ctx.fillStyle = '#3a8030';
      ctx.fillRect(sx, sy, s, s);
      break;
    }
  }
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
  let html = '<h4>📜 Missões</h4>';
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
    recipesDiv.innerHTML = '<h4 style="color:#d4a750;margin:8px 0 4px;">🛠️ Receitas:</h4>';
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
