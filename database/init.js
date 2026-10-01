require('dotenv').config({ quiet: true });
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
      last_login           TEXT,
      token_version        INTEGER NOT NULL DEFAULT 0
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

  // Garde-fou : ajoute token_version aux bases créées avant cette colonne
  const cols = db.prepare('PRAGMA table_info(users)').all();
  if (!cols.some((c) => c.name === 'token_version')) {
    db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  }

  // Seules les IPs hachées du jour servent à l'unicité
  db.exec("DELETE FROM visitor_ips WHERE date < date('now')");

  // Premier admin depuis l'environnement, uniquement si la table users est vide
  const newUsers = [];
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    const username = process.env.ADMIN_USERNAME;
    const email = process.env.ADMIN_EMAIL;
    if (username && email) {
      const tempPassword = crypto.randomBytes(6).toString('base64url'); // ex: "aB3xK9mQ"
      const hash = bcrypt.hashSync(tempPassword, 12);
      db.prepare(
        `
        INSERT INTO users (username, email, password, must_set_password, welcome_email_sent, role)
        VALUES (?, ?, ?, 1, 0, 'admin')
      `
      ).run(username, email, hash);
      console.log(`✓ Utilisateur créé : ${username} (admin) — mot de passe temporaire généré`);
      newUsers.push({ username, email, tempPassword, role: 'admin' });
    } else {
      console.warn(
        '⚠ Aucun utilisateur en base : définissez ADMIN_USERNAME et ADMIN_EMAIL pour créer le premier admin.'
      );
    }
  }

  return { newUsers };
}

module.exports = { initDatabase };
