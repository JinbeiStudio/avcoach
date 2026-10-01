/**
 * Tests de sendWelcomeEmails() — repli sur les logs si l'email échoue.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

const DB_FILE = path.join(os.tmpdir(), `avcoach-mail-${process.pid}.sqlite`);
process.env.DATABASE_PATH = DB_FILE;

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: mockSendMail }) }));

const { getDb, resetDb } = require('../database/db');
const { sendWelcomeEmails } = require('../lib/mail');

const newUser = { username: 'first.admin', email: 'first@test.com', tempPassword: 'Tmp-Pass-123' };

beforeAll(() => {
  getDb().exec(
    "CREATE TABLE users (username TEXT, welcome_email_sent INTEGER DEFAULT 0); INSERT INTO users (username) VALUES ('first.admin');"
  );
});

beforeEach(() => {
  mockSendMail.mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  resetDb();
  for (const ext of ['', '-shm', '-wal']) {
    try {
      fs.unlinkSync(DB_FILE + ext);
    } catch {}
  }
});

test("journalise le mot de passe temporaire si l'email échoue", async () => {
  mockSendMail.mockRejectedValue(new Error('SMTP indisponible'));
  await sendWelcomeEmails([newUser]);
  const warned = console.warn.mock.calls.flat().join(' ');
  expect(warned).toContain('first.admin');
  expect(warned).toContain('Tmp-Pass-123');
  expect(getDb().prepare('SELECT welcome_email_sent FROM users').get().welcome_email_sent).toBe(0);
});

test("ne journalise pas le mot de passe si l'email part", async () => {
  mockSendMail.mockResolvedValue({ messageId: 'ok' });
  await sendWelcomeEmails([newUser]);
  const logged = [...console.log.mock.calls, ...console.warn.mock.calls].flat().join(' ');
  expect(logged).not.toContain('Tmp-Pass-123');
  expect(getDb().prepare('SELECT welcome_email_sent FROM users').get().welcome_email_sent).toBe(1);
});
