import { Router } from 'express';
import { attachUserIfAuth, requireUser } from '../../middlewares/auth.js';
import { requireActive } from '../../middlewares/requireActive.js';
import { imageUpload } from '../../middlewares/upload.js';
import { exportLimiter, mutationLimiter, redeemLimiter, uploadLimiter } from '../../middlewares/rateLimit.js';
import { validate } from '../../middlewares/validate.js';
import {
  completeOnboardingSchema,
  listFollowsQuerySchema,
  mentionsQuerySchema,
  redeemCodeSchema,
  searchUsersQuerySchema,
  setDisplayGradeSchema,
  updateMeSchema,
  updatePrefsSchema,
  usernameParamSchema,
} from '../../zod/user.zod.js';
import { listTastingsQuerySchema } from '../../zod/tasting.zod.js';
import { createReportSchema } from '../../zod/report.zod.js';
import { postReportUser } from '../../controllers/report.controller.js';
import {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} from '../../zod/notification.zod.js';
import {
  getMyNotifications,
  getMyUnreadCount,
  postMarkAllRead,
  postMarkOneRead,
} from '../../controllers/notification.controller.js';
import {
  deleteAvatar,
  deleteBlock,
  deleteCover,
  deleteFollow,
  deleteMe,
  getFollowers,
  getFollowing,
  getMe,
  getMyBlocks,
  getMyExport,
  getMyMentions,
  getMyPrefs,
  getPublicProfile,
  getSearchUsers,
  getStats,
  patchMe,
  patchMyGrade,
  patchMyPrefs,
  postRedeemCode,
  postAcceptPrivacy,
  postAcceptTerms,
  postAvatar,
  postBlock,
  postCompleteOnboarding,
  postCover,
  postFollow,
} from '../../controllers/user.controller.js';
import { listForPublicProfile } from '../../controllers/tasting.controller.js';

export const userRouter: Router = Router();

// /me et ses sous-routes — ordre important: declarer avant /:username
userRouter.get('/me', requireUser, getMe);
userRouter.patch('/me', requireUser, requireActive, validate(updateMeSchema), patchMe);
userRouter.patch('/me/grade', requireUser, requireActive, validate(setDisplayGradeSchema), patchMyGrade);
userRouter.post('/me/redeem-code', requireUser, requireActive, redeemLimiter, validate(redeemCodeSchema), postRedeemCode);
userRouter.delete('/me', requireUser, deleteMe);
userRouter.get('/me/export', requireUser, exportLimiter, getMyExport);
userRouter.get('/me/prefs', requireUser, getMyPrefs);
userRouter.patch('/me/prefs', requireUser, validate(updatePrefsSchema), patchMyPrefs);
userRouter.get('/me/stats', requireUser, getStats);

// Onboarding & legal
userRouter.post(
  '/me/complete-onboarding',
  requireUser,
  validate(completeOnboardingSchema),
  postCompleteOnboarding,
);
userRouter.post('/me/accept-terms', requireUser, postAcceptTerms);
userRouter.post('/me/accept-privacy', requireUser, postAcceptPrivacy);

// Liste des blocages de l'utilisateur connecte
userRouter.get('/me/blocks', requireUser, validate(listFollowsQuerySchema, 'query'), getMyBlocks);

// Mentions recues par l'utilisateur connecte
userRouter.get('/me/mentions', requireUser, validate(mentionsQuerySchema, 'query'), getMyMentions);

// Notifications in-app de l'utilisateur connecte. unread-count declaree avant
// /:id/read (pas de conflit, mais ordre logique).
userRouter.get(
  '/me/notifications',
  requireUser,
  validate(listNotificationsQuerySchema, 'query'),
  getMyNotifications,
);
userRouter.get('/me/notifications/unread-count', requireUser, getMyUnreadCount);
userRouter.post('/me/notifications/read', requireUser, postMarkAllRead);
userRouter.post(
  '/me/notifications/:id/read',
  requireUser,
  validate(notificationIdParamSchema, 'params'),
  postMarkOneRead,
);

// Recherche users — declaree AVANT /:username pour ne pas etre captee comme username
userRouter.get(
  '/search',
  attachUserIfAuth,
  validate(searchUsersQuerySchema, 'query'),
  getSearchUsers,
);

// Avatar & cover — multipart/form-data, field "file"
userRouter.post('/me/avatar', requireUser, requireActive, uploadLimiter, imageUpload.single('file'), postAvatar);
userRouter.delete('/me/avatar', requireUser, deleteAvatar);
userRouter.post('/me/cover', requireUser, requireActive, uploadLimiter, imageUpload.single('file'), postCover);
userRouter.delete('/me/cover', requireUser, deleteCover);

// Routes publiques par username
userRouter.get('/:username', attachUserIfAuth, validate(usernameParamSchema, 'params'), getPublicProfile);
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
  mutationLimiter,
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
  mutationLimiter,
  validate(usernameParamSchema, 'params'),
  postBlock,
);
userRouter.delete(
  '/:username/block',
  requireUser,
  validate(usernameParamSchema, 'params'),
  deleteBlock,
);

// Signalement d'un user — moderation. Mutation limitee.
userRouter.post(
  '/:username/report',
  requireUser,
  requireActive,
  mutationLimiter,
  validate(usernameParamSchema, 'params'),
  validate(createReportSchema),
  postReportUser,
);
