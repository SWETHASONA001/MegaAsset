import { Building2, LayoutGrid, List, Map as MapIcon, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LINE_COLOURS } from '../components/charts'
import { NetworkMap } from '../components/NetworkMap'
import { Badge, Card, cx, EmptyState, ErrorState, Input, LoadingBlock, PageHeader, ProvenanceBadge, Select } from '../components/ui'
import { useAuth } from '../lib/auth'
import { fmtNum } from '../lib/format'
import { useApi } from '../lib/hooks'

interface S { id: number; code: string; name: string; official_name: string; lines: string[]; assets: Record<string, number>; complaints: number; open_tickets: number; passengers: number | null; service: { departures: number; first: string; last: string } | null; source: string }

export default function Stations() {
  const { isStaff } = useAuth()
  const { data, error, loading, reload } = useApi<{ ridership_date: string | null; items: S[] }>('/api/stations')
  const [q, setQ] = useState('')
  const [line, setLine] = useState('')
  const [view, setView] = useState<'grid' | 'table' | 'map'>('grid')
  const [sort, setSort] = useState<'name' | 'passengers' | 'complaints'>('name')
  const items = useMemo(() => {
    let x = (data?.items ?? []).filter((s) => (!q || `${s.name} ${s.code}`.toLowerCase().includes(q.toLowerCase())) && (!line || s.lines.includes(line)))
    if (sort === 'passengers') x = [...x].sort((a, b) => (b.passengers ?? -1) - (a.passengers ?? -1))
    if (sort === 'complaints') x = [...x].sort((a, b) => b.complaints - a.complaints)
    return x
  }, [data, q, line, sort])
  const values = useMemo(() => Object.fromEntries((data?.items ?? []).filter((s) => s.passengers).map((s) => [s.id, s.passengers!])), [data])
  if (error) return <ErrorState message={error} onRetry={reload} />
  return (
    <div>
      <PageHeader eyebrow="Infrastructure" title="Stations" description="All CMRL stations from the GTFS feed (location_type = 1), enriched with documented access assets, station passenger counts and complaint activity."
        meta={<><ProvenanceBadge label="DOCUMENTED" /><span className="text-xs text-ink-500">{data?.items.length ?? '—'} stations · passenger counts for {data?.ridership_date ?? 'n/a'} (passenger-flow workbook)</span></>} />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" /><Input className="pl-9" placeholder="Search stations…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select className="md:w-40" value={line} onChange={(e) => setLine(e.target.value)}><option value="">All lines</option><option>Blue Line</option><option>Green Line</option></Select>
        <Select className="md:w-48" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="name">Sort: name</option><option value="passengers">Sort: passengers</option>{isStaff && <option value="complaints">Sort: complaints</option>}</Select>
        <div className="flex rounded-lg border border-line bg-white p-0.5">
          {([['grid', LayoutGrid], ['table', List], ['map', MapIcon]] as const).map(([v, I]) => <button key={v} aria-label={`${v} view`} onClick={() => setView(v)} className={cx('rounded-md p-1.5', view === v ? 'bg-brand-700 text-white' : 'text-ink-500 hover:text-ink-900')}><I className="size-4" /></button>)}
        </div>
      </div>
      {loading ? <LoadingBlock rows={6} /> : !items.length ? <EmptyState icon={<Building2 className="size-6" />} title="No stations match" /> : view === 'map' ? (
        <Card><NetworkMap height={620} values={values} valueLabel="Passengers" /></Card>
      ) : view === 'table' ? (
        <Card padded={false}><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-line bg-slate-50/60 text-xs text-ink-500"><tr><th className="px-4 py-2.5 text-left font-medium">Station</th><th className="px-4 py-2.5 text-left font-medium">Lines</th><th className="px-4 py-2.5 text-right font-medium">Passengers</th><th className="px-4 py-2.5 text-right font-medium">Daily departures (GTFS)</th><th className="px-4 py-2.5 text-right font-medium">Lifts / Esc. refs</th>{isStaff && <th className="px-4 py-2.5 text-right font-medium">Open tickets</th>}</tr></thead>
          <tbody className="divide-y divide-line">{items.map((s) => (
            <tr key={s.id} className="hover:bg-brand-50/30"><td className="px-4 py-2.5"><Link to={`/app/stations/${s.id}`} className="font-medium hover:text-brand-700">{s.name}</Link><div className="font-mono text-[11px] text-ink-400">{s.code}</div></td>
              <td className="px-4 py-2.5">{s.lines.map((l) => <Badge key={l} className="mr-1" tone={l.startsWith('Blue') ? 'blue' : 'green'}>{l}</Badge>)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(s.passengers)}</td><td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(s.service?.departures)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{s.assets.lift ?? 0} / {s.assets.escalator ?? 0}</td>{isStaff && <td className="px-4 py-2.5 text-right tabular-nums">{s.open_tickets}</td>}</tr>))}</tbody></table></div></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {items.map((s) => (
            <Link key={s.id} to={`/app/stations/${s.id}`}>
              <Card className="h-full transition hover:border-brand-200 hover:shadow-pop">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="truncate font-semibold text-ink-900" title={s.official_name}>{s.name}</div><div className="mt-0.5 font-mono text-[11px] text-ink-400">{s.code}</div></div>
                  <div className="flex gap-1">{s.lines.map((l) => <span key={l} title={l} className="h-5 w-1.5 rounded-full" style={{ background: LINE_COLOURS[l] ?? '#94a3b8' }} />)}</div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 py-2"><div className="text-sm font-semibold tabular-nums">{s.passengers ? (s.passengers / 1000).toFixed(1) + 'k' : '—'}</div><div className="text-[10px] text-ink-500">passengers</div></div>
                  <div className="rounded-lg bg-slate-50 py-2"><div className="text-sm font-semibold tabular-nums">{(s.assets.lift ?? 0) + (s.assets.escalator ?? 0)}</div><div className="text-[10px] text-ink-500">lift/esc refs</div></div>
                  <div className={cx('rounded-lg py-2', s.open_tickets ? 'bg-amber-50' : 'bg-slate-50')}><div className="text-sm font-semibold tabular-nums">{isStaff ? s.open_tickets : (s.assets.station_entrance ?? 0)}</div><div className="text-[10px] text-ink-500">{isStaff ? 'open tickets' : 'entrances'}</div></div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
