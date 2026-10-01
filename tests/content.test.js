/**
 * Tests de syncTemplate / renderHtml / readSnapshot / sync-pull — base et fichiers temporaires.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

const TAG = `${process.pid}`;
const DB_FILE = path.join(os.tmpdir(), `avcoach-content-${TAG}.sqlite`);
const TEMPLATE = path.join(os.tmpdir(), `avcoach-content-${TAG}-template.html`);
const RENDERED = path.join(os.tmpdir(), `avcoach-content-${TAG}-rendered.html`);
process.env.DATABASE_PATH = DB_FILE;
process.env.INDEX_HTML_PATH = TEMPLATE;
process.env.RENDERED_HTML_PATH = RENDERED;

const { getDb, resetDb } = require('../database/db');
const { initDatabase } = require('../database/init');
const { getMeta } = require('../database/meta');
const { readSnapshot, renderHtml } = require('../database/render');
const { syncTemplate, renderSite, getLatestSnapshot } = require('../database/content');
const { applySnapshot } = require('../scripts/sync-pull');

function page({ a = 'A défaut', b = 'B défaut', c } = {}) {
  return `<!DOCTYPE html>
<html><body>
<h1 contenteditable="false" data-edit-id="a">${a}</h1>
<p contenteditable="false" data-edit-id="b">${b}</p>
${c === undefined ? '' : `<p contenteditable="false" data-edit-id="c">${c}</p>`}
<img data-edit-id="logo" src="/images/logo.png">
</body></html>`;
}
const setTemplate = (opts) => fs.writeFileSync(TEMPLATE, page(opts));
const saves = () => getDb().prepare('SELECT * FROM content_saves ORDER BY id').all();

function clientSave(delta) {
  const latest = getLatestSnapshot() || {};
  getDb()
    .prepare('INSERT INTO content_saves (saved_by, snapshot, is_base) VALUES (NULL, ?, 0)')
    .run(JSON.stringify({ ...latest, ...delta }));
}

beforeEach(() => {
  resetDb();
  for (const ext of ['', '-shm', '-wal']) fs.rmSync(DB_FILE + ext, { force: true });
  initDatabase();
  getDb().exec('DELETE FROM content_saves');
  setTemplate();
});

afterAll(() => {
  resetDb();
  for (const f of [DB_FILE + '', DB_FILE + '-shm', DB_FILE + '-wal', TEMPLATE, RENDERED]) fs.rmSync(f, { force: true });
});

describe('syncTemplate', () => {
  test('base vide : crée la V0 et enregistre les défauts', () => {
    syncTemplate();
    const rows = saves();
    expect(rows).toHaveLength(1);
    expect(rows[0].is_base).toBe(1);
    expect(rows[0].saved_by).toBeNull();
    expect(JSON.parse(rows[0].snapshot)).toEqual(readSnapshot(page()));
    expect(JSON.parse(getMeta('template_defaults'))).toEqual(readSnapshot(page()));
  });

  test('le développeur change A, le client change B : A = template, B = client', () => {
    syncTemplate();
    clientSave({ el_b: 'B client' });
    setTemplate({ a: 'A dev' });
    syncTemplate();
    const latest = getLatestSnapshot();
    expect(latest.el_a).toBe('A dev');
    expect(latest.el_b).toBe('B client');
    const last = saves().at(-1);
    expect(last.is_base).toBe(0);
    expect(last.saved_by).toBeNull();
  });

  test('conflit sur A : le développeur gagne, la version client reste dans l’historique', () => {
    syncTemplate();
    clientSave({ el_a: 'A client' });
    setTemplate({ a: 'A dev' });
    syncTemplate();
    expect(getLatestSnapshot().el_a).toBe('A dev');
    expect(saves().some((r) => JSON.parse(r.snapshot).el_a === 'A client')).toBe(true);
  });

  test('template inchangé : aucune nouvelle ligne', () => {
    syncTemplate();
    clientSave({ el_a: 'A client' });
    const count = saves().length;
    syncTemplate();
    expect(saves()).toHaveLength(count);
    expect(getLatestSnapshot().el_a).toBe('A client');
  });

  test('nouveau champ ajouté avec son défaut, champ retiré conservé', () => {
    syncTemplate();
    setTemplate({ c: 'C neuf' });
    syncTemplate();
    expect(getLatestSnapshot().el_c).toBe('C neuf');

    fs.writeFileSync(TEMPLATE, page().replace(/<p[^>]*data-edit-id="b">[^<]*<\/p>/, ''));
    syncTemplate();
    expect(getLatestSnapshot().el_b).toBe('B défaut');
    expect(() => renderSite()).not.toThrow();
  });

  test('migration (pas de défauts connus) : contenu client intact, défauts enregistrés', () => {
    getDb()
      .prepare('INSERT INTO content_saves (saved_by, snapshot, is_base) VALUES (NULL, ?, 1)')
      .run(JSON.stringify({ el_a: 'A client', el_b: 'B client' }));
    expect(getMeta('template_defaults')).toBeUndefined();
    setTemplate({ a: 'A dev', c: 'C neuf' });
    syncTemplate();
    const latest = getLatestSnapshot();
    expect(latest.el_a).toBe('A client');
    expect(latest.el_b).toBe('B client');
    expect(latest.el_c).toBe('C neuf');
    expect(getMeta('template_defaults')).toBeDefined();
  });

  test('renderSite écrit la page avec le contenu de la base', () => {
    syncTemplate();
    clientSave({ el_a: 'A client' });
    renderSite();
    expect(fs.readFileSync(RENDERED, 'utf8')).toContain('>A client</h1>');
  });
});

describe('renderHtml / readSnapshot', () => {
  test('aller-retour : readSnapshot(renderHtml(t, s)) = { ...readSnapshot(t), ...s }', () => {
    const t = page({ c: 'C' });
    const s = { el_a: 'Autre <b>texte</b>', img_logo: '/images/x".png' };
    expect(readSnapshot(renderHtml(t, s))).toEqual({ ...readSnapshot(t), ...s });
  });

  test('ignore les clés absentes du template', () => {
    expect(renderHtml(page(), { el_zzz: 'x' })).toBe(page());
  });
});

describe('sync-pull applySnapshot', () => {
  test('applique les champs connus et liste les modifiés', () => {
    const { html, changed } = applySnapshot(page(), { el_a: 'Nouveau', el_b: 'B défaut', el_zzz: 'x' });
    expect(html).toContain('>Nouveau</h1>');
    expect(changed).toEqual(['el_a']);
  });
});
