import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { ZodError, type ZodTypeAny, type z } from 'zod'
import { HttpError, type PmViewer } from './access'
import type { AuthedRequest } from '../../middleware/auth'

/**
 * Async handler for the Projects + Chat routes. Like asyncHandler, but turns an
 * HttpError into its status and a ZodError into a 422 with field messages, so
 * controllers can simply `throw` instead of hand writing every error response.
 */
export function pmHandler(fn: (req: AuthedRequest, res: Response) => Promise<unknown>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthedRequest, res)).catch((err) => {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message })
        return
      }
      if (err instanceof ZodError) {
        res.status(422).json({
          error: err.issues[0]?.message ?? 'Invalid input',
          fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        })
        return
      }
      next(err)
    })
  }
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data)
}

export function viewer(req: AuthedRequest): PmViewer {
  if (!req.user) throw new HttpError(401, 'Not authenticated')
  return { id: req.user.id, role: req.user.role }
}
