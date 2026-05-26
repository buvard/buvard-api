import { Router } from 'express';
import { attachUserIfAuth, requireUser } from '../../middlewares/auth.js';
import { requireActive } from '../../middlewares/requireActive.js';
import { imageUpload } from '../../middlewares/upload.js';
import { validate } from '../../middlewares/validate.js';
import { createTastingSchema, listTastingsQuerySchema, tastingIdParamSchema, updateTastingSchema } from '../../zod/tasting.zod.js';
import {
  deleteOne,
  deleteTastingPhoto,
  getOne,
  listMine,
  patchOne,
  postTasting,
  postTastingPhoto,
} from '../../controllers/tasting.controller.js';

export const tastingRouter: Router = Router();

tastingRouter.post('/', requireUser, validate(createTastingSchema), postTasting);
tastingRouter.get('/', requireUser, validate(listTastingsQuerySchema, 'query'), listMine);
tastingRouter.get('/:id', attachUserIfAuth, validate(tastingIdParamSchema, 'params'), getOne);
tastingRouter.patch('/:id', requireUser, validate(tastingIdParamSchema, 'params'), validate(updateTastingSchema), patchOne);
tastingRouter.delete('/:id', requireUser, validate(tastingIdParamSchema, 'params'), deleteOne);

// Photo du tasting — multipart/form-data, field "file"
tastingRouter.post(
  '/:id/photo',
  requireUser,
  requireActive,
  validate(tastingIdParamSchema, 'params'),
  imageUpload.single('file'),
  postTastingPhoto,
);
tastingRouter.delete(
  '/:id/photo',
  requireUser,
  validate(tastingIdParamSchema, 'params'),
  deleteTastingPhoto,
);
