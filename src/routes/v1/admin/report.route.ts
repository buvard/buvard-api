import { Router } from 'express';
import { validate } from '../../../middlewares/validate.js';
import {
  listReportsQuerySchema,
  reportIdParamSchema,
  resolveReportSchema,
} from '../../../zod/report.zod.js';
import {
  getAdminListReports,
  patchAdminResolveReport,
} from '../../../controllers/admin/report.controller.js';

// Chain admin deja appliquee par le parent (cf admin/index.ts).
export const adminReportRouter: Router = Router();

adminReportRouter.get('/', validate(listReportsQuerySchema, 'query'), getAdminListReports);
adminReportRouter.patch(
  '/:id',
  validate(reportIdParamSchema, 'params'),
  validate(resolveReportSchema),
  patchAdminResolveReport,
);
