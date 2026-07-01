#!/usr/bin/env node
/**
 * Génère static/ depuis public/ pour GitHub Pages (site statique sans auth).
 * Les blocs [DYNAMIC:START]…[DYNAMIC:END] dans index.html sont supprimés.
 * Usage: node build-static.js
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'public');
const DEST = path.join(__dirname, 'static');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function transformHtml(html) {
  // Supprime tous les blocs dynamiques
  html = html.replace(/[ \t]*<!-- \[DYNAMIC:START\][^>]*-->[\s\S]*?<!-- \[DYNAMIC:END\] -->\n?/gm, '');

  // Chemins absolus → relatifs (GitHub Pages)
  html = html.replace(/href="\/css\//g, 'href="css/');
  html = html.replace(/src="\/js\//g, 'src="js/');
  html = html.replace(/src="\/images\//g, 'src="images/');

  // Supprime les attributs d'édition
  html = html.replace(/ contenteditable="false"/g, '');
  html = html.replace(/ data-edit-id="[^"]*"/g, '');
  html = html.replace(/ onclick="replaceImage\(this\)"/g, '');
  html = html.replace(/ title="Cliquer pour changer l'image"/g, '');

  return html;
}

function transformMainJs(js) {
  // Sans l'éditeur, le décalage de scroll est fixe
  js = js.replace(/const offset = Editor\.isActive\(\) \? 44 \+ 70 : 70;/, 'const offset = 70;');

  // Supprime les blocs auth/edit (Login modal + helpers + Auto-restore)
  js = js.replace(/\/\/ ── Login modal[\s\S]*?(?=\/\/ ── Contact form)/, '');
  js = js.replace(/\/\/ ── Helpers boutons connexion[\s\S]*/, '');

  return js.trimEnd() + '\n';
}

// ── Main ──────────────────────────────────────────────────────────────────────
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

copyDir(path.join(SRC, 'css'), path.join(DEST, 'css'));
copyDir(path.join(SRC, 'images'), path.join(DEST, 'images'));

const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
fs.writeFileSync(path.join(DEST, 'index.html'), transformHtml(html));

fs.mkdirSync(path.join(DEST, 'js'), { recursive: true });
const mainJs = fs.readFileSync(path.join(SRC, 'js', 'main.js'), 'utf8');
fs.writeFileSync(path.join(DEST, 'js', 'main.js'), transformMainJs(mainJs));

console.log('✓ Build statique terminé → static/');
