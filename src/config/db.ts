import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

// Le nom de la database est derive de NODE_ENV pour eviter de melanger dev/prod
const DB_NAME_BY_ENV = {
  development: 'buvard-dev',
  production: 'buvard-prod',
  test: 'buvard-test',
} as const;

export const dbName = DB_NAME_BY_ENV[env.NODE_ENV];

mongoose.set('strictQuery', true);

export async function connectDb(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName,
      serverSelectionTimeoutMS: 10_000,
      autoIndex: env.NODE_ENV !== 'production',
    });
    logger.info({ host: mongoose.connection.host, db: dbName }, 'mongo connecte');
  } catch (err) {
    logger.fatal({ err }, 'echec connexion mongo');
    throw err;
  }

  mongoose.connection.on('disconnected', () => logger.warn('mongo deconnecte'));
  mongoose.connection.on('reconnected', () => logger.info('mongo reconnecte'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'erreur mongo'));
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  logger.info('mongo deconnecte proprement');
}
