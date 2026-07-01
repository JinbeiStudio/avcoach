const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const parse5 = require('parse5');

const INDEX_PATH = process.env.INDEX_HTML_PATH || path.join(__dirname, '..', 'public', 'index.html');

// Parcourt l'arbre dans l'ordre du document (même ordre que
// querySelectorAll côté client), comme editor.js.
function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
}

function getAttr(node, name) {
  return (node.attrs || []).find((a) => a.name === name);
}

function parseIndexHtml(html) {
  const doc = parse5.parse(html, { sourceCodeLocationInfo: true });
  const editableEls = [];
  const imgEls = [];
  walk(doc, (node) => {
    if (!node.tagName) return;
    if (getAttr(node, 'contenteditable')) editableEls.push(node);
    if (node.tagName === 'img') imgEls.push(node);
  });
  return { editableEls, imgEls };
}

// Empreinte du fichier tel qu'il est actuellement sur disque — sert à
// détecter qu'un déploiement a remplacé index.html (push) depuis la
// dernière écriture connue du serveur.
function hashIndexHtml() {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  return crypto.createHash('sha256').update(html).digest('hex');
}

// Lit le contenu actuel de index.html et le transforme en snapshot
// { el_<id>: innerHTML, img_<id>: src } — l'inverse de renderIndexHtml.
// Utilisé pour capturer une nouvelle V0 quand un déploiement a pushé un
// nouveau index.html (nouvelle structure et/ou nouveau contenu de base).
function readIndexSnapshot() {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const { editableEls, imgEls } = parseIndexHtml(html);
  const snapshot = {};

  editableEls.forEach((node) => {
    const editId = getAttr(node, 'data-edit-id')?.value;
    const loc = node.sourceCodeLocation;
    if (!editId || !loc?.startTag || !loc?.endTag) return;
    snapshot['el_' + editId] = html.slice(loc.startTag.endOffset, loc.endTag.startOffset);
  });

  imgEls.forEach((node) => {
    const editId = getAttr(node, 'data-edit-id')?.value;
    const src = getAttr(node, 'src')?.value;
    if (!editId || !src) return;
    snapshot['img_' + editId] = src;
  });

  return snapshot;
}

// Réécrit index.html en remplaçant uniquement le contenu des éléments
// [contenteditable] (el_<data-edit-id>) et les src des <img> (img_<data-edit-id>),
// identifiés par un attribut stable plutôt que par position — pour rester
// valide même si la structure de la page change (ajout/suppression
// d'éléments) — sans toucher au reste du fichier (formatage, attributs…),
// pour ne produire que des diffs minimaux.
function renderIndexHtml(snapshot) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const { editableEls, imgEls } = parseIndexHtml(html);

  const replacements = [];

  editableEls.forEach((node) => {
    const editId = getAttr(node, 'data-edit-id')?.value;
    if (!editId) return;
    const key = 'el_' + editId;
    if (snapshot[key] === undefined) return;
    const loc = node.sourceCodeLocation;
    if (!loc?.startTag || !loc?.endTag) return;
    replacements.push({
      start: loc.startTag.endOffset,
      end: loc.endTag.startOffset,
      text: snapshot[key]
    });
  });

  imgEls.forEach((node) => {
    const editId = getAttr(node, 'data-edit-id')?.value;
    if (!editId) return;
    const key = 'img_' + editId;
    if (!snapshot[key]) return;
    const srcLoc = node.sourceCodeLocation?.attrs?.src;
    const srcAttr = getAttr(node, 'src');
    if (!srcLoc || !srcAttr) return;
    replacements.push({
      start: srcLoc.startOffset,
      end: srcLoc.endOffset,
      text: `src="${snapshot[key].replace(/"/g, '&quot;')}"`
    });
  });

  // Applique de la fin vers le début pour ne pas invalider les offsets.
  replacements.sort((a, b) => b.start - a.start);
  let out = html;
  for (const { start, end, text } of replacements) {
    out = out.slice(0, start) + text + out.slice(end);
  }

  fs.writeFileSync(INDEX_PATH, out);
}

module.exports = { renderIndexHtml, readIndexSnapshot, hashIndexHtml };
