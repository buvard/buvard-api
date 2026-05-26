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
  .regex(/^[a-z0-9_.-]+$/, 'Caracteres autorises: a-z 0-9 _ . -');

const locationSchema = z
  .object({
    country: z.string().trim().toUpperCase().length(2).optional(),
    city: z.string().trim().max(80).optional(),
  })
  .strict();

const MIN_AGE = 18;
const CURRENT_YEAR = new Date().getFullYear();

export const updateMeSchema = z
  .object({
    username: usernameSchema.optional(),
    displayName: z.string().trim().max(60).optional(),
    bio: z.string().trim().max(280).optional(),
    avatarUrl: z.string().url().optional(),
    coverUrl: z.string().url().optional(),
    location: locationSchema.optional(),
    birthYear: z.number().int().min(1900).max(CURRENT_YEAR - MIN_AGE).optional(),
    favoriteCategories: z.array(z.enum(TASTING_TYPES)).max(TASTING_TYPES.length).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ a mettre a jour' });

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
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ a mettre a jour' });

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

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type UpdatePrefsInput = z.infer<typeof updatePrefsSchema>;
export type ListFollowsQuery = z.infer<typeof listFollowsQuerySchema>;
export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;
export type MentionsQuery = z.infer<typeof mentionsQuerySchema>;
