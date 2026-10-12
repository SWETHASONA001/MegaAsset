import { Boxes, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Card, cx, EmptyState, ErrorState, Input, LoadingBlock, Notice, PageHeader, Pagination, ProvenanceBadge, Select } from '../components/ui'
import { qs } from '../lib/api'
import { titleCase } from '../lib/format'
import { useApi, useDebounced } from '../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
export const ASSET_TONE: Record<string, string> = { lift: 'blue', escalator: 'teal', accessibility_ramp: 'violet', station_entrance: 'gray' }

export default function Assets() {
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [page, setPage] = useState(1)
  const type = sp.get('type') ?? ''
  const station = sp.get('station_id') ?? ''
  useEffect(() => setPage(1), [dq, type, station])
  const { data, error, loading, reload } = useApi<any>(`/api/assets${qs({ q: dq, asset_type: type, station_id: station, page, page_size: 30 })}`)
  const { data: stations } = useApi<{ items: { id: number; name: string }[] }>('/api/stations')
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }) }
  return (
    <div>
      <PageHeader eyebrow="Infrastructure" title="Asset registry" description="Assets documented in the CMRL GTFS feed: station entrances, plus the lifts, escalators and accessibility ramps referenced in entrance descriptions." />
      <Notice>Only assets evidenced in workspace data are listed. Make, model, condition and maintenance history are not available in the source data, so they are not shown or estimated.</Notice>
      <div className="my-4 flex flex-wrap gap-2">
        <button onClick={() => set('type', '')} className={cx('rounded-full border px-3 py-1 text-xs font-medium', !type ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-line bg-white text-ink-500')}>All <span className="text-ink-400">{data ? Object.values(data.types as Record<string, number>).reduce((a, b) => a + b, 0) : ''}</span></button>
        {data && Object.entries(data.types as Record<string, number>).map(([t, n]) => (
          <button key={t} onClick={() => set('type', t)} className={cx('rounded-full border px-3 py-1 text-xs font-medium', type === t ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-line bg-white text-ink-500')}>{titleCase(t)} <span className="text-ink-400">{n}</span></button>))}
      </div>
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" /><Input className="pl-9" placeholder="Search asset name, code or description…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select className="md:w-64" value={station} onChange={(e) => set('station_id', e.target.value)}><option value="">All stations</option>{stations?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </div>
        {error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : loading && !data ? <div className="p-4"><LoadingBlock /></div> : !data?.items.length ? <div className="p-6"><EmptyState icon={<Boxes className="size-6" />} title="No assets match" /></div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm">
            <thead className="border-b border-line bg-slate-50/60 text-xs text-ink-500"><tr><th className="px-4 py-2.5 text-left font-medium">Asset</th><th className="px-4 py-2.5 text-left font-medium">Type</th><th className="px-4 py-2.5 text-left font-medium">Station</th><th className="px-4 py-2.5 text-left font-medium">Source</th><th className="px-4 py-2.5 text-left font-medium">Provenance</th></tr></thead>
            <tbody className="divide-y divide-line">{data.items.map((a: any) => (
              <tr key={a.id} className="hover:bg-brand-50/30"><td className="px-4 py-2.5"><Link to={`/app/assets/${a.id}`} className="font-medium hover:text-brand-700">{a.name}</Link><div className="font-mono text-[10.5px] text-ink-400">{a.asset_code}</div></td>
                <td className="px-4 py-2.5"><Badge tone={ASSET_TONE[a.asset_type]}>{titleCase(a.asset_type)}</Badge></td>
                <td className="px-4 py-2.5">{a.station && <Link to={`/app/stations/${a.station.id}`} className="hover:text-brand-700">{a.station.name}</Link>}</td>
                <td className="px-4 py-2.5 text-xs text-ink-500">{a.source.replace('data/raw/cmrl/gtfs/', '')}</td><td className="px-4 py-2.5"><ProvenanceBadge label={a.provenance} /></td></tr>))}</tbody></table></div>
        )}
        {data && data.total > 0 && <div className="border-t border-line px-4 pb-3"><Pagination page={page} pageSize={30} total={data.total} onPage={setPage} /></div>}
      </Card>
    </div>
  )
}
