import { Clock, TrainFront, TrendingUp, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisProps, BarList, ChartTooltip, gridProps, Legend, LINE_COLOURS, SEQ, SERIES } from '../../components/charts'
import { Badge, Card, CardHeader, cx, ErrorState, LoadingBlock, PageHeader, ProvenanceBadge, Stat } from '../../components/ui'
import { compact, fmtNum } from '../../lib/format'
import { useApi } from '../../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Operations() {
  const { data: r, error, loading, reload } = useApi<any>('/api/operations/ridership')
  const { data: svc } = useApi<any>('/api/operations/service')
  const [mediaView, setMediaView] = useState<'share' | 'abs'>('abs')
  const [table, setTable] = useState(false)
  const hourly = useMemo(() => (r?.hourly ?? []).filter((h: any) => !h.partial), [r])
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !r) return <LoadingBlock rows={8} />
  const d = r.derived
  const monthly = r.monthly.map((m: any) => ({ ...m, closed_pct: m.total ? (m.closed_loop / m.total) * 100 : null, qr_pct: m.total ? (m.qr / m.total) * 100 : null, ncmc_pct: m.total ? (m.ncmc / m.total) * 100 : null }))
  const media = [{ key: mediaView === 'abs' ? 'closed_loop' : 'closed_pct', label: 'Closed-loop card', color: SERIES[0] }, { key: mediaView === 'abs' ? 'qr' : 'qr_pct', label: 'QR tickets', color: SERIES[1] }, { key: mediaView === 'abs' ? 'ncmc' : 'ncmc_pct', label: 'NCMC', color: SERIES[2] }]
  const summary = r.summary?.find((s: any) => s.day_label === 'last complete day')
  return (
    <div>
      <PageHeader eyebrow="Metro operations" title="Operations" description="Ridership, ticket-media mix, hourly passenger flow and timetable service levels — computed from the CMRL ridership CSV, the passenger-flow workbook and the CMRL GTFS feed." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={`Passengers · ${d.latest_month ?? '—'}`} value={compact(d.latest_total)} hint="Monthly total passenger flow" icon={<Users className="size-4" />} />
        <Stat label="Month-on-month" value={d.mom_change_pct !== undefined ? `${d.mom_change_pct > 0 ? '+' : ''}${d.mom_change_pct}%` : '—'} hint="vs previous month (PROCESSED)" icon={<TrendingUp className="size-4" />} />
        <Stat label="Year-on-year" value={d.yoy_change_pct !== undefined ? `${d.yoy_change_pct > 0 ? '+' : ''}${d.yoy_change_pct}%` : '—'} hint={d.yoy_month ? `vs ${d.yoy_month}` : 'insufficient history'} icon={<TrendingUp className="size-4" />} />
        <Stat label="Scheduled trips (GTFS)" value={fmtNum(svc?.trips)} hint={`${svc?.routes ?? '—'} routes · ${svc?.stations ?? '—'} stations`} icon={<TrainFront className="size-4" />} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Monthly passenger flow by ticket media" subtitle="Source: cmrl_monthly_ridership.csv" action={<div className="flex items-center gap-2"><ProvenanceBadge label="DOCUMENTED" />
            <div className="flex rounded-lg border border-line p-0.5 text-xs">{(['abs', 'share'] as const).map((v) => <button key={v} onClick={() => setMediaView(v)} className={cx('rounded-md px-2 py-0.5', mediaView === v ? 'bg-brand-700 text-white' : 'text-ink-500')}>{v === 'abs' ? 'Passengers' : 'Share %'}</button>)}</div>
            <button onClick={() => setTable(!table)} className="text-xs font-medium text-brand-700">{table ? 'Chart' : 'Table'}</button></div>} />
          <div className="mb-2"><Legend items={media.map((m) => ({ label: m.label, color: m.color }))} /></div>
          {table ? (
            <div className="max-h-72 overflow-y-auto thin-scroll"><table className="w-full text-xs"><thead className="sticky top-0 bg-white text-ink-500"><tr><th className="py-1 text-left">Month</th><th className="text-right">Closed loop</th><th className="text-right">QR</th><th className="text-right">NCMC</th><th className="text-right">Total</th><th className="text-right">CSV row</th></tr></thead>
              <tbody>{monthly.map((m: any) => <tr key={m.month} className="border-t border-line"><td className="py-1">{m.month}</td><td className="text-right tabular-nums">{fmtNum(m.closed_loop)}</td><td className="text-right tabular-nums">{fmtNum(m.qr)}</td><td className="text-right tabular-nums">{fmtNum(m.ncmc)}</td><td className="text-right font-medium tabular-nums">{fmtNum(m.total)}</td><td className="text-right text-ink-400">{m.source_row}</td></tr>)}</tbody></table></div>
          ) : (
            <div className="h-72"><ResponsiveContainer>
              <LineChart data={monthly} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid {...gridProps} /><XAxis dataKey="month" {...axisProps} interval={3} />
                <YAxis {...axisProps} tickFormatter={(v: number) => (mediaView === 'abs' ? compact(v) : `${v.toFixed(0)}%`)} />
                <Tooltip content={<ChartTooltip unit={mediaView === 'share' ? '%' : ''} />} />
                {media.map((m) => <Line key={m.key} type="monotone" dataKey={m.key} name={m.label} stroke={m.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />)}
              </LineChart></ResponsiveContainer></div>
          )}
        </Card>
        <Card>
          <CardHeader title="Line split" subtitle={`Station passengers on ${r.station_date ?? '—'}`} action={<ProvenanceBadge label="PROCESSED" />} />
          <BarList items={Object.entries(r.by_line as Record<string, number>).map(([k, v]) => ({ label: k, value: v }))} />
          {summary && <div className="mt-4 space-y-1.5 rounded-lg bg-slate-50 p-3 text-xs text-ink-700">
            <div className="flex justify-between"><span className="text-ink-500">Network total (workbook summary)</span><b>{fmtNum(summary.network_total_passengers)}</b></div>
            <div className="flex justify-between"><span className="text-ink-500">Busiest station</span><b>{summary.busiest_station} ({fmtNum(summary.busiest_station_passengers)})</b></div>
            <div className="flex justify-between"><span className="text-ink-500">Quietest station</span><b>{summary.quietest_station} ({fmtNum(summary.quietest_station_passengers)})</b></div>
            <div className="flex justify-between"><span className="text-ink-500">Stations reporting</span><b>{summary.stations_reporting}</b></div></div>}
          <div className="mt-2 text-[11px] text-ink-400">Partial (in-progress) service days in the workbook are excluded.</div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Hourly network passenger flow" subtitle={`Complete service day${hourly[0] ? ` · ${hourly[0].date}` : ''}`} icon={<Clock className="size-4" />} action={<ProvenanceBadge label="DOCUMENTED" />} />
          <div className="h-64"><ResponsiveContainer>
            <BarChart data={hourly} margin={{ left: -10, right: 4, top: 8 }}><CartesianGrid {...gridProps} /><XAxis dataKey="hour" {...axisProps} tickFormatter={(h: number) => `${h}:00`} interval={2} />
              <YAxis {...axisProps} tickFormatter={(v: number) => compact(v)} /><Tooltip content={<ChartTooltip labelFormatter={(l) => `${l}:00–${l}:59`} />} cursor={{ fill: '#f1f5f9' }} />
              <Bar dataKey="total" name="Passengers" fill={SEQ[4]} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </Card>
        <Card>
          <CardHeader title="Busiest stations" subtitle={`Passengers on ${r.station_date ?? '—'} · chennai_metro_phase1_ridership.xlsx`} action={<ProvenanceBadge label="DOCUMENTED" />} />
          <BarList items={r.stations.slice(0, 10).map((s: any) => ({ label: <span>{s.station_name} <span className="text-[10px] text-ink-400">({s.line})</span></span>, value: s.passengers, key: s.station_name }))} />
        </Card>
      </div>

      {svc?.available && (
        <Card className="mt-6">
          <CardHeader title="Timetable service by route (GTFS)" subtitle={svc.note} action={<ProvenanceBadge label="PROCESSED" />} />
          <div className="mb-4 flex flex-wrap gap-3">{Object.entries(svc.by_line as Record<string, any>).map(([l, v]) => <div key={l} className="rounded-lg border border-line px-3 py-2 text-xs"><span className="mr-1.5 inline-block h-2 w-4 rounded-full align-middle" style={{ background: LINE_COLOURS[l] ?? '#94a3b8' }} /><b>{l}</b> · {v.routes} routes · {fmtNum(v.trips)} trips</div>)}</div>
          <div className="max-h-72 overflow-y-auto thin-scroll"><table className="w-full text-[13px]"><thead className="sticky top-0 bg-white text-xs text-ink-500"><tr><th className="py-1.5 text-left">Route</th><th className="text-left">Name</th><th className="text-left">Line</th><th className="text-right">Trips</th></tr></thead>
            <tbody>{[...svc.route_stats].sort((a: any, b: any) => b.trips - a.trips).map((x: any) => <tr key={x.route_id} className="border-t border-line"><td className="py-1.5 font-mono text-xs">{x.short_name}</td><td className="text-ink-700">{x.long_name}</td><td><Badge tone={x.line.startsWith('Blue') ? 'blue' : x.line.startsWith('Green') ? 'green' : 'gray'}>{x.line.split(' (')[0]}</Badge></td><td className="text-right tabular-nums">{x.trips}</td></tr>)}</tbody></table></div>
          <div className="mt-2 text-[11px] text-ink-400">Service calendar: {svc.calendar?.map((c: any) => `${c.service_id} ${c.start_date}–${c.end_date}`).join('; ')}</div>
        </Card>
      )}
    </div>
  )
}
