// Récupère le contenu de production et l'applique au template public/index.html.
const fs = require('fs');
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

module.exports = { applySnapshot };
