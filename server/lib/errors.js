/** KALEA — erreurs applicatives normalisées (réponses API JSON). */
export class AppError extends Error {
  constructor(message, status = 400, code = 'bad_request', details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  toJSON() {
    return { error: { message: this.message, code: this.code, details: this.details ?? undefined } };
  }
}

export const badRequest = (msg, details) => new AppError(msg, 400, 'bad_request', details);
export const unauthorized = (msg = 'Authentification requise.') => new AppError(msg, 401, 'unauthorized');
export const forbidden = (msg = 'Accès refusé.') => new AppError(msg, 403, 'forbidden');
export const notFound = (msg = 'Ressource introuvable.') => new AppError(msg, 404, 'not_found');
export const conflict = (msg, code = 'conflict') => new AppError(msg, 409, code);
export const tooMany = (msg = 'Trop de requêtes. Réessayez dans un instant.') => new AppError(msg, 429, 'rate_limited');
export const serverError = (msg = 'Erreur interne.', details) => new AppError(msg, 500, 'server_error', details);
