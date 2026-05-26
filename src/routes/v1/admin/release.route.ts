import { Router } from 'express';
import { bundleUpload } from '../../../middlewares/upload.js';
import { validate } from '../../../middlewares/validate.js';
import {
  createReleaseSchema,
  listReleasesQuerySchema,
  releaseIdParamSchema,
  updateReleaseSchema,
} from '../../../zod/release.zod.js';
import {
  deleteReleaseHandler,
  getReleases,
  patchRelease,
  postRelease,
} from '../../../controllers/admin/release.controller.js';

export const adminReleaseRouter: Router = Router();

// POST /api/v1/admin/releases — multipart/form-data
//   field "file" : .zip du bundle (max 50 MB)
//   body  : version, platform, notes?, active?
adminReleaseRouter.post(
  '/',
  bundleUpload.single('file'),
  validate(createReleaseSchema),
  postRelease,
);
adminReleaseRouter.get('/', validate(listReleasesQuerySchema, 'query'), getReleases);
adminReleaseRouter.patch(
  '/:id',
  validate(releaseIdParamSchema, 'params'),
  validate(updateReleaseSchema),
  patchRelease,
);
adminReleaseRouter.delete(
  '/:id',
  validate(releaseIdParamSchema, 'params'),
  deleteReleaseHandler,
);
