import { Router } from 'express';
import { userRouter } from './user.route.js';
import { tastingRouter } from './tasting.route.js';

export const apiRouter: Router = Router();

apiRouter.use('/users', userRouter);
apiRouter.use('/tastings', tastingRouter);
