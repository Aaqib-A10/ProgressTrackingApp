import { Router, raw } from 'express'
import { requireAuth } from '../middleware/auth'
import { pmHandler as h } from '../lib/pm/http'
import * as P from '../controllers/projectsController'
import * as T from '../controllers/pmTasksController'
import * as R from '../controllers/pmReportsController'

/**
 * /api/projects — project management. Static paths are registered before the
 * `/:key` routes so words like "tasks" or "reports" are never read as a key.
 */
export const projectsRouter = Router()

projectsRouter.use(requireAuth)

// Me + settings + pickers
projectsRouter.get('/me/tasks', h(T.myTasks))
projectsRouter.get('/me/metrics', h(R.myMetrics))
projectsRouter.get('/notification-prefs', h(P.getPrefs))
projectsRouter.put('/notification-prefs', h(P.putPrefs))
projectsRouter.get('/users', h(P.listPickableUsers))

// Reports (admins)
projectsRouter.get('/reports/overview', h(R.reportOverview))
projectsRouter.get('/reports/export.csv', h(R.reportCsv))

// Tasks by code
projectsRouter.get('/tasks/:code', h(T.getTask))
projectsRouter.patch('/tasks/:code', h(T.updateTask))
projectsRouter.delete('/tasks/:code', h(T.deleteTask))
projectsRouter.patch('/tasks/:code/move', h(T.moveTask))
projectsRouter.get('/tasks/:code/activity', h(T.getActivity))
projectsRouter.post('/tasks/:code/watch', h(T.watchTask))
projectsRouter.delete('/tasks/:code/watch', h(T.unwatchTask))
projectsRouter.post('/tasks/:code/comments', h(T.addComment))
projectsRouter.post('/tasks/:code/checklist', h(T.addChecklistItem))
projectsRouter.post('/tasks/:code/attachments', raw({ type: () => true, limit: '26mb' }), h(T.uploadAttachment))
projectsRouter.post('/tasks/:code/extension-requests', h(T.requestExtension))
projectsRouter.patch('/comments/:id', h(T.editComment))
projectsRouter.delete('/comments/:id', h(T.deleteComment))
projectsRouter.patch('/checklist/:id', h(T.updateChecklistItem))
projectsRouter.delete('/checklist/:id', h(T.deleteChecklistItem))
projectsRouter.get('/attachments/:id/download', h(T.downloadAttachment))
projectsRouter.delete('/attachments/:id', h(T.deleteAttachment))
projectsRouter.post('/extension-requests/:id/decide', h(T.decideExtension))

// Columns + labels by id
projectsRouter.patch('/columns/:id', h(P.updateColumn))
projectsRouter.delete('/columns/:id', h(P.deleteColumn))
projectsRouter.patch('/labels/:id', h(P.updateLabel))
projectsRouter.delete('/labels/:id', h(P.deleteLabel))

// Projects
projectsRouter.get('/', h(P.listProjects))
projectsRouter.post('/', h(P.createProject))
projectsRouter.get('/:key', h(P.getProject))
projectsRouter.patch('/:key', h(P.updateProject))
projectsRouter.post('/:key/archive', h(P.archiveProject))
projectsRouter.get('/:key/board', h(P.getBoard))
projectsRouter.get('/:key/members', h(P.listMembers))
projectsRouter.post('/:key/members', h(P.addMembers))
projectsRouter.patch('/:key/members/:userId', h(P.updateMember))
projectsRouter.delete('/:key/members/:userId', h(P.removeMember))
projectsRouter.post('/:key/columns', h(P.createColumn))
projectsRouter.patch('/:key/columns/reorder', h(P.reorderColumns))
projectsRouter.post('/:key/labels', h(P.createLabel))
projectsRouter.post('/:key/tasks', h(T.createTask))
projectsRouter.post('/:key/tasks/bulk', h(T.bulkUpdate))
