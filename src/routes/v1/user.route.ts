import { Router } from 'express';
import { requireUser } from '../../middlewares/auth.js';
import { requireActive } from '../../middlewares/requireActive.js';
import { validate } from '../../middlewares/validate.js';
import {
  listFollowsQuerySchema,
  updateMeSchema,
  updatePrefsSchema,
  usernameParamSchema,
} from '../../zod/user.zod.js';
import { listTastingsQuerySchema } from '../../zod/tasting.zod.js';
import {
  deleteBlock,
  deleteFollow,
  deleteMe,
  getFollowers,
  getFollowing,
  getMe,
  getMyBlocks,
  getMyPrefs,
  getPublicProfile,
  getStats,
  patchMe,
  patchMyPrefs,
  postAcceptPrivacy,
  postAcceptTerms,
  postBlock,
  postCompleteOnboarding,
  postFollow,
} from '../../controllers/user.controller.js';
import { listForPublicProfile } from '../../controllers/tasting.controller.js';

export const userRouter: Router = Router();

// /me et ses sous-routes — ordre important: declarer avant /:username
userRouter.get('/me', requireUser, getMe);
userRouter.patch('/me', requireUser, requireActive, validate(updateMeSchema), patchMe);
userRouter.delete('/me', requireUser, deleteMe);
userRouter.get('/me/prefs', requireUser, getMyPrefs);
userRouter.patch('/me/prefs', requireUser, validate(updatePrefsSchema), patchMyPrefs);
userRouter.get('/me/stats', requireUser, getStats);

// Onboarding & legal
userRouter.post('/me/complete-onboarding', requireUser, postCompleteOnboarding);
userRouter.post('/me/accept-terms', requireUser, postAcceptTerms);
userRouter.post('/me/accept-privacy', requireUser, postAcceptPrivacy);

// Liste des blocages de l'utilisateur connecte
userRouter.get('/me/blocks', requireUser, validate(listFollowsQuerySchema, 'query'), getMyBlocks);

// Routes publiques par username
userRouter.get('/:username', validate(usernameParamSchema, 'params'), getPublicProfile);
userRouter.get(
  '/:username/tastings',
  validate(usernameParamSchema, 'params'),
  validate(listTastingsQuerySchema, 'query'),
  listForPublicProfile,
);

// Listes followers / following — publiques (respectent profilePublic via le service)
userRouter.get(
  '/:username/followers',
  validate(usernameParamSchema, 'params'),
  validate(listFollowsQuerySchema, 'query'),
  getFollowers,
);
userRouter.get(
  '/:username/following',
  validate(usernameParamSchema, 'params'),
  validate(listFollowsQuerySchema, 'query'),
  getFollowing,
);

// Actions social — necessitent compte actif
userRouter.post(
  '/:username/follow',
  requireUser,
  requireActive,
  validate(usernameParamSchema, 'params'),
  postFollow,
);
userRouter.delete(
  '/:username/follow',
  requireUser,
  validate(usernameParamSchema, 'params'),
  deleteFollow,
);
userRouter.post(
  '/:username/block',
  requireUser,
  validate(usernameParamSchema, 'params'),
  postBlock,
);
userRouter.delete(
  '/:username/block',
  requireUser,
  validate(usernameParamSchema, 'params'),
  deleteBlock,
);
