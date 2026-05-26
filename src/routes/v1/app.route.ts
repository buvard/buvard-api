import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { latestUpdateQuerySchema } from '../../zod/release.zod.js';
import { getLatestUpdate } from '../../controllers/app.controller.js';

export const appRouter: Router = Router();

// Endpoint public consomme par Capgo Live Updates au boot de l'app native
appRouter.get('/latest-update', validate(latestUpdateQuerySchema, 'query'), getLatestUpdate);
