import type { NextFunction, Request, Response } from 'express';
import { z, type ZodType } from 'zod';
import { AppError } from '../utils/AppError.js';

type Source = 'body' | 'query' | 'params';

export function validate<S extends ZodType>(schema: S, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(AppError.badRequest('Donnees invalides', z.treeifyError(result.error)));
      return;
    }
    // On reassigne la valeur parsee (avec defaults / coercions appliques)
    Reflect.set(req, source, result.data);
    next();
  };
}
