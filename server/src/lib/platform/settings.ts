import { z } from 'zod'
import { prisma } from '../prisma'

/**
 * Settings for the whole of Metriq, kept by the owner in the owner console. Never secrets: payment
 * and sign-in keys stay in the server's .env.
 */

export const sellerSchema = z.object({
  name: z.string().trim().min(2, 'The business name, please').max(120),
  address: z.string().trim().max(400).optional().default(''),
  taxId: z.string().trim().max(60).optional().default(''),
  email: z.string().trim().email('Enter a valid email').max(200).or(z.literal('')).optional().default(''),
})
export type Seller = z.infer<typeof sellerSchema>

/** Who sells Metriq, as printed on every invoice. The owner console wins; then the .env; then just "Metriq". */
export async function sellerDetails(): Promise<{ name: string; address: string | null; taxId: string | null; email: string | null; fromConsole: boolean }> {
  const row = await prisma.platformSetting.findUnique({ where: { key: 'seller' } }).catch(() => null)
  const v = row ? sellerSchema.safeParse(row.value) : null
  if (v?.success) return { name: v.data.name, address: v.data.address || null, taxId: v.data.taxId || null, email: v.data.email || null, fromConsole: true }
  return { name: process.env.BILLING_SELLER_NAME || 'Metriq', address: process.env.BILLING_SELLER_ADDRESS || null, taxId: process.env.BILLING_SELLER_TAX_ID || null, email: null, fromConsole: false }
}

export async function saveSeller(input: Seller, by: string): Promise<void> {
  await prisma.platformSetting.upsert({ where: { key: 'seller' }, update: { value: input, updatedBy: by }, create: { key: 'seller', value: input, updatedBy: by } })
}
