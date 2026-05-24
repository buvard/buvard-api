import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDb, disconnectDb } from './config/db.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  await connectDb();

  const app = buildApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'buvard-api en ecoute');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'arret en cours...');
    server.close(() => logger.info('http server ferme'));
    try {
      await disconnectDb();
    } catch (err) {
      logger.error({ err }, 'erreur disconnect mongo');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

void main();
