// Sauvegarde cohérente de la base SQLite et des images envoyées, avec rotation.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database', 'avcoach.sqlite');
const UPLOADS_PATH = process.env.UPLOADS_PATH || path.join(__dirname, '..', 'uploads');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(path.resolve(DATABASE_PATH)), 'backups');
const KEEP = Number(process.env.BACKUP_KEEP) || 14;

async function backup({
  dbPath = DATABASE_PATH,
  uploadsPath = UPLOADS_PATH,
  backupDir = BACKUP_DIR,
  keep = KEEP,
  now = new Date()
} = {}) {
  const dbDir = path.join(backupDir, 'db');
  fs.mkdirSync(dbDir, { recursive: true });

  // Copie faite par SQLite lui-même : cohérente même si le site écrit pendant la sauvegarde
  const stamp = now.toISOString().slice(0, 10);
  const target = path.join(dbDir, `${path.basename(dbPath, '.sqlite')}-${stamp}.sqlite`);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }

  // Rotation : on garde les `keep` copies les plus récentes
  const copies = fs
    .readdirSync(dbDir)
    .filter((f) => f.endsWith('.sqlite'))
    .sort();
  const removed = copies.slice(0, Math.max(0, copies.length - keep));
  removed.forEach((f) => fs.unlinkSync(path.join(dbDir, f)));

  // Images : noms uniques et immuables, on ne copie que les nouvelles
  let images = 0;
  if (fs.existsSync(uploadsPath)) {
    const mirror = path.join(backupDir, 'uploads');
    fs.mkdirSync(mirror, { recursive: true });
    for (const f of fs.readdirSync(uploadsPath)) {
      const dest = path.join(mirror, f);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(path.join(uploadsPath, f), dest);
        images++;
      }
    }
  }
  return { target, removed, images };
}

if (require.main === module) {
  backup()
    .then(({ target, removed, images }) => {
      console.log(`✓ Base sauvegardée : ${target}`);
      if (removed.length) console.log(`  ${removed.length} ancienne(s) copie(s) supprimée(s)`);
      console.log(`  ${images} nouvelle(s) image(s) copiée(s)`);
    })
    .catch((e) => {
      console.error(`✗ Sauvegarde impossible : ${e.message}`);
      process.exit(1);
    });
}

module.exports = { backup };
