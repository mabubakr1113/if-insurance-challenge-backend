export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);
export const forbidden = (message = "You don't have access to this") => new ApiError(403, 'forbidden', message);
export const invalidState = (message: string) => new ApiError(409, 'invalid_state', message);
