const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');

const TEMPLATE_PATH = process.env.INDEX_HTML_PATH || path.join(__dirname, '..', 'public', 'index.html');
const RENDERED_PATH = process.env.RENDERED_HTML_PATH || path.join(__dirname, '..', 'var', 'index.html');

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

// Transforme un HTML en snapshot { el_<id>: innerHTML, img_<id>: src } —
// l'inverse de renderHtml.
function readSnapshot(html) {
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

// Lien reconstruit depuis le texte affiché d'un <a data-href-from="mailto|tel|url"> :
// le CMS n'édite que le texte, le href suit.
function hrefFromText(kind, innerHtml) {
  const text = innerHtml
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (kind === 'mailto') return text.includes('@') ? `mailto:${text.replace(/\s/g, '')}` : null;
  if (kind === 'tel') {
    const digits = text.replace(/[^\d+]/g, '');
    if (digits.length < 6) return null;
    return `tel:${/^0\d{9}$/.test(digits) ? '+33' + digits.slice(1) : digits}`;
  }
  if (kind === 'url') return /^https?:\/\//i.test(text) ? text : `https://${text.replace(/^\/+/, '')}`;
  return null;
}

// Retourne le HTML où seul le contenu des éléments [contenteditable]
// (el_<data-edit-id>) et les src des <img> (img_<data-edit-id>) est remplacé
// par le snapshot, identifiés par un attribut stable plutôt que par position.
// Le reste du fichier (formatage, attributs…) n'est pas touché.
function renderHtml(html, snapshot) {
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
    const kind = getAttr(node, 'data-href-from')?.value;
    const hrefLoc = loc.attrs?.href;
    const href = kind && hrefFromText(kind, snapshot[key]);
    if (href && hrefLoc) {
      replacements.push({
        start: hrefLoc.startOffset,
        end: hrefLoc.endOffset,
        text: `href="${href.replace(/"/g, '&quot;')}"`
      });
    }
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

  return out;
}

function readTemplate() {
  return fs.readFileSync(TEMPLATE_PATH, 'utf8');
}

// Écriture atomique : fichier temporaire puis renommage.
function writeRendered(html) {
  fs.mkdirSync(path.dirname(RENDERED_PATH), { recursive: true });
  const tmp = RENDERED_PATH + '.tmp';
  fs.writeFileSync(tmp, html);
  fs.renameSync(tmp, RENDERED_PATH);
}

const SITE_URL_TOKEN = '__SITE_URL__';

// Remplace le jeton du domaine ; sans domaine défini, retire les lignes qui l'utilisent (balises canonical, og…)
function applySiteUrl(html, siteUrl) {
  if (siteUrl) return html.split(SITE_URL_TOKEN).join(siteUrl.replace(/\/$/, ''));
  return html.replace(new RegExp(`^.*${SITE_URL_TOKEN}.*\\n`, 'gm'), '');
}

module.exports = {
  readSnapshot,
  renderHtml,
  readTemplate,
  writeRendered,
  applySiteUrl,
  hrefFromText,
  SITE_URL_TOKEN,
  TEMPLATE_PATH,
  RENDERED_PATH
};
