import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError.js';
import { listReports, resolveReport } from '../../services/report.service.js';
import type { ListReportsQuery, ResolveReportInput } from '../../zod/report.zod.js';

// GET /v1/admin/reports?status=&page=&limit= — file de moderation paginee.
export async function getAdminListReports(req: Request, res: Response): Promise<void> {
  const result = await listReports(req.query as unknown as ListReportsQuery);
  res.json({
    data: result.data.map((r) => r.toJSON()),
    page: result.page,
    limit: result.limit,
    total: result.total,
    hasMore: result.hasMore,
  });
}

// PATCH /v1/admin/reports/:id { status, resolutionNote? } — resout un report.
export async function patchAdminResolveReport(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { id } = req.params as { id: string };
  const { status, resolutionNote } = req.body as ResolveReportInput;
  const report = await resolveReport(id, req.user, status, resolutionNote);
  res.json({ report: report.toJSON() });
}
