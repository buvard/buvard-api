import { Router } from 'express';
import { requireUser } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { updateMeSchema, usernameParamSchema } from '../zod/user.zod.js';
import { listTastingsQuerySchema } from '../zod/tasting.zod.js';
import { getMe, getPublicProfile, patchMe } from '../controllers/user.controller.js';
import { listForPublicProfile } from '../controllers/tasting.controller.js';

export const userRouter: Router = Router();

userRouter.get('/me', requireUser, getMe);
userRouter.patch('/me', requireUser, validate(updateMeSchema), patchMe);
userRouter.get('/:username', validate(usernameParamSchema, 'params'), getPublicProfile);
userRouter.get(
  '/:username/tastings',
  validate(usernameParamSchema, 'params'),
  validate(listTastingsQuerySchema, 'query'),
  listForPublicProfile,
);
