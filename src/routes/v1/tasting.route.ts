import { Router } from 'express';
import { attachUserIfAuth, requireUser } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { createTastingSchema, listTastingsQuerySchema, tastingIdParamSchema, updateTastingSchema } from '../../zod/tasting.zod.js';
import { deleteOne, getOne, listMine, patchOne, postTasting } from '../../controllers/tasting.controller.js';

export const tastingRouter: Router = Router();

tastingRouter.post('/', requireUser, validate(createTastingSchema), postTasting);
tastingRouter.get('/', requireUser, validate(listTastingsQuerySchema, 'query'), listMine);
tastingRouter.get('/:id', attachUserIfAuth, validate(tastingIdParamSchema, 'params'), getOne);
tastingRouter.patch('/:id', requireUser, validate(tastingIdParamSchema, 'params'), validate(updateTastingSchema), patchOne);
tastingRouter.delete('/:id', requireUser, validate(tastingIdParamSchema, 'params'), deleteOne);
