import type { Response } from 'express'
import { ZodError } from 'zod'
import type { Role } from '@prisma/client'
import { HttpError } from './access'
import type { AuthedRequest } from '../../middleware/auth'

/**
 * Runs a Projects controller as a given person, without going over HTTP. Claude's connector
 * uses it so every ticket action goes through the same checks, activity log and notifications
 * as the app itself (a viewer still cannot move a task, comments still notify watchers).
 */
export interface Invoked { status: number; body: unknown }

export async function invokeAs(
  fn: (req: AuthedRequest, res: Response) => Promise<unknown>,
  user: { id: string; role: Role },
  opts: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {},
): Promise<Invoked> {
  let status = 200
  let body: unknown = null
  const res = {
    status(code: number) { status = code; return res },
    json(v: unknown) { body = v; return res },
    end() { return res },
    setHeader() { return res },
    sendFile() { throw new HttpError(400, 'Files cannot be sent this way') },
  } as unknown as Response
  const req = { user, params: opts.params ?? {}, query: opts.query ?? {}, body: opts.body ?? {}, headers: {} } as unknown as AuthedRequest
  try {
    await fn(req, res)
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, body: { error: err.message } }
    if (err instanceof ZodError) return { status: 422, body: { error: err.issues[0]?.message ?? 'Invalid input' } }
    throw err
  }
  return { status, body }
}

/** The error message of a failed call, for showing to the person (or to Claude). */
export const invokedError = (r: Invoked): string => ((r.body as { error?: string } | null)?.error ?? `Request failed (${r.status})`)
