#!/usr/bin/env node
/**
 * Build script: génère docs/ depuis public/ pour GitHub Pages.
 * Supprime les éléments d'authentification et adapte les chemins.
 * Usage: node build.js
 */

const fs   = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, 'public');
const DEST = path.join(__dirname, 'docs');

// ── Copie récursive d'un dossier ──────────────────────────────────────────────
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ── Transformations HTML ───────────────────────────────────────────────────────
function transformHtml(html) {
  // Chemins absolus → relatifs
  html = html.replace(/href="\/css\//g, 'href="css/');
  html = html.replace(/src="\/js\//g,  'src="js/');
  html = html.replace(/src="\/images\//g, 'src="images/');

  // Supprime le bloc login-overlay
  html = html.replace(/<!-- LOGIN MODAL -->[\s\S]*?<\/div>\n<\/div>\n/m, '');

  // Supprime le bloc edit-bar
  html = html.replace(/<!-- EDIT BAR -->[\s\S]*?<\/div>\n/m, '');

  // Supprime le bouton Connexion dans la nav
  html = html.replace(/\s*<button class="nav-edit-btn"[^>]*>.*?<\/button>\n/g, '');

  // Supprime les attributs contenteditable
  html = html.replace(/ contenteditable="false"/g, '');

  // Supprime les handlers replaceImage et la classe img-wrap sur les conteneurs
  html = html.replace(/ onclick="replaceImage\(this\)"/g, '');
  html = html.replace(/ title="Cliquer pour changer l'image"/g, '');

  // Supprime l'input file caché
  html = html.replace(/\n<input type="file" id="img-file-input"[^>]*>\n/, '\n');

  // Supprime les scripts auth et editor
  html = html.replace(/\n<script src="\/js\/auth\.js"><\/script>/, '');
  html = html.replace(/\n<script src="\/js\/editor\.js"><\/script>/, '');

  return html;
}

// ── JS main.js : supprime les fonctions liées à l'auth ───────────────────────
function transformMainJs(js) {
  // Remplace la référence à Editor.isActive() dans le smooth scroll
  js = js.replace(
    /const offset = Editor\.isActive\(\) \? 44 \+ 70 : 70;/,
    'const offset = 70;'
  );

  // Supprime les blocs : Login modal, toggleEdit, logout, Auto-restore
  const blocksToRemove = [
    /\/\/ ── Login modal[^─]*─+[\s\S]*?(?=\/\/ ──|$)/,
    /\/\/ ── Auto-restore session[^─]*─+[\s\S]*/,
  ];
  for (const pattern of blocksToRemove) {
    js = js.replace(pattern, '');
  }

  return js.trimEnd() + '\n';
}

// ── Main ──────────────────────────────────────────────────────────────────────
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

// CSS et images : copie directe
copyDir(path.join(SRC, 'css'),    path.join(DEST, 'css'));
copyDir(path.join(SRC, 'images'), path.join(DEST, 'images'));

// index.html : transformé
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
fs.writeFileSync(path.join(DEST, 'index.html'), transformHtml(html));

// main.js : transformé
fs.mkdirSync(path.join(DEST, 'js'), { recursive: true });
const mainJs = fs.readFileSync(path.join(SRC, 'js', 'main.js'), 'utf8');
fs.writeFileSync(path.join(DEST, 'js', 'main.js'), transformMainJs(mainJs));

console.log('✓ Build terminé → docs/');
