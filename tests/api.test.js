/**
 * Tests d'intégration API — base SQLite isolée, nodemailer mocké.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// ── Environnement de test (avant tout require) ────────────────────────────────
const DB_FILE = path.join(os.tmpdir(), `avcoach-test-${process.pid}.sqlite`);
process.env.DATABASE_PATH = DB_FILE;
const INDEX_HTML_FILE = path.join(os.tmpdir(), `avcoach-test-${process.pid}-index.html`);
fs.copyFileSync(path.join(__dirname, '..', 'public', 'index.html'), INDEX_HTML_FILE);
process.env.INDEX_HTML_PATH = INDEX_HTML_FILE;
process.env.JWT_SECRET = 'test-secret-key-ci';
process.env.JWT_EXPIRES_IN = '1h';
process.env.SMTP_HOST = 'localhost';
process.env.SMTP_PORT = '1025';
process.env.SMTP_SECURE = 'false';
process.env.SMTP_USER = 'test@test.com';
process.env.SMTP_PASS = 'test';
process.env.CONTACT_TO = 'test@test.com';

// ── Mock nodemailer (avant require du serveur) ────────────────────────────────
jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-id' })
  })
}));

const http = require('http');
const request = require('supertest');
const bcrypt = require('bcrypt');

const { resetDb } = require('../database/db');
let server, adminToken, editorToken;

// ── Setup global ──────────────────────────────────────────────────────────────
beforeAll(() => {
  // Charger le serveur — initDatabase() tourne ici
  const app = require('../server');
  server = http.createServer(app);

  // Créer des comptes de test avec mdp connu (bcryptRounds=1 pour la vitesse)
  const { getDb } = require('../database/db');
  const db = getDb();
  const adminHash = bcrypt.hashSync('Admin1234!', 1);
  const editorHash = bcrypt.hashSync('Editor1234!', 1);

  db.prepare(
    `
    INSERT OR REPLACE INTO users (username, email, password, must_set_password, welcome_email_sent, role)
    VALUES ('test.admin', 'admin@test.com', ?, 0, 1, 'admin')
  `
  ).run(adminHash);
  db.prepare(
    `
    INSERT OR REPLACE INTO users (username, email, password, must_set_password, welcome_email_sent, role)
    VALUES ('test.editor', 'editor@test.com', ?, 0, 1, 'editor')
  `
  ).run(editorHash);
});

beforeAll(async () => {
  // Obtenir les tokens après que les comptes soient créés
  const resA = await request(server).post('/api/login').send({ username: 'test.admin', password: 'Admin1234!' });
  const resE = await request(server).post('/api/login').send({ username: 'test.editor', password: 'Editor1234!' });
  adminToken = resA.body.token;
  editorToken = resE.body.token;
});

afterAll(() => {
  resetDb();
  for (const ext of ['', '-shm', '-wal']) {
    try {
      fs.unlinkSync(DB_FILE + ext);
    } catch {}
  }
  try {
    fs.unlinkSync(INDEX_HTML_FILE);
  } catch {}
});

// ── Auth ──────────────────────────────────────────────────────────────────────
describe('POST /api/login', () => {
  test('retourne un token pour un compte valide', async () => {
    const res = await request(server).post('/api/login').send({ username: 'test.admin', password: 'Admin1234!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  test('rejette un identifiant inconnu', async () => {
    const res = await request(server).post('/api/login').send({ username: 'nobody', password: 'x' });
    expect(res.status).toBe(401);
  });

  test('rejette un mauvais mot de passe', async () => {
    const res = await request(server).post('/api/login').send({ username: 'test.admin', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('retourne firstLogin pour un mot de passe temporaire valide', async () => {
    const { getDb } = require('../database/db');
    const crypto = require('crypto');
    const tmp = crypto.randomBytes(6).toString('base64url');
    const hash = bcrypt.hashSync(tmp, 1);
    getDb()
      .prepare(
        `
      INSERT INTO users (username, email, password, must_set_password, welcome_email_sent, role)
      VALUES ('tmp.user', 'tmp@test.com', ?, 1, 1, 'editor')
    `
      )
      .run(hash);
    const res = await request(server).post('/api/login').send({ username: 'tmp.user', password: tmp });
    expect(res.status).toBe(200);
    expect(res.body.firstLogin).toBe(true);
  });
});

describe('POST /api/set-password', () => {
  test('définit le mot de passe définitif et retourne un token', async () => {
    const res = await request(server)
      .post('/api/set-password')
      .send({ username: 'tmp.user', newPassword: 'NouveauMdp123!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  test('rejette un mot de passe trop court', async () => {
    const res = await request(server).post('/api/set-password').send({ username: 'tmp.user', newPassword: 'abc' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/verify', () => {
  test('valide un token correct', async () => {
    const res = await request(server).get('/api/verify').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  test('rejette un token invalide', async () => {
    const res = await request(server).get('/api/verify').set('Authorization', 'Bearer fake.token');
    expect(res.status).toBe(401);
  });

  test('rejette une requête sans token', async () => {
    const res = await request(server).get('/api/verify');
    expect(res.status).toBe(401);
  });
});

// ── Contenu ───────────────────────────────────────────────────────────────────
describe('Contenu', () => {
  const snapshot = { title: 'Test', body: 'Hello world' };

  test('POST /api/content — refusé sans token', async () => {
    const res = await request(server).post('/api/content').send({ snapshot });
    expect(res.status).toBe(401);
  });

  test('POST /api/content — sauvegarde un snapshot', async () => {
    const res = await request(server)
      .post('/api/content')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ snapshot });
    expect(res.status).toBe(200);
  });

  test('GET /api/content/latest — retourne le dernier snapshot', async () => {
    const res = await request(server).get('/api/content/latest');
    expect(res.status).toBe(200);
    expect(res.body.snapshot).toMatchObject(snapshot);
  });

  test('POST /api/content isBase=true — crée la V0', async () => {
    const res = await request(server)
      .post('/api/content')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ snapshot: { ...snapshot, version: 'base' }, isBase: true });
    expect(res.status).toBe(200);
  });

  test('GET /api/content/base — confirme que V0 existe', async () => {
    const res = await request(server).get('/api/content/base').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
  });

  test('GET /api/content/history/full — refusé pour un éditeur', async () => {
    const res = await request(server).get('/api/content/history/full').set('Authorization', `Bearer ${editorToken}`);
    expect(res.status).toBe(403);
  });

  test("GET /api/content/history/full — accessible à l'admin", async () => {
    const res = await request(server).get('/api/content/history/full').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── Utilisateurs ─────────────────────────────────────────────────────────────
describe('Utilisateurs', () => {
  let createdUserId;

  test('GET /api/users — admin obtient la liste', async () => {
    const res = await request(server).get('/api/users').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/users — refusé pour un éditeur', async () => {
    const res = await request(server).get('/api/users').set('Authorization', `Bearer ${editorToken}`);
    expect(res.status).toBe(403);
  });

  test('POST /api/users — crée un utilisateur et envoie un email', async () => {
    const res = await request(server)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'new.user', email: 'new@test.com', role: 'editor' });
    expect(res.status).toBe(201);
    expect(res.body.username).toBe('new.user');
    createdUserId = res.body.id;
  });

  test('POST /api/users — rejette un doublon', async () => {
    const res = await request(server)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'new.user', email: 'new@test.com', role: 'editor' });
    expect(res.status).toBe(409);
  });

  test('POST /api/users/:id/reset-password — réinitialise le mot de passe', async () => {
    const res = await request(server)
      .post(`/api/users/${createdUserId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('POST /api/users/:id/reset-password — refusé pour un éditeur', async () => {
    const res = await request(server)
      .post(`/api/users/${createdUserId}/reset-password`)
      .set('Authorization', `Bearer ${editorToken}`);
    expect(res.status).toBe(403);
  });
});

// ── Messages de contact ───────────────────────────────────────────────────────
describe('Messages de contact', () => {
  let messageId;

  test('POST /api/contact — enregistre un message', async () => {
    const res = await request(server).post('/api/contact').send({
      name: 'Jean Dupont',
      email: 'jean@test.com',
      message: 'Bonjour !'
    });
    expect(res.status).toBe(200);
  });

  test('GET /api/messages — admin obtient la liste', async () => {
    const res = await request(server).get('/api/messages').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    messageId = res.body[0].id;
  });

  test('GET /api/messages — refusé pour un éditeur', async () => {
    const res = await request(server).get('/api/messages').set('Authorization', `Bearer ${editorToken}`);
    expect(res.status).toBe(403);
  });

  test('PATCH /api/messages/:id/read — marque comme lu', async () => {
    const res = await request(server)
      .patch(`/api/messages/${messageId}/read`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('DELETE /api/messages/:id — supprime un message', async () => {
    const res = await request(server).delete(`/api/messages/${messageId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

// ── Statistiques ──────────────────────────────────────────────────────────────
describe('Statistiques', () => {
  test('POST /api/track — enregistre une visite', async () => {
    const res = await request(server).post('/api/track');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('GET /api/stats — admin obtient les stats', async () => {
    const res = await request(server).get('/api/stats').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(typeof res.body.totalUnique).toBe('number');
  });

  test('GET /api/stats — refusé pour un éditeur', async () => {
    const res = await request(server).get('/api/stats').set('Authorization', `Bearer ${editorToken}`);
    expect(res.status).toBe(403);
  });
});
