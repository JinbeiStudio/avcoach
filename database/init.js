require('dotenv').config();
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
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      username          TEXT    NOT NULL UNIQUE,
      password          TEXT    DEFAULT NULL,
      must_set_password INTEGER NOT NULL DEFAULT 1,
      role              TEXT    NOT NULL DEFAULT 'admin',
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      last_login        TEXT
    );

    CREATE TABLE IF NOT EXISTS content_saves (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      saved_by   INTEGER REFERENCES users(id),
      saved_at   TEXT NOT NULL DEFAULT (datetime('now')),
      snapshot   TEXT NOT NULL,
      is_base    INTEGER NOT NULL DEFAULT 0
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

  // Seed des deux utilisateurs (sans mot de passe, première connexion requise)
  const users = [
    { username: 'j.gabriel',   role: 'admin'  },
    { username: 'a.vuillemin', role: 'editor' }
  ];
  for (const { username, role } of users) {
    const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);
    if (!existing) {
      db.prepare(`INSERT INTO users (username, password, must_set_password, role) VALUES (?, NULL, 1, ?)`)
        .run(username, role);
      console.log(`✓ Utilisateur créé : ${username} (${role})`);
    } else if (existing.role !== role) {
      db.prepare('UPDATE users SET role = ? WHERE username = ?').run(role, username);
      console.log(`✓ Rôle mis à jour : ${username} → ${role}`);
    }
  }

  // Ajoute is_base si la colonne n'existe pas encore (migration)
  const cols = db.prepare("PRAGMA table_info(content_saves)").all();
  if (!cols.find(c => c.name === 'is_base')) {
    db.exec("ALTER TABLE content_saves ADD COLUMN is_base INTEGER NOT NULL DEFAULT 0");
    console.log('✓ Colonne is_base ajoutée à content_saves');
  }

  console.log('✓ Base de données prête');
}

module.exports = { initDatabase };
