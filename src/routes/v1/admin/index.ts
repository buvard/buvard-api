import { Router } from 'express';
import { requireUser } from '../../../middlewares/auth.js';
import { requireActive } from '../../../middlewares/requireActive.js';
import { requireRole } from '../../../middlewares/requireRole.js';
import { adminCodeRouter } from './code.route.js';
import { adminReleaseRouter } from './release.route.js';
import { adminReportRouter } from './report.route.js';
import { adminXpRouter } from './xp.route.js';

export const adminRouter: Router = Router();

// Toutes les routes admin necessitent: session valide + compte actif + role admin
adminRouter.use(requireUser, requireActive, requireRole('admin'));

adminRouter.use('/releases', adminReleaseRouter);
adminRouter.use('/users', adminXpRouter);
adminRouter.use('/codes', adminCodeRouter);
adminRouter.use('/reports', adminReportRouter);
