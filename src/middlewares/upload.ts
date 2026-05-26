import multer, { type Multer } from 'multer';
import { AppError } from '../utils/AppError.js';

// --- Images (avatar, cover, photo tasting) ---

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB brut avant resize

const ALLOWED_IMAGE_MIMETYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

// Multer en memoire — on streame directement vers sharp puis R2, jamais sur disque
export const imageUpload: Multer = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIMETYPES.has(file.mimetype)) {
      cb(AppError.badRequest(`Type de fichier non supporte: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

// --- Bundles OTA (Capgo .zip) ---

const MAX_BUNDLE_SIZE = 50 * 1024 * 1024; // 50 MB

const ALLOWED_BUNDLE_MIMETYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream', // certains clients ne sniffent pas le zip
]);

export const bundleUpload: Multer = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BUNDLE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_BUNDLE_MIMETYPES.has(file.mimetype)) {
      cb(AppError.badRequest(`Type de fichier non supporte: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});
