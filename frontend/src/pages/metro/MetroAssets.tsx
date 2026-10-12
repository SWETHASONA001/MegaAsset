import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LINE_COLOURS } from '../../components/charts'
import { NetworkMap } from '../../components/NetworkMap'
import { Card, CardHeader, cx, ErrorState, LoadingBlock, PageHeader, ProvenanceBadge, Select } from '../../components/ui'
import { useApi } from '../../lib/hooks'

interface S { id: number; code: string; name: string; lines: string[]; assets: Record<string, number>; lat: number; lon: number }
const METRICS = { lift: 'Lift references', escalator: 'Escalator references', accessibility_ramp: 'Ramp references', station_entrance: 'Entrances' } as const

export default function MetroAssets() {
  const { data, error, loading, reload } = useApi<{ items: S[] }>('/api/stations')
  const [metric, setMetric] = useState<keyof typeof METRICS>('lift')
  const values = useMemo(() => Object.fromEntries((data?.items ?? []).map((s) => [s.id, s.assets[metric] ?? 0]).filter(([, v]) => v)), [data, metric])
  const byLine = useMemo(() => {
    const g: Record<string, S[]> = {}
    for (const s of data?.items ?? []) for (const l of (s.lines.length ? s.lines : ['Unassigned'])) (g[l] ??= []).push(s)
    Object.values(g).forEach((arr) => arr.sort((a, b) => b.lat - a.lat))
    return g
  }, [data])
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !data) return <LoadingBlock rows={6} />
  const total = (k: string) => data.items.reduce((a, s) => a + (s.assets[k] ?? 0), 0)
  const max = Math.max(1, ...data.items.map((s) => s.assets[metric] ?? 0))
  return (
    <div>
      <PageHeader eyebrow="Infrastructure" title="Network & assets" description="The CMRL network drawn from GTFS geometry, with documented access assets per station. Marker size encodes the selected asset count."
        meta={<ProvenanceBadge label="DOCUMENTED" />}
        actions={<Select value={metric} onChange={(e) => setMetric(e.target.value as keyof typeof METRICS)} className="w-56">{Object.entries(METRICS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>} />
      <div className="grid gap-4 sm:grid-cols-4">
        {Object.entries(METRICS).map(([k, v]) => <button key={k} onClick={() => setMetric(k as keyof typeof METRICS)} className={cx('rounded-xl border bg-white p-4 text-left shadow-card transition', metric === k ? 'border-brand-400 ring-2 ring-brand-100' : 'border-line hover:border-brand-200')}>
          <div className="text-xs text-ink-500">{v}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{total(k)}</div></button>)}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card padded={false}><div className="p-3"><NetworkMap height={640} values={values} valueLabel={METRICS[metric]} /></div></Card>
        <Card className="max-h-[680px] overflow-y-auto thin-scroll">
          <CardHeader title="Stations by line" subtitle={`${METRICS[metric]} per station (north → south)`} />
          {Object.entries(byLine).map(([line, ss]) => (
            <div key={line} className="mb-5">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-500"><span className="h-2 w-6 rounded-full" style={{ background: LINE_COLOURS[line] ?? '#94a3b8' }} />{line} · {ss.length}</div>
              <ul className="space-y-1">{ss.map((s) => (
                <li key={s.id}><Link to={`/app/stations/${s.id}`} className="grid grid-cols-[1fr_120px_28px] items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-slate-50">
                  <span className="truncate">{s.name}</span>
                  <span className="h-1.5 rounded-full bg-slate-100"><span className="block h-1.5 rounded-full bg-brand-500" style={{ width: `${((s.assets[metric] ?? 0) / max) * 100}%` }} /></span>
                  <span className="text-right tabular-nums text-ink-500">{s.assets[metric] ?? 0}</span></Link></li>))}</ul>
            </div>))}
          <div className="text-[11px] text-ink-400">Counts are references in GTFS entrance descriptions — they indicate presence near an entrance, not the number of physical units.</div>
        </Card>
      </div>
    </div>
  )
}
