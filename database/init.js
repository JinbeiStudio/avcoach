require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { getDb } = require('./db');

function initDatabase() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      username             TEXT    NOT NULL UNIQUE,
      email                TEXT    NOT NULL DEFAULT '',
      password             TEXT    DEFAULT NULL,
      must_set_password    INTEGER NOT NULL DEFAULT 1,
      welcome_email_sent   INTEGER NOT NULL DEFAULT 0,
      role                 TEXT    NOT NULL DEFAULT 'admin',
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      last_login           TEXT
    );

    CREATE TABLE IF NOT EXISTS content_saves (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      saved_by   INTEGER REFERENCES users(id),
      saved_at   TEXT NOT NULL DEFAULT (datetime('now')),
      snapshot   TEXT NOT NULL,
      is_base    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS page_views (
      date         TEXT PRIMARY KEY,
      count        INTEGER NOT NULL DEFAULT 0,
      unique_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS visitor_ips (
      date TEXT NOT NULL,
      ip   TEXT NOT NULL,
      PRIMARY KEY (date, ip)
    );

    CREATE TABLE IF NOT EXISTS contact_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL,
      message    TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      read       INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Seed des deux utilisateurs avec mot de passe temporaire aléatoire
  const users = [
    { username: 'j.gabriel', email: 'julien.gabriel@me.com', role: 'admin' },
    { username: 'a.vuillemin', email: 'julien.gabriel@me.com', role: 'editor' }
  ];

  const newUsers = [];
  for (const { username, email, role } of users) {
    const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);
    if (!existing) {
      const tempPassword = crypto.randomBytes(6).toString('base64url'); // ex: "aB3xK9mQ"
      const hash = bcrypt.hashSync(tempPassword, 12);
      db.prepare(
        `
        INSERT INTO users (username, email, password, must_set_password, welcome_email_sent, role)
        VALUES (?, ?, ?, 1, 0, ?)
      `
      ).run(username, email, hash, role);
      console.log(`✓ Utilisateur créé : ${username} (${role}) — mot de passe temporaire généré`);
      newUsers.push({ username, email, tempPassword, role });
    } else {
      if (existing.role !== role) {
        db.prepare('UPDATE users SET role = ? WHERE username = ?').run(role, username);
        console.log(`✓ Rôle mis à jour : ${username} → ${role}`);
      }
    }
  }

  return { newUsers };
}

module.exports = { initDatabase };
