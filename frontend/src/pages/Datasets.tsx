import { Database, Globe2, RefreshCw, TrainFront } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, CardHeader, cx, ErrorState, LoadingBlock, Notice, PageHeader, ProvenanceBadge, Select, StatusBadge, useToast } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtDate, fmtNum } from '../lib/format'
import { useApi } from '../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
function Preview({ slug }: { slug: string }) {
  const [table, setTable] = useState('')
  const { data, loading } = useApi<any>(`/api/datasets/${slug}/preview${table ? `?table=${encodeURIComponent(table)}` : ''}`)
  if (loading || !data) return <LoadingBlock rows={3} />
  return (
    <div>
      {data.tables.length > 1 && <Select className="mb-2 w-64" value={data.table} onChange={(e) => setTable(e.target.value)}>{data.tables.map((t: string) => <option key={t}>{t}</option>)}</Select>}
      <div className="max-h-80 overflow-auto rounded-lg border border-line thin-scroll">
        <table className="min-w-full text-[11.5px]"><thead className="sticky top-0 bg-slate-50 text-ink-500"><tr><th className="px-2 py-1.5 text-left">#</th>{data.columns.map((c: string) => <th key={c} className="whitespace-nowrap px-2 py-1.5 text-left font-medium">{c}</th>)}</tr></thead>
          <tbody>{data.rows.map((r: any[], i: number) => <tr key={i} className="border-t border-line"><td className="px-2 py-1 text-ink-400">{i + 2}</td>{r.map((v, j) => <td key={j} className="whitespace-nowrap px-2 py-1 tabular-nums">{String(v ?? '')}</td>)}</tr>)}</tbody></table>
      </div>
      <div className="mt-1 text-[11px] text-ink-400">First {data.rows.length} rows of {data.table}, read directly from the raw file (row numbers include the header row).</div>
    </div>
  )
}

export default function Datasets() {
  const { user } = useAuth()
  const toast = useToast()
  const { data, error, loading, reload } = useApi<any[]>('/api/datasets')
  const [open, setOpen] = useState<string | null>(null)
  if (error) return <ErrorState message={error} onRetry={reload} />
  return (
    <div>
      <PageHeader eyebrow="Data & models" title="Datasets" description="Structured transit data processed from the workspace. Raw files are read-only; derived tables record the source row of every value."
        actions={user?.role === 'admin' && <Button icon={<RefreshCw className="size-4" />} onClick={async () => { await api('/api/datasets/reprocess', { method: 'POST' }); toast({ tone: 'success', message: 'Dataset reprocessing queued' }) }}>Reprocess</Button>} />
      <Notice title="Scope separation">The Chennai-wide multimodal GTFS (MTC bus and other agencies) is kept separate and is never used to derive CMRL stations, assets or KPIs.</Notice>
      <div className="mt-5 space-y-4">
        {loading || !data ? <LoadingBlock /> : data.map((d) => (
          <Card key={d.slug}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-3">
                <span className={cx('mt-0.5 rounded-lg p-2', d.scope === 'CMRL_ONLY' ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700')}>{d.kind === 'GTFS' ? (d.scope === 'CMRL_ONLY' ? <TrainFront className="size-5" /> : <Globe2 className="size-5" />) : <Database className="size-5" />}</span>
                <div><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{d.name}</span><Badge tone={d.scope === 'CMRL_ONLY' ? 'brand' : 'amber'}>{d.scope === 'CMRL_ONLY' ? 'CMRL only' : 'Chennai-wide'}</Badge><Badge>{d.kind}</Badge><StatusBadge status={d.status} /><ProvenanceBadge label={d.provenance} /></div>
                  <div className="mt-1 text-[13px] text-ink-500">{d.description}</div>
                  <div className="mt-1 font-mono text-[11px] text-ink-400">{d.rel_path} · processed {fmtDate(d.processed_at)}</div></div>
              </div>
              <div className="text-right"><div className="text-xl font-semibold tabular-nums">{fmtNum(d.row_count)}</div><div className="text-xs text-ink-500">rows</div></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">{d.tables.map((t: any) => <span key={t.name} title={t.columns.join(', ')} className="rounded-md border border-line px-2 py-0.5 text-[11px]">{t.name} <span className="text-ink-400">{fmtNum(t.rows)}</span></span>)}</div>
            {d.stats?.unmatched_station_names?.length > 0 && <div className="mt-2 text-xs text-amber-700">Unmatched station names (not linked to GTFS stations): {d.stats.unmatched_station_names.join(', ')}</div>}
            {d.stats?.agencies && <div className="mt-2 text-xs text-ink-500">Agencies: {d.stats.agencies.map((a: any) => `${a.name} (${a.routes} routes)`).join(' · ')}</div>}
            {d.stats?.note && <div className="mt-2 text-xs text-ink-500">{d.stats.note}</div>}
            <div className="mt-3"><Button size="sm" variant="ghost" onClick={() => setOpen(open === d.slug ? null : d.slug)}>{open === d.slug ? 'Hide preview' : 'Preview raw rows'}</Button></div>
            {open === d.slug && <div className="mt-2"><Preview slug={d.slug} /></div>}
          </Card>
        ))}
      </div>
      <Card className="mt-6"><CardHeader title="Not available in the workspace" />
        <div className="text-[13px] text-ink-500">No live feeds, SCADA/sensor telemetry, maintenance work-order history or historical incident logs are present. Screens that depend on them show labelled empty states rather than simulated data.</div></Card>
    </div>
  )
}
