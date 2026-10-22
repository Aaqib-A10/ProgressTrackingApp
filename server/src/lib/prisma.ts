import { PrismaClient } from '@prisma/client'
import { guardWrite } from './health/auditContext'

// Single shared Prisma client for the process. The query hook only matters during the hourly
// self check (System Health): there, any save is stopped before it reaches the database.
const client = new PrismaClient().$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        guardWrite(operation, model)
        return query(args)
      },
    },
    async $allOperations({ operation, args, query }) {
      guardWrite(operation, undefined)
      return query(args)
    },
  },
})

// The hook adds behaviour only, not new methods, so the plain client type still describes it
// (and keeps every existing helper that takes a transaction client happy).
export const prisma = client as unknown as PrismaClient
