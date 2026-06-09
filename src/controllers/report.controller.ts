import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import { createReport } from '../services/report.service.js';
import { getUserByUsername } from '../services/user.service.js';
import type { CreateReportInput } from '../zod/report.zod.js';

// POST /v1/tastings/:id/report { reason, note? }
export async function postReportTasting(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { id } = req.params as { id: string };
  const { report, alreadyReported } = await createReport(
    req.user,
    'tasting',
    id,
    req.body as CreateReportInput,
  );
  res.status(alreadyReported ? 200 : 201).json({ report: report.toJSON(), alreadyReported });
}

// POST /v1/users/:username/report { reason, note? }
// Le param est un username (coherent avec les autres routes /:username) — on
// resout l'id avant de creer le signalement.
export async function postReportUser(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { username } = req.params as { username: string };
  const target = await getUserByUsername(username);
  const { report, alreadyReported } = await createReport(
    req.user,
    'user',
    String(target._id),
    req.body as CreateReportInput,
  );
  res.status(alreadyReported ? 200 : 201).json({ report: report.toJSON(), alreadyReported });
}
