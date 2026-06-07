import type { ErrorRequestHandler } from 'express';
import mongoose, { MongooseError } from 'mongoose';
import { MulterError } from 'multer';
import { z, ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { logger } from '../config/logger.js';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    const body: ErrorBody = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    res.status(err.status).json(body);
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'Donnees invalides', details: z.treeifyError(err) },
    } satisfies ErrorBody);
    return;
  }

  // Discrimine les MongooseError selon leur type :
  // - ValidationError / CastError : erreur de saisie → 400
  // - autres (DocumentNotFoundError, OverwriteModelError, etc.) : bug serveur → 500
  if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: err.message },
    } satisfies ErrorBody);
    return;
  }
  if (err instanceof MongooseError) {
    logger.error({ err }, 'erreur mongoose non geree (500)');
    res.status(500).json({
      error: { code: 'INTERNAL', message: 'Erreur serveur' },
    } satisfies ErrorBody);
    return;
  }

  if (err instanceof MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux' : err.message;
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message },
    } satisfies ErrorBody);
    return;
  }

  // Erreur de cle dupliquee Mongo
  if (isMongoDuplicateError(err)) {
    res.status(409).json({
      error: { code: 'CONFLICT', message: 'Ressource deja existante' },
    } satisfies ErrorBody);
    return;
  }

  logger.error({ err }, 'erreur non geree');
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Erreur serveur' },
  } satisfies ErrorBody);
};

function isMongoDuplicateError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 11000
  );
}
