import { ArrowLeft, Clock, DoorOpen, ExternalLink, FileText, MessageSquarePlus, Ticket, TrainFront } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { NetworkMap } from '../components/NetworkMap'
import { StationInventory } from '../components/StationInventory'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, KeyValue, LoadingBlock, PageHeader, PriorityBadge, ProvenanceBadge, StatusBadge, Tabs } from '../components/ui'
import { fileUrl } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtDate, fmtNum, titleCase } from '../lib/format'
import { useApi } from '../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function StationDetail() {
  const { id } = useParams()
  const { isStaff } = useAuth()
  const { data: s, error, loading, reload } = useApi<any>(`/api/stations/${id}`)
  const [tab, setTab] = useState<'inventory' | 'assets' | 'documents' | 'complaints'>('inventory')
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !s) return <LoadingBlock rows={6} />
  const complete = s.ridership.filter((r: any) => !r.partial)
  const lifts = s.assets.filter((a: any) => a.asset_type === 'lift').length
  const escs = s.assets.filter((a: any) => a.asset_type === 'escalator').length
  const entrances = s.assets.filter((a: any) => a.asset_type === 'station_entrance')
  return (
    <div>
      <Link to="/app/stations" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"><ArrowLeft className="size-3.5" />All stations</Link>
      <PageHeader title={s.name} description={<>Official name in GTFS: <span className="font-medium text-ink-700">{s.official_name}</span></>}
        meta={<><Badge tone="gray" className="font-mono">{s.code}</Badge>{s.lines.map((l: string) => <Badge key={l} tone={l.startsWith('Blue') ? 'blue' : 'green'}>{l}</Badge>)}<ProvenanceBadge label="DOCUMENTED" /></>}
        actions={<Button variant="primary" icon={<MessageSquarePlus className="size-4" />} onClick={() => window.dispatchEvent(new Event('megaasset:raise-complaint'))}>Report an issue here</Button>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6 min-w-0">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[['Passengers', complete.length ? fmtNum(complete[complete.length - 1].passengers) : '—', complete.length ? complete[complete.length - 1].date : 'no data'],
              ['Daily departures', fmtNum(s.service?.departures), 'GTFS stop_times (weekday)'], ['Entrances', entrances.length, 'GTFS entrance records'], ['Lift / escalator refs', `${lifts} / ${escs}`, 'From entrance descriptions']].map(([k, v, h]) => (
              <Card key={k as string}><div className="text-xs text-ink-500">{k}</div><div className="mt-1 text-xl font-semibold tabular-nums">{v}</div><div className="mt-0.5 text-[11px] text-ink-400">{h}</div></Card>))}
          </div>
          <Card padded={false}>
            <div className="px-5 pt-3"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'inventory', label: 'Inventory & activity' }, { value: 'assets', label: 'Access assets', count: s.assets.length }, { value: 'documents', label: 'Document mentions', count: s.documents.length }, ...(isStaff ? [{ value: 'complaints' as const, label: 'Complaints & tickets', count: s.complaints.length }] : [])]} /></div>
            <div className="p-5">
              {tab === 'inventory' && <StationInventory stationId={s.id} />}
              {tab === 'assets' && (!s.assets.length ? <EmptyState title="No documented assets" /> : (
                <div className="grid gap-2 md:grid-cols-2">{s.assets.map((a: any) => (
                  <Link key={a.id} to={`/app/assets/${a.id}`} className="rounded-lg border border-line p-3 hover:border-brand-300">
                    <div className="flex items-center gap-2"><Badge tone={a.asset_type === 'lift' ? 'blue' : a.asset_type === 'escalator' ? 'teal' : a.asset_type === 'accessibility_ramp' ? 'violet' : 'gray'}>{titleCase(a.asset_type)}</Badge><span className="font-mono text-[10px] text-ink-400">{a.asset_code}</span></div>
                    <div className="mt-1 text-[13px] font-medium">{a.name}</div><div className="text-xs text-ink-500">{a.description}</div></Link>))}</div>))}
              {tab === 'documents' && (!s.documents.length ? <EmptyState icon={<FileText className="size-6" />} title="No document mentions this station" description="Mentions are found by matching the station name (and curated aliases) in indexed text." /> : (
                <ul className="space-y-2">{s.documents.map((d: any) => (
                  <li key={d.document_id} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-center gap-2 text-[13px]"><FileText className="size-4 text-ink-400" /><span className="font-medium">{d.title}</span><Badge>{d.mentions} mention{d.mentions > 1 ? 's' : ''}</Badge><ProvenanceBadge label={d.provenance} /></div>
                    {d.evidence.map((e: any, i: number) => <div key={i} className="mt-1.5 text-[12.5px] text-ink-700"><span className="text-ink-400">p.{e.page}: </span>{e.excerpt} <a className="text-brand-700 hover:underline" href={fileUrl(d.document_id, e.page)} target="_blank" rel="noreferrer"><ExternalLink className="inline size-3" /></a></div>)}
                  </li>))}<li className="text-[11px] text-ink-400">Text matches show that a document mentions this station; they do not establish any physical relationship.</li></ul>))}
              {tab === 'complaints' && (!s.complaints.length ? <EmptyState icon={<Ticket className="size-6" />} title="No complaints at this station" /> : (
                <ul className="divide-y divide-line">{s.complaints.map((c: any) => (
                  <li key={c.id}><Link to={`/app/tickets/${c.ticket_id}`} className="flex items-center gap-3 py-2.5 text-[13px] hover:text-brand-700"><span className="font-mono text-xs">{c.complaint_code}</span><Badge>{titleCase(c.category)}</Badge><span className="min-w-0 flex-1 truncate text-ink-700">{c.summary}</span>{c.status && <StatusBadge status={c.status} />}{c.priority && <PriorityBadge priority={c.priority} />}<span className="text-xs text-ink-400">{fmtDate(c.created_at, false)}</span></Link></li>))}</ul>))}
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card padded={false}><div className="p-3"><NetworkMap height={340} highlight={s.id} /></div></Card>
          <Card><CardHeader title="Service (GTFS timetable)" icon={<TrainFront className="size-4" />} />
            {s.service ? <KeyValue cols={1} items={[['First departure', <span className="flex items-center gap-1"><Clock className="size-3.5 text-ink-400" />{s.service.first}</span>], ['Last departure', s.service.last], ['Routes serving', s.service.routes.join(', ')]]} /> : <div className="text-sm text-ink-500">No timetable records.</div>}
            <div className="mt-3 text-[11px] text-ink-400">Timetable validity per the feed's calendar.txt; may not reflect current operations.</div></Card>
          <Card><CardHeader title="Entrances" icon={<DoorOpen className="size-4" />} />
            <ul className="space-y-1.5 text-[13px]">{entrances.map((e: any) => <li key={e.id} className="flex gap-2"><Badge tone="gray">{e.attributes.entrance}</Badge><span className="text-ink-700">{e.description}</span></li>)}</ul></Card>
          <Card><CardHeader title="Provenance" /><div className="text-xs text-ink-500">{s.source}<br />Aliases used for text matching: {s.aliases.join(', ')}</div></Card>
        </div>
      </div>
    </div>
  )
}
