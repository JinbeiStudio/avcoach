const fs = require('fs');
const { getDb } = require('./db');
const { getMeta, setMeta } = require('./meta');
const {
  readSnapshot,
  renderHtml,
  readTemplate,
  writeRendered,
  applySiteUrl,
  normalize,
  RENDERED_PATH
} = require('./render');

const KEEP_EDITS = 5;

// Garde V0 + les dernières éditions
function pruneSaves(db) {
  db.prepare(
    `
    DELETE FROM content_saves
    WHERE is_base = 0
    AND id NOT IN (
      SELECT id FROM content_saves WHERE is_base = 0 ORDER BY id DESC LIMIT ${KEEP_EDITS}
    )
  `
  ).run();
}

function getLatestSnapshot() {
  const row = getDb().prepare('SELECT snapshot FROM content_saves ORDER BY id DESC LIMIT 1').get();
  return row ? JSON.parse(row.snapshot) : null;
}

// Génère la page servie : template + dernier snapshot
function renderSite() {
  writeRendered(applySiteUrl(renderHtml(readTemplate(), getLatestSnapshot() || {}), process.env.SITE_URL));
}

function renderSiteIfMissing() {
  if (!fs.existsSync(RENDERED_PATH)) renderSite();
}

// Au démarrage : réconcilie le template (git) avec le contenu en base.
// Par champ, la dernière modification gagne : si le développeur a changé le
// défaut d'un champ depuis le dernier déploiement, sa version l'emporte.
function syncTemplate() {
  const db = getDb();
  const current = readSnapshot(readTemplate());
  const latest = getLatestSnapshot();

  db.transaction(() => {
    if (!latest) {
      db.prepare('INSERT INTO content_saves (saved_by, snapshot, is_base) VALUES (NULL, ?, 1)').run(
        JSON.stringify(current)
      );
      setMeta('template_defaults', JSON.stringify(current));
      return;
    }

    const storedDefaults = getMeta('template_defaults');
    const previous = storedDefaults ? JSON.parse(storedDefaults) : null;
    const next = { ...latest };
    for (const [key, value] of Object.entries(current)) {
      // Migration (pas de défauts connus) : on ne complète que les clés absentes
      const changed = previous ? normalize(previous[key]) !== normalize(value) : next[key] === undefined;
      if (changed) next[key] = value;
    }

    if (JSON.stringify(next) !== JSON.stringify(latest)) {
      db.prepare('INSERT INTO content_saves (saved_by, snapshot, is_base) VALUES (NULL, ?, 0)').run(
        JSON.stringify(next)
      );
      pruneSaves(db);
    }
    setMeta('template_defaults', JSON.stringify(current));
  })();
}

module.exports = { getLatestSnapshot, renderSite, renderSiteIfMissing, syncTemplate, pruneSaves };
