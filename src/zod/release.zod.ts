import { z } from 'zod';
import { APP_PLATFORMS } from '../models/AppRelease.js';

export const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/, 'Format SemVer attendu: X.Y.Z');

// Multer/form-data envoie tout en string — `z.coerce.boolean()` ferait `"false" -> true`.
// On gere explicitement 'true'/'1' vs 'false'/'0'.
const booleanFromForm = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  }
  return v;
}, z.boolean());

// Body du POST /admin/releases (multer gere le file separement)
export const createReleaseSchema = z
  .object({
    version: semverSchema,
    platform: z.enum(APP_PLATFORMS),
    notes: z.string().trim().max(1000).optional(),
    active: booleanFromForm.optional(),
  })
  .strict();

export const updateReleaseSchema = z
  .object({
    active: booleanFromForm.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ a mettre a jour' });

export const listReleasesQuerySchema = z
  .object({
    platform: z.enum(APP_PLATFORMS).optional(),
  })
  .strict();

export const latestUpdateQuerySchema = z
  .object({
    platform: z.enum(APP_PLATFORMS),
    // Permissif : l'app native peut envoyer une version non-SemVer (ex: "1.0", "builtin").
    // Normalisation côté service (non-SemVer → 0.0.0 → reçoit la dernière release).
    currentVersion: z.string().min(1),
  })
  .strict();

export const releaseIdParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'id invalide'),
});

export type CreateReleaseInput = z.infer<typeof createReleaseSchema>;
export type UpdateReleaseInput = z.infer<typeof updateReleaseSchema>;
export type ListReleasesQuery = z.infer<typeof listReleasesQuerySchema>;
export type LatestUpdateQuery = z.infer<typeof latestUpdateQuerySchema>;
