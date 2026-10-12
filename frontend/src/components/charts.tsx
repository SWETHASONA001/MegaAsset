import type { ReactNode } from 'react'
import { fmtNum } from '../lib/format'

/** Validated categorical palette (fixed order — never cycled; series beyond 8 fold into "Other"). */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
/** Single-hue sequential ramp (magnitude). */
export const SEQ = ['#d6eef8', '#ade0f1', '#74c9e5', '#38a9d1', '#168cb8', '#0c709a', '#0d5a7d']
export const LINE_COLOURS: Record<string, string> = { 'Blue Line': '#1d4ed8', 'Green Line': '#15803d' }
export const STATUS_COLOURS: Record<string, string> = {
  RECEIVED: '#2a78d6', INVESTIGATING: '#4a3aa7', ASSIGNED: '#1baf7a', IN_PROGRESS: '#eda100',
  AWAITING_VERIFICATION: '#e87ba4', RESOLVED: '#008300', CLOSED: '#94a3b8', REOPENED: '#e34948',
}

export const axisProps = { stroke: '#94a3b8', fontSize: 11, tickLine: false, axisLine: false } as const
export const gridProps = { stroke: '#eef1f6', vertical: false } as const

interface TipPayload { name?: string; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }
export function ChartTooltip({ active, payload, label, unit, labelFormatter }: { active?: boolean; payload?: TipPayload[]; label?: ReactNode; unit?: string; labelFormatter?: (l: ReactNode) => ReactNode }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-pop">
      {label !== undefined && <div className="mb-1 font-semibold text-ink-900">{labelFormatter ? labelFormatter(label) : label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-ink-700">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink-500">{p.name}</span>
          <span className="ml-auto font-medium tabular-nums text-ink-900">{typeof p.value === 'number' ? fmtNum(p.value) : p.value}{unit ?? ''}</span>
        </div>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
      {items.map((i) => <span key={i.label} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: i.color }} />{i.label}</span>)}
    </div>
  )
}

/** Horizontal bar list — magnitude by category, labelled directly (accessible without colour). */
export function BarList({ items, max, color = SEQ[4], format = fmtNum, onClick }: { items: { label: ReactNode; value: number; key?: string }[]; max?: number; color?: string; format?: (n: number) => string; onClick?: (i: number) => void }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={it.key ?? i} className={onClick ? 'cursor-pointer' : ''} onClick={() => onClick?.(i)} title={`${format(it.value)}`}>
          <div className="mb-1 flex items-center justify-between gap-3 text-[13px]">
            <span className="truncate text-ink-700">{it.label}</span>
            <span className="tabular-nums font-medium text-ink-900">{format(it.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full" style={{ width: `${(it.value / m) * 100}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  )
}
