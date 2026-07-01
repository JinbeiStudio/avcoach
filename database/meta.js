const { getDb } = require('./db');

function getMeta(key) {
  return getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key)?.value;
}

function setMeta(key, value) {
  getDb()
    .prepare(
      `
    INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `
    )
    .run(key, value);
}

module.exports = { getMeta, setMeta };
