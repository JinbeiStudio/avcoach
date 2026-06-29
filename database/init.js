require('dotenv').config();
const bcrypt = require('bcrypt');
const { getDb } = require('./db');

function initDatabase() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    NOT NULL UNIQUE,
      password    TEXT    NOT NULL,
      role        TEXT    NOT NULL DEFAULT 'admin',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      last_login  TEXT
    );

    CREATE TABLE IF NOT EXISTS content_saves (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      saved_by   INTEGER REFERENCES users(id),
      saved_at   TEXT NOT NULL DEFAULT (datetime('now')),
      snapshot   TEXT NOT NULL
    );
  `);

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existing) {
    const hash = bcrypt.hashSync('avcoach2025', 12);
    db.prepare(`
      INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')
    `).run('admin', hash);
    console.log('✓ Utilisateur admin créé (login: admin / mdp: avcoach2025)');
  } else {
    console.log('✓ Base de données prête');
  }
}

module.exports = { initDatabase };
