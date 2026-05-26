import { Router } from 'express';
import { userRouter } from './user.route.js';
import { tastingRouter } from './tasting.route.js';
import { appRouter } from './app.route.js';
import { adminRouter } from './admin/index.js';

export const v1Router: Router = Router();

v1Router.get('/', (_req, res) => {
  res.json({ version: 'v1', status: 'ok' });
});

v1Router.use('/users', userRouter);
v1Router.use('/tastings', tastingRouter);
v1Router.use('/app', appRouter);
v1Router.use('/admin', adminRouter);
