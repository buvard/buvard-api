import { z } from 'zod';
import { REPORT_REASONS, REPORT_STATUSES } from '../models/Report.js';

const objectIdRegex = /^[a-f\d]{24}$/i;

// Body commun aux deux endpoints de signalement (tasting / user). La cible
// (targetType + targetId) est deduite de la route, pas du body, pour eviter
// qu'un client signale un type/id arbitraire.
export const createReportSchema = z
  .object({
    reason: z.enum(REPORT_REASONS),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

// Param :id d'un tasting (route POST /tastings/:id/report).
export const reportTastingParamSchema = z.object({
  id: z.string().regex(objectIdRegex, { error: 'id invalide' }),
});

export const reportIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, { error: 'id invalide' }),
});

// File admin : filtre optionnel par statut + pagination.
export const listReportsQuerySchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// PATCH /admin/reports/:id { status, resolutionNote? }
// Le statut 'pending' n'est pas un resultat de moderation : on ne l'autorise
// pas en entree (un report nait deja pending).
export const RESOLVABLE_STATUSES = ['reviewed', 'actioned', 'dismissed'] as const;

export const resolveReportSchema = z
  .object({
    status: z.enum(RESOLVABLE_STATUSES),
    resolutionNote: z.string().trim().max(500).optional(),
  })
  .strict();

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;
