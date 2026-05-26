import { Router } from 'express';
import { v1Router } from './v1/index.js';

export const apiRouter: Router = Router();

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'buvard-api',
    versions: {
      v1: '/api/v1',
    },
    current: 'v1',
  });
});

apiRouter.use('/v1', v1Router);
