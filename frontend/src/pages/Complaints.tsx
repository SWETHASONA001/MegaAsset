import { Languages, MessagesSquare, Paperclip, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarList } from '../components/charts'
import { Badge, Card, CardHeader, EmptyState, ErrorState, Input, LoadingBlock, PageHeader, Pagination, PriorityBadge, ProvenanceBadge, StatusBadge } from '../components/ui'
import { qs } from '../lib/api'
import { fmtDate } from '../lib/format'
import { useApi, useDebounced } from '../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Complaints() {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [dq])
  const { data, error, loading, reload } = useApi<{ total: number; items: any[] }>(`/api/complaints${qs({ q: dq, page, page_size: 12 })}`)
  const { data: all } = useApi<{ total: number; items: any[] }>('/api/complaints?page_size=100')
  const nav = useNavigate()
  const byCat: Record<string, number> = {}
  const byLang: Record<string, number> = {}
  let withMedia = 0
  for (const c of all?.items ?? []) { byCat[c.category_label.en] = (byCat[c.category_label.en] ?? 0) + 1; byLang[c.language] = (byLang[c.language] ?? 0) + 1; if (c.attachments.length) withMedia++ }
  return (
    <div>
      <PageHeader eyebrow="Passenger voice" title="Complaints" description="All passenger complaints as submitted. Complaints are REPORTED information — they are investigated, not assumed to be verified incidents." />
      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <Card padded={false}>
          <div className="border-b border-line p-4"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" /><Input className="pl-9" placeholder="Search complaint text or ID…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
          {error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : loading && !data ? <div className="p-4"><LoadingBlock /></div> : !data?.items.length ? (
            <div className="p-6"><EmptyState icon={<MessagesSquare className="size-6" />} title="No complaints" description="Complaints submitted through the Raise a Complaint assistant appear here." /></div>
          ) : (
            <ul className="divide-y divide-line">
              {data.items.map((c) => (
                <li key={c.id} onClick={() => nav(c.ticket ? `/app/tickets/${c.ticket.id}` : `/app/complaints/${c.id}`)} className="cursor-pointer px-5 py-4 hover:bg-brand-50/30">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] font-semibold">{c.complaint_code}</span>
                    {c.ticket && <StatusBadge status={c.ticket.status} />}{c.ticket && <PriorityBadge priority={c.ticket.priority} />}
                    <Badge>{c.category_label.en}</Badge>{c.language === 'ta' && <Badge tone="violet">தமிழ்</Badge>}
                    {c.attachments.length > 0 && <span className="flex items-center gap-0.5 text-xs text-ink-400"><Paperclip className="size-3" />{c.attachments.length}</span>}
                    <span className="ml-auto text-xs text-ink-400">{fmtDate(c.created_at)}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13.5px] text-ink-700">{c.description}</p>
                  <div className="mt-1 text-xs text-ink-500">{c.station?.name} · {c.user?.full_name}</div>
                </li>
              ))}
            </ul>
          )}
          {data && data.total > 0 && <div className="border-t border-line px-4 pb-3"><Pagination page={page} pageSize={12} total={data.total} onPage={setPage} /></div>}
        </Card>
        <div className="space-y-6">
          <Card><CardHeader title="By category" action={<ProvenanceBadge label="REPORTED" />} />{Object.keys(byCat).length ? <BarList items={Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v }))} /> : <div className="text-sm text-ink-500">No data yet.</div>}</Card>
          <Card><CardHeader title="Channel mix" icon={<Languages className="size-4" />} />
            <div className="space-y-2 text-sm"><div className="flex justify-between"><span className="text-ink-500">English</span><b>{byLang.en ?? 0}</b></div><div className="flex justify-between"><span className="text-ink-500">Tamil</span><b>{byLang.ta ?? 0}</b></div><div className="flex justify-between"><span className="text-ink-500">With attachments</span><b>{withMedia}</b></div></div>
          </Card>
        </div>
      </div>
    </div>
  )
}
