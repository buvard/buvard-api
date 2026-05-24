import { z } from 'zod';
import { TASTING_TYPES, VISIBILITIES } from '../models/Tasting.js';

const objectIdRegex = /^[a-f\d]{24}$/i;

export const tastingIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, 'id invalide'),
});

const aromaSchema = z.string().trim().min(1).max(40);

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
    photoUrl: z.string().url().optional(),
    visibility: z.enum(VISIBILITIES).optional(),
  })
  .strict();

export const updateTastingSchema = createTastingSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ a mettre a jour' });

export const listTastingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(TASTING_TYPES).optional(),
});

export type CreateTastingInput = z.infer<typeof createTastingSchema>;
export type UpdateTastingInput = z.infer<typeof updateTastingSchema>;
export type ListTastingsQuery = z.infer<typeof listTastingsQuerySchema>;
