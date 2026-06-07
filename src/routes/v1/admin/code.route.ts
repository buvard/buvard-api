import { Router } from 'express';
import { validate } from '../../../middlewares/validate.js';
import { codeIdParamSchema, createCodeSchema } from '../../../zod/user.zod.js';
import {
  deleteAdminCode,
  getAdminListCodes,
  postAdminCreateCode,
} from '../../../controllers/admin/code.controller.js';

// Chain admin deja appliquee par le parent (cf admin/index.ts).
export const adminCodeRouter: Router = Router();

adminCodeRouter.get('/', getAdminListCodes);
adminCodeRouter.post('/', validate(createCodeSchema), postAdminCreateCode);
adminCodeRouter.delete('/:id', validate(codeIdParamSchema, 'params'), deleteAdminCode);
