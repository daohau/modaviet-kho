export class AppError extends Error {
  constructor(code, message, statusCode = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function assertApp(condition, code, message, statusCode = 400, details) {
  if (!condition) throw new AppError(code, message, statusCode, details);
}
