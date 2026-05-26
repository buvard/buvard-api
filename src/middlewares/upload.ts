import multer, { type Multer } from 'multer';
import { AppError } from '../utils/AppError.js';

// Limite generale: 10 MB brut avant resize. Sharp gerera la taille finale.
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_MIMETYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

// Multer en memoire — on streame directement vers sharp puis R2, jamais sur disque
export const imageUpload: Multer = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      cb(AppError.badRequest(`Type de fichier non supporte: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});
