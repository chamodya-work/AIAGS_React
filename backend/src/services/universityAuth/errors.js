export class UniversityAuthError extends Error {
  constructor(message, statusCode = 401, publicMessage = message) {
    super(message);
    this.name = 'UniversityAuthError';
    this.statusCode = statusCode;
    this.publicMessage = publicMessage;
  }
}

export function authError(message, statusCode = 401) {
  return new UniversityAuthError(message, statusCode, message);
}

export function serviceUnavailable(message = 'University login service unavailable') {
  return new UniversityAuthError(message, 502, 'University login service unavailable. Please try again later.');
}
