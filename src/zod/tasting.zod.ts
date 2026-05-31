import { z } from 'zod';
import { TASTING_TYPES, VISIBILITIES } from '../models/Tasting.js';

const objectIdRegex = /^[a-f\d]{24}$/i;

export const tastingIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, { error: 'id invalide' }),
});

const aromaSchema = z.string().trim().min(1).max(40);

// Sous-schema lieu : nom obligatoire, geo/placeId optionnels (mais quasi
// toujours renseignes quand selection via Google Places autocomplete cote front).
const placeSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    placeId: z.string().trim().max(200).optional(),
  })
  .strict();

export const createTastingSchema = z
  .object({
    type: z.enum(TASTING_TYPES),
    name: z.string().trim().min(1).max(120),
    producer: z.string().trim().max(120).optional(),
    year: z.number().int().min(1700).max(new Date().getFullYear() + 1).optional(),
    price: z.number().min(0).max(1_000_000).optional(),
    currency: z.string().trim().toUpperCase().length(3).optional(),
    rating: z.number().min(0.5).max(5).multipleOf(0.5),
    aromas: z.array(aromaSchema).max(20).optional(),
    notes: z.string().trim().max(2000).optional(),
    place: placeSchema.optional(),
    visibility: z.enum(VISIBILITIES).optional(),
  })
  .strict();

export const updateTastingSchema = createTastingSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Aucun champ a mettre a jour' });

// Reordonne les photos d'un tasting via une permutation des indices actuels.
// Ex: photoUrls actuel = [A, B, C] et order = [2, 0, 1] -> [C, A, B]
// La permutation doit etre une bijection sur [0..n-1] et de meme longueur que
// photoUrls (verifie cote service, on ne connait pas n dans le zod).
export const reorderPhotosSchema = z.object({
  order: z.array(z.number().int().min(0).max(99)).min(1).max(99),
});

export const listTastingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(TASTING_TYPES).optional(),
});

export type CreateTastingInput = z.infer<typeof createTastingSchema>;
export type UpdateTastingInput = z.infer<typeof updateTastingSchema>;
export type ListTastingsQuery = z.infer<typeof listTastingsQuerySchema>;
export type ReorderPhotosInput = z.infer<typeof reorderPhotosSchema>;
