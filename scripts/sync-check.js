// Vérifie, avant merge, qu'une PR n'écrase pas un texte modifié par la cliente en production.
const { execFileSync } = require('child_process');
const fs = require('fs');
const { readSnapshot, normalize, TEMPLATE_PATH } = require('../database/render');

const DEFAULT_SYNC_URL = 'https://ave-coach.fr';

// Compare template de base, template de la PR et contenu de production, champ par champ
function compareSnapshots(base, head, prod) {
  const conflicts = [];
  const outdated = [];
  for (const key of Object.keys(head)) {
    if (prod[key] === undefined || base[key] === undefined) continue;
    const p = normalize(prod[key]);
    const changedInPr = normalize(base[key]) !== normalize(head[key]);
    if (changedInPr && p !== normalize(base[key]) && p !== normalize(head[key])) conflicts.push(key);
    else if (!changedInPr && p !== normalize(head[key])) outdated.push(key);
  }
  return { conflicts, outdated };
}

async function main() {
  const baseRef = process.env.BASE_REF || 'origin/main';
  const url = (process.env.SYNC_URL || process.env.SITE_URL || DEFAULT_SYNC_URL).replace(/\/$/, '');
  const head = readSnapshot(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  const base = readSnapshot(
    execFileSync('git', ['show', `${baseRef}:public/index.html`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  );

  let prod;
  try {
    const res = await fetch(`${url}/api/content/latest`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    prod = (await res.json()).snapshot || {};
  } catch (e) {
    console.warn(`⚠ Production injoignable (${url}) : vérification ignorée — ${e.message}`);
    return;
  }

  const { conflicts, outdated } = compareSnapshots(base, head, prod);
  if (outdated.length) {
    console.warn(`⚠ ${outdated.length} champ(s) modifié(s) en production, non synchronisé(s) : ${outdated.join(', ')}`);
    console.warn('  Sans risque pour cette PR ; pensez à lancer npm run sync:pull.');
  }
  if (conflicts.length) {
    console.error(`✗ Cette PR modifie des champs que la cliente a changés en production : ${conflicts.join(', ')}`);
    console.error('  Lancez npm run sync:pull, refaites vos modifications sur ces champs, puis poussez à nouveau.');
    process.exit(1);
  }
  console.log('✓ Aucun conflit avec le contenu de production.');
}

if (require.main === module) main();

module.exports = { compareSnapshots };
