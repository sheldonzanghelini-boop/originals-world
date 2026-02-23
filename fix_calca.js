// Limpa duplicatas de calca_boss_esqueleto para Sheldon, deixando apenas 1
const Database = require('better-sqlite3');
const db = new Database('game.db');

const acc = db.prepare("SELECT id FROM accounts WHERE username = 'Sheldon'").get();
const char = db.prepare('SELECT id FROM characters WHERE account_id = ?').get(acc.id);

const rows = db.prepare("SELECT id, slot_order FROM inventory WHERE character_id = ? AND item_id = 'calca_boss_esqueleto' ORDER BY id ASC").all(char.id);
console.log('Registros encontrados:', rows.length);

// Manter o primeiro, deletar o resto
if (rows.length > 1) {
  for (let i = 1; i < rows.length; i++) {
    db.prepare('DELETE FROM inventory WHERE id = ?').run(rows[i].id);
    console.log('Removido duplicado id=' + rows[i].id);
  }
}

const remaining = db.prepare("SELECT * FROM inventory WHERE character_id = ? AND item_id = 'calca_boss_esqueleto'").all(char.id);
console.log('Registros finais:', JSON.stringify(remaining));
db.close();
