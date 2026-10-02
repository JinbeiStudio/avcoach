const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const UPLOADS_DIR = process.env.UPLOADS_PATH || path.join(__dirname, '..', 'uploads');
const ACCEPTED_FORMATS = ['jpeg', 'png', 'webp'];
const MAX_SIDE = 1600;

class ImageError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Vérifie le contenu réel, redresse, réduit, convertit en WebP et retire les métadonnées (EXIF, GPS…)
async function processUpload(buffer) {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new ImageError(400, 'Image illisible');
  }
  if (!ACCEPTED_FORMATS.includes(meta.format)) throw new ImageError(415, 'Format accepté : JPEG, PNG ou WebP');

  const out = await sharp(buffer)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const name = `${crypto.randomBytes(12).toString('hex')}.webp`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), out);
  return `/uploads/${name}`;
}

module.exports = { processUpload, ImageError, UPLOADS_DIR, MAX_SIDE };
