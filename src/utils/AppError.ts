export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'AGE_REQUIRED'
  | 'UNDERAGE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL';

const statusByCode: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  // Age gate : 403 mais codes distincts pour que le front sache reagir —
  // AGE_REQUIRED -> ecran de saisie de date, UNDERAGE -> refus definitif.
  AGE_REQUIRED: 403,
  UNDERAGE: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = statusByCode[code];
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError('BAD_REQUEST', message, details);
  }
  static unauthorized(message = 'Non authentifie'): AppError {
    return new AppError('UNAUTHORIZED', message);
  }
  static forbidden(message = 'Acces refuse'): AppError {
    return new AppError('FORBIDDEN', message);
  }
  static notFound(message = 'Ressource introuvable'): AppError {
    return new AppError('NOT_FOUND', message);
  }
  static conflict(message: string): AppError {
    return new AppError('CONFLICT', message);
  }
  static tooManyRequests(message = 'Trop de requetes, reessaie plus tard'): AppError {
    return new AppError('TOO_MANY_REQUESTS', message);
  }
  // Age gate : date de naissance non renseignee (le front doit la demander).
  static ageRequired(message = 'Date de naissance requise'): AppError {
    return new AppError('AGE_REQUIRED', message);
  }
  // Age gate : user mineur (refus definitif).
  static underage(message: string): AppError {
    return new AppError('UNDERAGE', message);
  }
}
