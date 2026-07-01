const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'avcoach.sqlite');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function resetDb() {
  if (db) {
    try {
      db.close();
    } catch (_e) {}
  }
  db = null;
}

module.exports = { getDb, resetDb };
