import { z } from 'zod';
import {
  CURRENCIES,
  LANGUAGES,
  THEMES,
  UNITS,
} from '../models/User.js';
import { TASTING_TYPES } from '../models/Tasting.js';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9_.-]+$/, { error: 'Caracteres autorises: a-z 0-9 _ . -' });

const locationSchema = z
  .object({
    country: z.string().trim().toUpperCase().length(2).optional(),
    city: z.string().trim().max(80).optional(),
  })
  .strict();

const MIN_AGE = 18;
const CURRENT_YEAR = new Date().getFullYear();

// avatarUrl et coverUrl sont gerees via des endpoints dedies (POST/DELETE
// /me/avatar et /me/cover, qui uploadent en R2). On les retire du PATCH /me
// pour eviter qu'un client puisse setter une URL arbitraire sans passer par
// l'upload signe.
export const updateMeSchema = z
  .object({
    username: usernameSchema.optional(),
    displayName: z.string().trim().max(60).optional(),
    bio: z.string().trim().max(280).optional(),
    location: locationSchema.optional(),
    birthYear: z.number().int().min(1900).max(CURRENT_YEAR - MIN_AGE).optional(),
    favoriteCategories: z.array(z.enum(TASTING_TYPES)).max(TASTING_TYPES.length).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Aucun champ a mettre a jour' });

const notificationsPrefsSchema = z
  .object({
    push: z.boolean().optional(),
    email: z.boolean().optional(),
    friendActivity: z.boolean().optional(),
    newFollower: z.boolean().optional(),
    tastingLiked: z.boolean().optional(),
    tastingCommented: z.boolean().optional(),
  })
  .strict();

const privacyPrefsSchema = z
  .object({
    profilePublic: z.boolean().optional(),
    showRatings: z.boolean().optional(),
    searchable: z.boolean().optional(),
    showLocation: z.boolean().optional(),
  })
  .strict();

export const updatePrefsSchema = z
  .object({
    theme: z.enum(THEMES).optional(),
    language: z.enum(LANGUAGES).optional(),
    units: z.enum(UNITS).optional(),
    currency: z.enum(CURRENCIES).optional(),
    notifications: notificationsPrefsSchema.optional(),
    privacy: privacyPrefsSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Aucun champ a mettre a jour' });

export const usernameParamSchema = z.object({ username: usernameSchema });

export const listFollowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const searchUsersQuerySchema = z.object({
  q: z.string().trim().min(2).max(32),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const mentionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// --- Admin XP + grade ---

const objectIdRegex = /^[a-f\d]{24}$/i;
export const userIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, { error: 'id invalide' }),
});

// POST /admin/users/:id/xp { delta }
// Delta peut etre negatif (revoke) ou positif (grant). 0 est rejete pour
// eviter les requetes inutiles. Borne large pour eviter les abus de batch.
export const adminAdjustXpSchema = z.object({
  delta: z
    .number()
    .int()
    .refine((v) => v !== 0, { error: 'delta doit etre non nul' })
    .min(-1_000_000)
    .max(1_000_000),
});

// PUT /admin/users/:id/xp { xp }
// Set absolu. 0 minimum, max large pour pas brider les tests admin.
export const adminSetXpSchema = z.object({
  xp: z.number().int().min(0).max(10_000_000),
});

// PATCH /v1/users/me/grade { key }
// key === null reset a l'affichage auto (grade derive du level).
export const setDisplayGradeSchema = z.object({
  key: z.string().min(1).max(50).nullable(),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type UpdatePrefsInput = z.infer<typeof updatePrefsSchema>;
export type ListFollowsQuery = z.infer<typeof listFollowsQuerySchema>;
export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;
export type MentionsQuery = z.infer<typeof mentionsQuerySchema>;
export type AdminAdjustXpInput = z.infer<typeof adminAdjustXpSchema>;
export type AdminSetXpInput = z.infer<typeof adminSetXpSchema>;
export type SetDisplayGradeInput = z.infer<typeof setDisplayGradeSchema>;

// --- Redemption codes ---

export const redeemCodeSchema = z.object({
  code: z.string().min(1).max(64),
});

// Mirror back/RedemptionCode.ts. Un seul type pour l'instant.
const REDEMPTION_TYPES = ['pochtron'] as const;

export const createCodeSchema = z.object({
  // Optionnel : si non fourni, le back genere un code random
  code: z.string().min(3).max(64).optional(),
  type: z.enum(REDEMPTION_TYPES),
  // null ou nombre. null = illimite.
  maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
  // ISO date string ou null
  expiresAt: z.iso.datetime().nullable().default(null),
});

export const codeIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, { error: 'id invalide' }),
});

export type RedeemCodeInput = z.infer<typeof redeemCodeSchema>;
export type CreateCodeInput = z.infer<typeof createCodeSchema>;
