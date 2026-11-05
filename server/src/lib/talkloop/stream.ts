import type { Request, Response } from 'express'
import { HttpError } from '../pm/access'
import { talkloopClient } from './client'

/** Stream a TalkLoop recording to the browser with the server's token (Range passed through); the browser never sees TalkLoop. */
export async function pipeTalkLoopRecording(req: Request, res: Response, uniqueid: string): Promise<void> {
  const client = talkloopClient()
  if (!client) throw new HttpError(503, 'TalkLoop is not connected')
  const up = await client.recording(uniqueid, typeof req.headers.range === 'string' ? req.headers.range : null)
  if (!up.ok && up.status !== 206) throw new HttpError(404, 'The recording is not on TalkLoop any more')
  res.status(up.status)
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(h); if (v) res.setHeader(h, v) }
  if (!up.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'private, no-store')
  if (!up.body) { res.end(); return }
  const { Readable } = await import('node:stream')
  Readable.fromWeb(up.body as import('node:stream/web').ReadableStream).pipe(res)
}
