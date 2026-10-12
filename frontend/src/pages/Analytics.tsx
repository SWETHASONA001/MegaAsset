import { BarChart3 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisProps, BarList, ChartTooltip, gridProps, Legend, SEQ, SERIES } from '../components/charts'
import { Card, CardHeader, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader, ProvenanceBadge, Stat } from '../components/ui'
import { fmtNum, titleCase } from '../lib/format'
import { useApi } from '../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Analytics() {
  const { data: a, error, loading, reload } = useApi<any>('/api/analytics')
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !a) return <LoadingBlock rows={8} />
  const cats: string[] = Array.from(new Set(a.station_category.flatMap((r: any) => Object.keys(r).filter((k) => k !== 'station' && k !== 'total')))) as string[]
  const shown = cats.slice(0, 7)
  const tis = Object.entries(a.time_in_status_hours as Record<string, number>).map(([k, v]) => ({ status: titleCase(k), hours: v }))
  return (
    <div>
      <PageHeader eyebrow="Data & models" title="Analytics" description="Service performance computed from platform records and document coverage from ingestion records." meta={<ProvenanceBadge label="PROCESSED" />} />
      <Notice>{a.provenance_note}</Notice>
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Tickets" value={fmtNum(a.ticket_count)} />
        <Stat label="Median time to resolution" value={a.resolution_hours.median !== null ? `${a.resolution_hours.median.toFixed(1)} h` : '—'} hint={`${a.resolution_hours.count} resolved ticket(s)`} />
        <Stat label="Reopen rate" value={a.reopen_rate !== null ? `${(a.reopen_rate * 100).toFixed(1)}%` : '—'} hint="Tickets reopened at least once" />
        <Stat label="Verification outcomes" value={`${a.verification_outcomes.RESOLVED ?? 0} / ${a.verification_outcomes.STILL_EXISTS ?? 0}`} hint="Resolved / still exists" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Complaints by station and category" subtitle="Top stations (stacked)" />
          {!a.station_category.length ? <EmptyState icon={<BarChart3 className="size-6" />} title="No ticket data yet" /> : (
            <>
              <div className="mb-2"><Legend items={shown.map((c, i) => ({ label: c, color: SERIES[i] }))} /></div>
              <div className="h-72"><ResponsiveContainer><BarChart data={a.station_category} margin={{ left: -16, right: 8 }}>
                <CartesianGrid {...gridProps} /><XAxis dataKey="station" {...axisProps} interval={0} angle={-25} textAnchor="end" height={60} /><YAxis {...axisProps} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
                {shown.map((c, i) => <Bar key={c} dataKey={c} stackId="a" fill={SERIES[i]} stroke="#fff" strokeWidth={2} name={c} radius={i === shown.length - 1 ? [4, 4, 0, 0] : undefined} />)}
              </BarChart></ResponsiveContainer></div>
            </>)}
        </Card>
        <Card><CardHeader title="Open tickets by team" />{Object.keys(a.open_by_team).length ? <BarList items={Object.entries(a.open_by_team as Record<string, number>).sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ label: k, value: v }))} /> : <div className="text-sm text-ink-500">No open tickets.</div>}
          <div className="mt-5"><CardHeader title="Complaint language" /><BarList items={Object.entries(a.languages as Record<string, number>).map(([k, v]) => ({ label: k === 'ta' ? 'Tamil' : 'English', value: v }))} /></div></Card>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card><CardHeader title="Average time in status" subtitle="Hours between lifecycle transitions" />
          {!tis.length ? <div className="text-sm text-ink-500">Needs at least one status transition.</div> : <div className="h-60"><ResponsiveContainer><BarChart data={tis} layout="vertical" margin={{ left: 60 }}>
            <XAxis type="number" {...axisProps} /><YAxis type="category" dataKey="status" {...axisProps} width={140} /><Tooltip content={<ChartTooltip unit=" h" />} cursor={{ fill: '#f1f5f9' }} />
            <Bar dataKey="hours" name="Avg hours" fill={SEQ[4]} radius={[0, 4, 4, 0]} barSize={14} /></BarChart></ResponsiveContainer></div>}</Card>
        <Card><CardHeader title="Document coverage" subtitle="Indexed documents by category" />
          <table className="w-full text-[13px]"><thead className="text-xs text-ink-500"><tr><th className="py-1 text-left">Category</th><th className="text-right">Docs</th><th className="text-right">Pages</th><th className="text-right">OCR pages</th><th className="text-right">Passages</th></tr></thead>
            <tbody>{a.documents.map((d: any) => <tr key={d.category} className="border-t border-line"><td className="py-1.5">{d.category}</td><td className="text-right tabular-nums">{d.documents}</td><td className="text-right tabular-nums">{fmtNum(d.pages)}</td><td className="text-right tabular-nums">{fmtNum(d.ocr_pages)}</td><td className="text-right tabular-nums">{fmtNum(d.chunks)}</td></tr>)}</tbody></table></Card>
      </div>
    </div>
  )
}
