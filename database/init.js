require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { getDb } = require('./db');

function initDatabase() {
  const db = getDb();

  // Détecte si l'ancienne table existe (password NOT NULL) et migre si besoin
  const tableInfo = db.prepare("PRAGMA table_info(users)").all();
  const passwordCol = tableInfo.find(c => c.name === 'password');
  const needsMigration = passwordCol && passwordCol.notnull === 1;

  if (needsMigration) {
    console.log('⚙️  Migration du schéma en cours…');
    db.exec(`
      DROP TABLE IF EXISTS content_saves;
      DROP TABLE IF EXISTS users;
    `);
  }

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

  // Migration : ajout des nouvelles colonnes si absentes
  const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols.includes('email')) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes('welcome_email_sent')) {
    db.exec("ALTER TABLE users ADD COLUMN welcome_email_sent INTEGER NOT NULL DEFAULT 0");
  }

  // Migration : ajout unique_count à page_views si absent
  const pvCols = db.prepare("PRAGMA table_info(page_views)").all().map(c => c.name);
  if (!pvCols.includes('unique_count')) {
    db.exec("ALTER TABLE page_views ADD COLUMN unique_count INTEGER NOT NULL DEFAULT 0");
  }

  // Seed des deux utilisateurs avec mot de passe temporaire aléatoire
  const users = [
    { username: 'j.gabriel',   email: 'julien.gabriel@me.com', role: 'admin'  },
    { username: 'a.vuillemin', email: 'julien.gabriel@me.com', role: 'editor' }
  ];

  const newUsers = [];
  for (const { username, email, role } of users) {
    const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);
    if (!existing) {
      const tempPassword = crypto.randomBytes(6).toString('base64url'); // ex: "aB3xK9mQ"
      const hash = bcrypt.hashSync(tempPassword, 12);
      db.prepare(`
        INSERT INTO users (username, email, password, must_set_password, welcome_email_sent, role)
        VALUES (?, ?, ?, 1, 0, ?)
      `).run(username, email, hash, role);
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

  // Ajoute is_base si la colonne n'existe pas encore (migration)
  const cols = db.prepare("PRAGMA table_info(content_saves)").all();
  if (!cols.find(c => c.name === 'is_base')) {
    db.exec("ALTER TABLE content_saves ADD COLUMN is_base INTEGER NOT NULL DEFAULT 0");
    console.log('✓ Colonne is_base ajoutée à content_saves');
  }

  console.log('✓ Base de données prête');
}

module.exports = { initDatabase };
