/** Money as the Deal Tracker shows it: $14,400, $28,000.01, $0.125 (prices per lb keep their decimals). */
export const dealMoney = (n: number | null | undefined): string =>
  n == null ? '-' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 })}`
