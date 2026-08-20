import type { Response } from 'express'

/** RFC-4180-ish CSV: quote fields containing comma/quote/newline. */
export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell)
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(','),
    )
    .join('\r\n')
}

/** Send a `(string|number)[][]` grid as a downloadable CSV attachment. */
export function sendCsv(res: Response, filename: string, rows: (string | number)[][]): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(toCsv(rows))
}
