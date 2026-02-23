const Database = require('better-sqlite3');
const db = new Database('game.db');

const acc = db.prepare("SELECT id FROM accounts WHERE username = 'Sheldon'").get();
if (!acc) { console.log('Conta Sheldon nao encontrada'); process.exit(1); }

const char = db.prepare('SELECT id FROM characters WHERE account_id = ?').get(acc.id);
if (!char) { console.log('Personagem nao encontrado'); process.exit(1); }

// Mostra itens calca existentes
const existing = db.prepare("SELECT * FROM inventory WHERE character_id = ? AND item_id = 'calca_boss_esqueleto'").all(char.id);
console.log('Calcas existentes no DB:', JSON.stringify(existing));

// Pega proximo slot_order
const maxOrder = db.prepare('SELECT MAX(slot_order) as m FROM inventory WHERE character_id = ?').get(char.id);
const nextOrder = (maxOrder.m !== null ? maxOrder.m : 0) + 1;

// Insere 1 calca_boss_esqueleto
db.prepare("INSERT INTO inventory (character_id, item_id, quantity, slot_order) VALUES (?, 'calca_boss_esqueleto', 1, ?)").run(char.id, nextOrder);
console.log('calca_boss_esqueleto adicionada com sucesso! slot_order=' + nextOrder);

db.close();
