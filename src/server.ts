import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDb, disconnectDb } from './config/db.js';
import { initAuth } from './config/auth.js';
import { buildApp } from './app.js';
import { loadGradesCache, seedGrades } from './services/grade.service.js';
import { startScheduler, stopScheduler } from './config/scheduler.js';

async function main(): Promise<void> {
  await connectDb();
  // Better Auth depend du client mongo connecte, on l'init apres connectDb().
  // Async car la generation du client secret Apple est asynchrone.
  await initAuth();
  // Seed idempotent des grades + chargement du cache memoire. Doit etre
  // execute apres connectDb mais avant les premieres requetes (sinon
  // getGradeForLevel renverrait undefined depuis un cache vide).
  await seedGrades();
  await loadGradesCache();

  const app = buildApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'buvard-api en ecoute');
  });

  // Taches periodiques (anonymisation des comptes supprimes, etc.)
  startScheduler();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'arret en cours...');
    stopScheduler();
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
