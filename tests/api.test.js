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
const RENDERED_FILE = path.join(os.tmpdir(), `avcoach-test-${process.pid}-rendered.html`);
process.env.RENDERED_HTML_PATH = RENDERED_FILE;
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
  for (const f of [INDEX_HTML_FILE, RENDERED_FILE]) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────────
let tmpPassword;

describe('POST /api/login', () => {
  test('retourne un token pour un compte valide', async () => {
    const res = await request(server).post('/api/login').send({ username: 'test.admin', password: 'Admin1234!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  test('rejette un identifiant inconnu', async () => {
    const res = await request(server).post('/api/login').send({ username: 'nobody', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Identifiant ou mot de passe incorrect');
  });

  test('rejette un mauvais mot de passe', async () => {
    const res = await request(server).post('/api/login').send({ username: 'test.admin', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Identifiant ou mot de passe incorrect');
  });

  test('retourne firstLogin pour un mot de passe temporaire valide', async () => {
    const { getDb } = require('../database/db');
    const crypto = require('crypto');
    const tmp = (tmpPassword = crypto.randomBytes(6).toString('base64url'));
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
  test('rejette sans mot de passe temporaire', async () => {
    const res = await request(server)
      .post('/api/set-password')
      .send({ username: 'tmp.user', newPassword: 'NouveauMdp123!' });
    expect(res.status).toBe(400);
  });

  test('rejette un mauvais mot de passe temporaire', async () => {
    const res = await request(server)
      .post('/api/set-password')
      .send({ username: 'tmp.user', tempPassword: 'faux-temp', newPassword: 'NouveauMdp123!' });
    expect(res.status).toBe(401);
  });

  test('rejette un mot de passe trop court', async () => {
    const res = await request(server)
      .post('/api/set-password')
      .send({ username: 'tmp.user', tempPassword: tmpPassword, newPassword: 'abc' });
    expect(res.status).toBe(400);
  });

  test('définit le mot de passe définitif et retourne un token', async () => {
    const res = await request(server)
      .post('/api/set-password')
      .send({ username: 'tmp.user', tempPassword: tmpPassword, newPassword: 'NouveauMdp123!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  test('rejette un second appel une fois le mot de passe défini', async () => {
    const res = await request(server)
      .post('/api/set-password')
      .send({ username: 'tmp.user', tempPassword: tmpPassword, newPassword: 'AutreMdp123!' });
    expect(res.status).toBe(401);
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
  const snapshot = { el_title: 'Test', el_body: 'Hello world' };

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
      .send({ snapshot: { ...snapshot, el_version: 'base' }, isBase: true });
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

describe('Page rendue et export', () => {
  const firstId = () =>
    fs.readFileSync(INDEX_HTML_FILE, 'utf8').match(/<[^>]*contenteditable[^>]*data-edit-id="([^"]+)"/)[1];

  test('POST /api/content ne modifie pas le template et met à jour la page rendue', async () => {
    const before = fs.readFileSync(INDEX_HTML_FILE);
    const res = await request(server)
      .post('/api/content')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ snapshot: { ['el_' + firstId()]: 'Texte client unique' } });
    expect(res.status).toBe(200);
    expect(fs.readFileSync(INDEX_HTML_FILE).equals(before)).toBe(true);
    expect(fs.readFileSync(RENDERED_FILE, 'utf8')).toContain('Texte client unique');
  });

  test.each(['/', '/index.html'])('GET %s sert la page rendue', async (url) => {
    const res = await request(server).get(url);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Texte client unique');
    expect(res.text).toMatch(/<!doctype html>/i);
    expect(res.text).toContain('contenteditable');
  });

  test('GET /api/content/export — refusé sans token', async () => {
    const res = await request(server).get('/api/content/export');
    expect(res.status).toBe(401);
  });

  test('GET /api/content/export — refusé pour un éditeur', async () => {
    const res = await request(server).get('/api/content/export').set('Authorization', `Bearer ${editorToken}`);
    expect(res.status).toBe(403);
  });

  test("GET /api/content/export — accessible à l'admin", async () => {
    const res = await request(server).get('/api/content/export').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="avcoach-contenu-\d{4}-\d{2}-\d{2}\.json"$/
    );
    expect(Array.isArray(res.body.saves)).toBe(true);
    expect(res.body.saves.length).toBeGreaterThan(0);
    expect(res.body.exported_at).toBeDefined();
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

// ── Validation du contenu ─────────────────────────────────────────────────────
describe('Validation du snapshot', () => {
  const post = (body) => request(server).post('/api/content').set('Authorization', `Bearer ${adminToken}`).send(body);

  test('rejette une clé hors format el_/img_', async () => {
    expect((await post({ snapshot: { title: 'x' } })).status).toBe(400);
  });

  test('rejette une valeur non chaîne', async () => {
    expect((await post({ snapshot: { el_title: 42 } })).status).toBe(400);
  });

  test('rejette un tableau', async () => {
    expect((await post({ snapshot: ['el_title'] })).status).toBe(400);
  });
});

// ── Contact : validation ──────────────────────────────────────────────────────
describe('POST /api/contact — validation', () => {
  test('rejette un email invalide', async () => {
    const res = await request(server).post('/api/contact').send({ name: 'Jean', email: 'pas-un-email', message: 'Yo' });
    expect(res.status).toBe(400);
  });

  test('rejette un message trop long', async () => {
    const res = await request(server)
      .post('/api/contact')
      .send({ name: 'Jean', email: 'jean@test.com', message: 'a'.repeat(5001) });
    expect(res.status).toBe(400);
  });

  test('rejette des champs non textuels', async () => {
    const res = await request(server)
      .post('/api/contact')
      .send({ name: { a: 1 }, email: 'jean@test.com', message: 'x' });
    expect(res.status).toBe(400);
  });
});

// ── Identifiants numériques ───────────────────────────────────────────────────
describe('Identifiants de route', () => {
  test('DELETE /api/users/abc — 400', async () => {
    const res = await request(server).delete('/api/users/abc').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  test('POST /api/users/abc/reset-password — 400', async () => {
    const res = await request(server)
      .post('/api/users/abc/reset-password')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  test('PUT /api/users/abc/password — 400', async () => {
    const res = await request(server)
      .put('/api/users/abc/password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'Motdepasse123' });
    expect(res.status).toBe(400);
  });

  test('PATCH /api/messages/abc/read — 400', async () => {
    const res = await request(server).patch('/api/messages/abc/read').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  test('DELETE /api/messages/1abc — 400', async () => {
    const res = await request(server).delete('/api/messages/1abc').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});

// ── Révocation des tokens ─────────────────────────────────────────────────────
describe('Révocation des tokens', () => {
  async function createUser(name, role = 'editor') {
    const { getDb } = require('../database/db');
    const hash = bcrypt.hashSync('Motdepasse1!', 1);
    const id = getDb()
      .prepare(
        'INSERT INTO users (username, email, password, must_set_password, welcome_email_sent, role) VALUES (?, ?, ?, 0, 1, ?)'
      )
      .run(name, `${name}@test.com`, hash, role).lastInsertRowid;
    const res = await request(server).post('/api/login').send({ username: name, password: 'Motdepasse1!' });
    return { id, token: res.body.token };
  }
  const verify = (token) => request(server).get('/api/verify').set('Authorization', `Bearer ${token}`);

  test('token rejeté après déconnexion', async () => {
    const { token } = await createUser('rev.logout');
    expect((await verify(token)).status).toBe(200);
    await request(server).post('/api/logout').set('Authorization', `Bearer ${token}`);
    expect((await verify(token)).status).toBe(401);
  });

  test('ancien token rejeté après changement de mot de passe, nouveau token fourni', async () => {
    const { id, token } = await createUser('rev.pwd');
    const res = await request(server)
      .put(`/api/users/${id}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'NouveauMdp456!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect((await verify(token)).status).toBe(401);
    expect((await verify(res.body.token)).status).toBe(200);
  });

  test('ancien token rejeté après reset admin', async () => {
    const { id, token } = await createUser('rev.reset');
    const res = await request(server)
      .post(`/api/users/${id}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect((await verify(token)).status).toBe(401);
  });

  test("token d'un utilisateur supprimé rejeté", async () => {
    const { id, token } = await createUser('rev.delete');
    const res = await request(server).delete(`/api/users/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect((await verify(token)).status).toBe(401);
  });
});

// ── Création d'utilisateur : email ────────────────────────────────────────────
describe('POST /api/users — échec email', () => {
  test('conserve le compte et retourne un avertissement', async () => {
    const nodemailer = require('nodemailer');
    const spy = jest.spyOn(nodemailer, 'createTransport').mockReturnValueOnce({
      sendMail: jest.fn().mockRejectedValue(new Error('smtp down'))
    });
    const res = await request(server)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'mail.fail', email: 'fail@test.com', role: 'editor' });
    spy.mockRestore();
    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.warning).toBeDefined();
    const list = await request(server).get('/api/users').set('Authorization', `Bearer ${adminToken}`);
    expect(list.body.some((u) => u.username === 'mail.fail')).toBe(true);
  });

  test('marque welcome_email_sent après un envoi réussi', async () => {
    const res = await request(server)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'mail.ok', email: 'ok@test.com', role: 'editor' });
    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(true);
    const { getDb } = require('../database/db');
    expect(getDb().prepare('SELECT welcome_email_sent AS w FROM users WHERE username = ?').get('mail.ok').w).toBe(1);
  });
});

// ── Suivi des visites ─────────────────────────────────────────────────────────
describe('POST /api/track — IP hachée', () => {
  test("ne stocke pas l'IP brute", async () => {
    await request(server).post('/api/track').set('X-Forwarded-For', '203.0.113.7');
    const { getDb } = require('../database/db');
    const rows = getDb().prepare('SELECT ip FROM visitor_ips').all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.ip))).toBe(true);
  });
});

// ── Limitation de débit ───────────────────────────────────────────────────────
describe('Rate limiting', () => {
  beforeAll(() => {
    process.env.ENABLE_RATE_LIMIT = 'true';
  });
  afterAll(() => {
    delete process.env.ENABLE_RATE_LIMIT;
  });

  test('le 11e échec de login depuis la même IP retourne 429', async () => {
    const attempt = () =>
      request(server).post('/api/login').set('X-Forwarded-For', '198.51.100.1').send({ username: 'x', password: 'y' });
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });

  test('le 6e message de contact depuis la même IP retourne 429', async () => {
    const send = () =>
      request(server)
        .post('/api/contact')
        .set('X-Forwarded-For', '198.51.100.2')
        .send({ name: 'Jean', email: 'jean@test.com', message: 'Bonjour' });
    for (let i = 0; i < 5; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });
});

describe('GET /sitemap.xml', () => {
  afterEach(() => delete process.env.SITE_URL);

  test('utilise SITE_URL quand il est défini', async () => {
    process.env.SITE_URL = 'https://exemple.fr/';
    const res = await request(server).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<loc>https://exemple.fr/</loc>');
  });

  test('sans SITE_URL : domaine de la requête', async () => {
    const res = await request(server).get('/sitemap.xml').set('Host', 'site.test');
    expect(res.text).toContain('<loc>http://site.test/</loc>');
  });
});

describe('GET /robots.txt', () => {
  afterEach(() => delete process.env.SITE_URL);

  test("autorise l'indexation, exclut l'admin et l'API, pointe vers le sitemap", async () => {
    process.env.SITE_URL = 'https://exemple.fr';
    const res = await request(server).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Allow: /');
    expect(res.text).toContain('Disallow: /admin.html');
    expect(res.text).toContain('Disallow: /api/');
    expect(res.text).toContain('Sitemap: https://exemple.fr/sitemap.xml');
  });
});
