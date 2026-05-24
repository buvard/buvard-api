import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9_.-]+$/, 'Caracteres autorises: a-z 0-9 _ . -');

export const updateMeSchema = z
  .object({
    username: usernameSchema.optional(),
    displayName: z.string().trim().max(60).optional(),
    bio: z.string().trim().max(280).optional(),
    avatarUrl: z.string().url().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ a mettre a jour' });

export const usernameParamSchema = z.object({ username: usernameSchema });

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
