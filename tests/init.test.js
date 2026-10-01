/**
 * Tests de initDatabase() — création du premier admin depuis l'environnement.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

const files = [];

function freshDb() {
  const file = path.join(os.tmpdir(), `avcoach-init-${process.pid}-${files.length}.sqlite`);
  files.push(file);
  process.env.DATABASE_PATH = file;
  jest.resetModules();
  const { getDb, resetDb } = require('../database/db');
  const { initDatabase } = require('../database/init');
  return { getDb, resetDb, initDatabase };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_EMAIL;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  for (const f of files) {
    for (const ext of ['', '-shm', '-wal']) {
      try {
        fs.unlinkSync(f + ext);
      } catch {}
    }
  }
});

describe('initDatabase — premier admin', () => {
  test('crée un admin si la table est vide et les variables sont définies', () => {
    process.env.ADMIN_USERNAME = 'first.admin';
    process.env.ADMIN_EMAIL = 'first@test.com';
    const { getDb, resetDb, initDatabase } = freshDb();
    const { newUsers } = initDatabase();
    const users = getDb().prepare('SELECT username, role, must_set_password FROM users').all();
    expect(users).toEqual([{ username: 'first.admin', role: 'admin', must_set_password: 1 }]);
    expect(newUsers).toHaveLength(1);
    expect(newUsers[0].tempPassword).toBeDefined();
    resetDb();
  });

  test('ne crée rien si les variables sont absentes', () => {
    const { getDb, resetDb, initDatabase } = freshDb();
    const { newUsers } = initDatabase();
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(0);
    expect(newUsers).toHaveLength(0);
    resetDb();
  });

  test('ne touche à rien si la table users est non vide', () => {
    const { getDb, resetDb, initDatabase } = freshDb();
    initDatabase();
    getDb()
      .prepare(
        "INSERT INTO users (username, email, password, must_set_password, role) VALUES ('j.gabriel', 'a@b.c', 'x', 0, 'editor')"
      )
      .run();
    process.env.ADMIN_USERNAME = 'first.admin';
    process.env.ADMIN_EMAIL = 'first@test.com';
    const { newUsers } = initDatabase();
    const users = getDb().prepare('SELECT username, role FROM users').all();
    expect(users).toEqual([{ username: 'j.gabriel', role: 'editor' }]);
    expect(newUsers).toHaveLength(0);
    resetDb();
  });

  test('ajoute token_version aux bases existantes', () => {
    const { getDb, resetDb, initDatabase } = freshDb();
    getDb().exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL DEFAULT '', password TEXT, must_set_password INTEGER NOT NULL DEFAULT 1, welcome_email_sent INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login TEXT)"
    );
    getDb().prepare("INSERT INTO users (username) VALUES ('old')").run();
    initDatabase();
    expect(getDb().prepare("SELECT token_version AS t FROM users WHERE username = 'old'").get().t).toBe(0);
    resetDb();
  });
});
