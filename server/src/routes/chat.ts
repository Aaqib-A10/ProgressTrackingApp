import { Router, raw, type NextFunction, type Response } from 'express'
import type { Role } from '@prisma/client'
import { requireAuth, type AuthedRequest } from '../middleware/auth'
import { GUEST_CALL_PATH, readGuestPass } from '../lib/pm/guests'
import * as G from '../controllers/guestController'
import { pmHandler as h } from '../lib/pm/http'
import * as C from '../controllers/chatController'

/** /api/chat — direct messages, groups and project channels (polling based). */
export const chatRouter = Router()

/**
 * Team members sign in as usual. A guest from outside Metriq (joined by link, let in by
 * someone in the call) may only use the call endpoints, with their guest pass. The guest
 * page says so with an X-PT-Guest header, so a signed-in Metriq user testing a guest link
 * is treated as the guest there too.
 */
function memberOrGuest(req: AuthedRequest, res: Response, next: NextFunction): void {
  const wantsGuest = req.headers['x-pt-guest'] === '1'
  const hasLogin = !!(req as AuthedRequest & { cookies?: Record<string, string> }).cookies?.token || !!req.headers.authorization
  if (GUEST_CALL_PATH.test(req.path) && (wantsGuest || !hasLogin)) {
    const pass = readGuestPass(req)
    if (pass) {
      req.user = { id: pass.gid, role: 'GUEST' as unknown as Role }
      next()
      return
    }
  }
  void requireAuth(req, res, next)
}

chatRouter.use(memberOrGuest)

chatRouter.get('/unread', h(C.unreadSummary))
chatRouter.get('/users', h(C.chatUsers))
chatRouter.get('/search', h(C.searchMessages))
chatRouter.get('/projects/:key', h(C.projectConversation))
chatRouter.get('/files/:messageId', h(C.downloadFile))
chatRouter.patch('/messages/:id', h(C.editMessage))
chatRouter.delete('/messages/:id', h(C.deleteMessage))
chatRouter.get('/conversations', h(C.listConversations))
chatRouter.post('/conversations', h(C.createConversation))
chatRouter.get('/conversations/:id', h(C.getConversation))
chatRouter.patch('/conversations/:id', h(C.updateConversation))
chatRouter.post('/conversations/:id/leave', h(C.leaveConversation))
chatRouter.get('/conversations/:id/messages', h(C.listMessages))
chatRouter.post('/conversations/:id/messages', h(C.sendMessage))
chatRouter.post('/conversations/:id/files', raw({ type: () => true, limit: '26mb' }), h(C.sendFile))
chatRouter.post('/conversations/:id/uploads', h(C.startUpload))
chatRouter.post('/uploads/:uploadId/piece', raw({ type: () => true, limit: '6mb' }), h(C.uploadPiece))
chatRouter.post('/uploads/:uploadId/finish', h(C.finishUpload))
chatRouter.delete('/uploads/:uploadId', h(C.cancelUpload))
chatRouter.post('/conversations/:id/read', h(C.markRead))
chatRouter.post('/conversations/:id/mute', h(C.mute))
chatRouter.post('/conversations/:id/typing', h(C.typingPing))
chatRouter.post('/conversations/:id/calls', h(C.startCall))
chatRouter.get('/calls/active', h(C.activeCalls))
chatRouter.post('/calls/:callId/join', h(C.joinCall))
chatRouter.post('/calls/:callId/signal', h(C.callSignal))
chatRouter.get('/calls/:callId/poll', h(C.pollCall))
chatRouter.post('/calls/:callId/state', h(C.callState))
chatRouter.post('/calls/:callId/leave', h(C.leaveCall))
chatRouter.post('/calls/:callId/decline', h(C.declineCall))
chatRouter.post('/calls/:callId/lobby', h(G.answerGuest))
chatRouter.get('/conversations/:id/guest-link', h(G.getGuestLink))
chatRouter.post('/conversations/:id/guest-link', h(G.makeGuestLink))
chatRouter.delete('/conversations/:id/guest-link', h(G.deleteGuestLink))
chatRouter.post('/calls/:callId/invite', h(C.inviteToCall))
chatRouter.post('/calls/:callId/react', h(C.reactInCall))
chatRouter.post('/calls/:callId/mute', h(C.muteParticipant))
chatRouter.post('/calls/:callId/notes', h(C.setNoteTaker))
chatRouter.get('/calls/:callId/notes', h(C.callNotes))
chatRouter.post('/calls/:callId/notes/retry', h(C.retryNotes))
chatRouter.post('/calls/:callId/transcript', h(C.postTranscript))
chatRouter.post('/calls/:callId/audio', raw({ type: () => true, limit: '7mb' }), h(C.postAudio))
chatRouter.patch('/calls/:callId/notes/action-items/:index', h(C.linkActionItem))
chatRouter.post('/calls/:callId/recordings', h(C.startRecording))
chatRouter.post('/recordings/:recId/chunk', raw({ type: () => true, limit: '11mb' }), h(C.recordingChunk))
chatRouter.post('/recordings/:recId/finish', h(C.finishRecording))
chatRouter.post('/messages/:id/react', h(C.toggleReaction))
