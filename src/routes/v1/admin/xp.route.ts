import { Router } from 'express';
import { validate } from '../../../middlewares/validate.js';
import {
  adminAdjustXpSchema,
  adminSetXpSchema,
  userIdParamSchema,
} from '../../../zod/user.zod.js';
import {
  deleteAdminResetXp,
  postAdminAdjustXp,
  putAdminSetXp,
} from '../../../controllers/admin/xp.controller.js';

// Toutes les routes sont deja sous le chain admin du router parent
// (requireUser + requireActive + requireRole('admin')) — pas besoin de
// le re-monter ici.
export const adminXpRouter: Router = Router({ mergeParams: true });

// Ajuste (delta peut etre positif ou negatif).
adminXpRouter.post(
  '/:id/xp',
  validate(userIdParamSchema, 'params'),
  validate(adminAdjustXpSchema),
  postAdminAdjustXp,
);

// Set absolu.
adminXpRouter.put(
  '/:id/xp',
  validate(userIdParamSchema, 'params'),
  validate(adminSetXpSchema),
  putAdminSetXp,
);

// Reset a 0 (raccourci semantique).
adminXpRouter.delete(
  '/:id/xp',
  validate(userIdParamSchema, 'params'),
  deleteAdminResetXp,
);
