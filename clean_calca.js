// Limpa TODOS os registros de calca_boss_esqueleto do DB
const Database = require('better-sqlite3');
const db = new Database('game.db');
const deleted = db.prepare("DELETE FROM inventory WHERE item_id = 'calca_boss_esqueleto'").run();
console.log('Registros deletados:', deleted.changes);
// Confirma
const remaining = db.prepare("SELECT * FROM inventory WHERE item_id = 'calca_boss_esqueleto'").all();
console.log('Restantes:', remaining.length);
db.close();
