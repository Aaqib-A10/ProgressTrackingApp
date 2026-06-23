import type { Request, Response, NextFunction, RequestHandler } from 'express'

/**
 * Wraps an async route handler so rejected promises are forwarded to Express's
 * error middleware instead of hanging the request (Express 4 doesn't catch
 * async throws automatically).
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
