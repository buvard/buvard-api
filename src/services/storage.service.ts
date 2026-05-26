import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// Client S3 configure pour Cloudflare R2
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

export interface UploadResult {
  key: string;
  publicUrl: string;
}

// Upload un buffer dans R2 et renvoie la cle + l'URL publique
export async function uploadBuffer(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<UploadResult> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return {
    key,
    publicUrl: `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`,
  };
}

// Supprime un objet R2 — silencieux en cas d'erreur (best effort)
export async function deleteObject(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  } catch (err) {
    logger.warn({ err, key }, 'R2 delete failed (ignored)');
  }
}

// Extrait la cle R2 a partir d'une URL publique (sert pour supprimer l'ancien fichier)
// Retourne null si l'URL n'appartient pas a notre bucket public
export function extractKeyFromPublicUrl(publicUrl: string | undefined | null): string | null {
  if (!publicUrl) return null;
  const base = env.R2_PUBLIC_URL.replace(/\/$/, '');
  if (!publicUrl.startsWith(`${base}/`)) return null;
  return publicUrl.slice(base.length + 1);
}
