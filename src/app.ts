import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { pinoHttp } from 'pino-http';
import { toNodeHandler } from 'better-auth/node';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { APP_VERSION } from './config/version.js';
import { getAuth } from './config/auth.js';
import { errorHandler } from './middlewares/error.js';
import { notFoundHandler } from './middlewares/notFound.js';
import { apiRouter } from './routes/index.js';
import { PUBLIC_DIR, renderLanding } from './views/landing.js';

export function buildApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(compression());
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/' },
    }),
  );

  // Routes Better Auth — montees AVANT express.json() car Better Auth lit
  // le body brut via la Fetch API (Request global).
  app.all('/api/auth/*splat', toNodeHandler(getAuth().handler));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.get('/', (_req, res) => {
    res.type('html').send(renderLanding());
  });

  // Sert les assets statiques (favicon, etc.) — `index: false` car / est gere au-dessus
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1d' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: APP_VERSION, uptime: process.uptime() });
  });

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
