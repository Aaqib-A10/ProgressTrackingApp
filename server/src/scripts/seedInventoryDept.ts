// Idempotent: ensures the INVENTORY department row exists. Run automatically by
// deploy.sh (the migration adds the enum value + tables, but not the row) so
// assigning users to Inventory works on any environment.
//   npx tsx src/scripts/seedInventoryDept.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const found = await prisma.department.findFirst({ where: { companyId: 'company-1', type: 'INVENTORY' } })
  const dept = found
    ? await prisma.department.update({ where: { id: found.id }, data: { name: 'Inventory' } })
    : await prisma.department.create({ data: { companyId: 'company-1', type: 'INVENTORY', name: 'Inventory' } })
  // eslint-disable-next-line no-console
  console.log('INVENTORY department ready:', dept.id)
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
