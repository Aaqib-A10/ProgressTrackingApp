import { Inbox } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { cn } from '../lib/cn'

export type Align = 'left' | 'right' | 'center'

export interface Column<T> {
  key: string
  header: ReactNode
  align?: Align
  /** Cell renderer; falls back to (row as any)[key]. */
  render?: (row: T, index: number) => ReactNode
  className?: string
  headerClassName?: string
  /** Long text (titles, links) wraps onto more lines instead of widening the table. */
  wrap?: boolean
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  getRowId: (row: T) => string
  /** Pinned summary row rendered first (e.g. TEAM TOTALS). */
  totalRow?: { cells: Record<string, ReactNode>; className?: string }
  /** Full-width banner inserted after a row (e.g. an On-Leave notice). */
  renderRowBanner?: (row: T) => ReactNode | null
  /** Group rows into sections; needs `renderGroupHeader`. Groups appear in the rows' first-seen order. */
  groupBy?: (row: T) => string
  /** Full-width section header rendered before each group (e.g. a department name + count). */
  renderGroupHeader?: (groupKey: string, rows: T[]) => ReactNode
  onRowClick?: (row: T) => void
  emptyMessage?: ReactNode
  className?: string
}

const alignClass: Record<Align, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

/**
 * Generic data table: sticky header, zebra rows, optional totals + banner rows.
 * Metric columns should set `align: 'right'` (DESIGN.md).
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  totalRow,
  renderRowBanner,
  groupBy,
  renderGroupHeader,
  onRowClick,
  emptyMessage = 'No data to show.',
  className,
}: DataTableProps<T>) {
  const grouped = groupBy && renderGroupHeader
  // Preserve first-seen order of group keys; the caller pre-sorts rows for a stable order.
  const groups: { key: string; rows: T[] }[] = []
  if (grouped) {
    const index = new Map<string, T[]>()
    for (const row of rows) {
      const key = groupBy(row)
      let bucket = index.get(key)
      if (!bucket) {
        bucket = []
        index.set(key, bucket)
        groups.push({ key, rows: bucket })
      }
      bucket.push(row)
    }
  }

  const renderRow = (row: T, i: number) => {
    const banner = renderRowBanner?.(row)
    return (
      <Fragment key={getRowId(row)}>
        <tr
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          className={cn(
            'border-b border-line/70 transition-colors last:border-b-0',
            onRowClick ? 'cursor-pointer hover:bg-slate-50' : 'hover:bg-slate-50/60',
          )}
        >
          {columns.map((col) => (
            <td
              key={col.key}
              className={cn(
                col.wrap ? 'min-w-[16rem] whitespace-normal break-words px-4 py-2.5 text-ink [overflow-wrap:anywhere]' : 'whitespace-nowrap px-4 py-2.5 text-ink',
                col.align === 'right' && 'tabular-nums',
                alignClass[col.align ?? 'left'],
                col.className,
              )}
            >
              {col.render ? col.render(row, i) : ((row as Record<string, unknown>)[col.key] as ReactNode)}
            </td>
          ))}
        </tr>
        {banner && (
          <tr>
            <td colSpan={columns.length} className="px-4 py-2">
              {banner}
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-body-md">
        <thead className="sticky top-0 z-10">
          <tr className="bg-slate-50/90 backdrop-blur">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'h-9 whitespace-nowrap border-b border-line px-4 text-[12px] font-medium text-ink-muted',
                  alignClass[col.align ?? 'left'],
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {totalRow && (
            <tr className={cn('border-b border-line bg-primary/[0.04] font-semibold text-ink', totalRow.className)}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn('whitespace-nowrap px-4 py-3 tabular-nums', alignClass[col.align ?? 'left'])}
                >
                  {totalRow.cells[col.key] ?? null}
                </td>
              ))}
            </tr>
          )}

          {rows.length === 0 && !totalRow ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-body-md text-ink-muted">
                <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-slate-50 text-ink-faint shadow-xs"><Inbox size={16} /></span>
                {emptyMessage}
              </td>
            </tr>
          ) : grouped ? (
            groups.map((g) => (
              <Fragment key={`group:${g.key}`}>
                <tr className="bg-slate-50">
                  <td colSpan={columns.length} className="px-4 py-2.5">
                    {renderGroupHeader(g.key, g.rows)}
                  </td>
                </tr>
                {g.rows.map((row, i) => renderRow(row, i))}
              </Fragment>
            ))
          ) : (
            rows.map((row, i) => renderRow(row, i))
          )}
        </tbody>
      </table>
    </div>
  )
}
