import { Router } from 'express';
import { attachUserIfAuth, requireUser } from '../../middlewares/auth.js';
import { requireActive } from '../../middlewares/requireActive.js';
import { imageUpload } from '../../middlewares/upload.js';
import { validate } from '../../middlewares/validate.js';
import {
  createTastingSchema,
  listDiscoverPlacesQuerySchema,
  listTastingsQuerySchema,
  reorderPhotosSchema,
  tastingIdParamSchema,
  updateTastingSchema,
} from '../../zod/tasting.zod.js';
import {
  deleteAllTastingPhotos,
  deleteOne,
  deleteTastingLike,
  deleteTastingPhoto,
  getOne,
  listDiscover,
  listDiscoverPlacesHandler,
  listFeed,
  listLikers,
  listMine,
  patchOne,
  patchTastingPhotosOrder,
  postTasting,
  postTastingLike,
  postTastingPhoto,
} from '../../controllers/tasting.controller.js';

export const tastingRouter: Router = Router();

// /feed, /discover et /discover/places doivent etre declares AVANT /:id
// pour ne pas etre captes comme un id.
tastingRouter.get('/feed', requireUser, validate(listTastingsQuerySchema, 'query'), listFeed);
tastingRouter.get('/discover', attachUserIfAuth, validate(listTastingsQuerySchema, 'query'), listDiscover);
// Aggregation des lieux a partir des degustations publiques (onglet "Decouvrir"
// sur la carte). Auth obligatoire.
tastingRouter.get(
  '/discover/places',
  requireUser,
  validate(listDiscoverPlacesQuerySchema, 'query'),
  listDiscoverPlacesHandler,
);

tastingRouter.post('/', requireUser, validate(createTastingSchema), postTasting);
tastingRouter.get('/', requireUser, validate(listTastingsQuerySchema, 'query'), listMine);
tastingRouter.get('/:id', attachUserIfAuth, validate(tastingIdParamSchema, 'params'), getOne);
tastingRouter.patch('/:id', requireUser, validate(tastingIdParamSchema, 'params'), validate(updateTastingSchema), patchOne);
tastingRouter.delete('/:id', requireUser, validate(tastingIdParamSchema, 'params'), deleteOne);

// Photos d'un tasting (array, max 10) — multipart/form-data, field "file"
tastingRouter.post(
  '/:id/photos',
  requireUser,
  requireActive,
  validate(tastingIdParamSchema, 'params'),
  imageUpload.single('file'),
  postTastingPhoto,
);
// Retire une photo specifique par index (0-based)
tastingRouter.delete(
  '/:id/photos/:index',
  requireUser,
  validate(tastingIdParamSchema, 'params'),
  deleteTastingPhoto,
);
// Retire toutes les photos
tastingRouter.delete(
  '/:id/photos',
  requireUser,
  validate(tastingIdParamSchema, 'params'),
  deleteAllTastingPhotos,
);
// Reordonne les photos via une permutation des indices ({ order: number[] })
tastingRouter.patch(
  '/:id/photos',
  requireUser,
  requireActive,
  validate(tastingIdParamSchema, 'params'),
  validate(reorderPhotosSchema),
  patchTastingPhotosOrder,
);

// Likes — idempotents (POST/DELETE plusieurs fois = OK).
tastingRouter.post(
  '/:id/like',
  requireUser,
  requireActive,
  validate(tastingIdParamSchema, 'params'),
  postTastingLike,
);
tastingRouter.delete(
  '/:id/like',
  requireUser,
  validate(tastingIdParamSchema, 'params'),
  deleteTastingLike,
);
// Liste paginee des users qui ont like (auth optionnelle pour permettre
// le check de visibilite, mais accessible aussi en non-auth pour tasting public).
tastingRouter.get(
  '/:id/likes',
  attachUserIfAuth,
  validate(tastingIdParamSchema, 'params'),
  listLikers,
);
