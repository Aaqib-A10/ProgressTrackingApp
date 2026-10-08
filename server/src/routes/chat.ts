import { Router, raw } from 'express'
import { requireAuth } from '../middleware/auth'
import { pmHandler as h } from '../lib/pm/http'
import * as C from '../controllers/chatController'

/** /api/chat — direct messages, groups and project channels (polling based). */
export const chatRouter = Router()

chatRouter.use(requireAuth)

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
