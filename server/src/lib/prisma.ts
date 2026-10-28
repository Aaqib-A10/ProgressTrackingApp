import { PrismaClient } from '@prisma/client'
import { guardWrite } from './health/auditContext'
import { applyWalls } from './tenancy'

// Single shared Prisma client for the process. The query hook does two things:
//  - company walls (lib/tenancy): inside a signed-in request every read and write is limited
//    to that person's company, and new rows get the company;
//  - during the hourly self check (System Health) any save is stopped before it reaches the
//    database.
const base = new PrismaClient()
const client = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        guardWrite(operation, model)
        return query(applyWalls(base, model, operation, args as Record<string, unknown>) as typeof args)
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
