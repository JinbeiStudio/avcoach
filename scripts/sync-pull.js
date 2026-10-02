// Récupère le contenu de production et l'applique au template public/index.html.
const fs = require('fs');
const path = require('path');
const { readSnapshot, renderHtml, TEMPLATE_PATH } = require('../database/render');

const DEFAULT_SYNC_URL = 'https://ave-coach.fr';

// Applique le snapshot au HTML et liste les champs réellement modifiés
function applySnapshot(html, snapshot) {
  const before = readSnapshot(html);
  const out = renderHtml(html, snapshot);
  const after = readSnapshot(out);
  const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
  return { html: out, changed };
}

const IMAGES_DIR = path.join(path.dirname(TEMPLATE_PATH), 'images');

// Télécharge dans public/images/ les images envoyées en production et réécrit leur adresse
async function localizeUploads(snapshot, download, imagesDir = IMAGES_DIR) {
  const out = { ...snapshot };
  const fetched = [];
  for (const [key, value] of Object.entries(snapshot)) {
    const m = key.startsWith('img_') && typeof value === 'string' && value.match(/^\/uploads\/([\w-]+\.webp)$/);
    if (!m) continue;
    const file = path.join(imagesDir, m[1]);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, await download(value));
      fetched.push(m[1]);
    }
    out[key] = `/images/${m[1]}`;
  }
  return { snapshot: out, fetched };
}

async function main() {
  // Site de production par défaut ; SYNC_URL (ou SITE_URL) permet de cibler un autre serveur
  const url = process.env.SYNC_URL || process.env.SITE_URL || DEFAULT_SYNC_URL;
  const base = url.replace(/\/$/, '');
  let snapshot;
  try {
    const res = await fetch(`${base}/api/content/latest`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    snapshot = (await res.json()).snapshot;
  } catch (e) {
    console.error(`✗ Impossible de récupérer le contenu depuis ${base} : ${e.message}`);
    process.exit(1);
  }
  if (!snapshot) {
    console.error('✗ Aucun contenu sauvegardé côté serveur.');
    process.exit(1);
  }

  const local = await localizeUploads(snapshot, async (url) => {
    const res = await fetch(`${base}${url}`);
    if (!res.ok) throw new Error(`Image ${url} : HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
  if (local.fetched.length)
    console.log(`${local.fetched.length} image(s) rapatriée(s) dans public/images : ${local.fetched.join(', ')}`);
  snapshot = local.snapshot;

  const html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const result = applySnapshot(html, snapshot);
  if (result.html === html) {
    console.log('Template déjà à jour, aucun champ modifié.');
    return;
  }
  fs.writeFileSync(TEMPLATE_PATH, result.html);
  console.log(`${result.changed.length} champ(s) mis à jour : ${result.changed.join(', ')}`);
}

if (require.main === module) main();

module.exports = { applySnapshot, localizeUploads };
