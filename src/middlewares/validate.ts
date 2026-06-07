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
    // Express 5 expose req.query via un getter en lecture seule : `Reflect.set`
    // y echoue silencieusement et l'on garderait les strings brutes (les autres
    // sources body/params sont writeables, mais on uniformise via
    // Object.defineProperty pour eviter une divergence selon la source).
    Object.defineProperty(req, source, {
      value: result.data,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    next();
  };
}
