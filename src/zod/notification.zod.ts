import { z } from 'zod';

const objectIdRegex = /^[a-f\d]{24}$/i;

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const notificationIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, { error: 'id invalide' }),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
