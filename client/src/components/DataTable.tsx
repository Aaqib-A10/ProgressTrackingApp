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
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  getRowId: (row: T) => string
  /** Pinned summary row rendered first (e.g. TEAM TOTALS). */
  totalRow?: { cells: Record<string, ReactNode>; className?: string }
  /** Full-width banner inserted after a row (e.g. an On-Leave notice). */
  renderRowBanner?: (row: T) => ReactNode | null
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
  onRowClick,
  emptyMessage = 'No data to show.',
  className,
}: DataTableProps<T>) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-body-md">
        <thead className="sticky top-0 z-10">
          <tr className="bg-bg">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'whitespace-nowrap border-b border-line px-4 py-3 text-label-md uppercase text-ink-muted',
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
            <tr className={cn('bg-primary/5 font-semibold text-ink', totalRow.className)}>
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
              <td colSpan={columns.length} className="px-4 py-10 text-center text-body-md text-ink-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const banner = renderRowBanner?.(row)
              return (
                <Fragment key={getRowId(row)}>
                  <tr
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      'border-b border-line/70 transition-colors',
                      i % 2 === 1 && 'bg-slate-50/60',
                      onRowClick && 'cursor-pointer hover:bg-slate-100',
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          'whitespace-nowrap px-4 py-3 text-ink',
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
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
