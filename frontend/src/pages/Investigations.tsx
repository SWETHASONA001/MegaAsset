import { Brain, Play } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, CardHeader, EmptyState, ErrorState, Field, LoadingBlock, PageHeader, PriorityBadge, StatusBadge, Textarea, useToast } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtDate, titleCase } from '../lib/format'
import { useApi } from '../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Investigations() {
  const { can } = useAuth()
  const { data, error, loading, reload } = useApi<any[]>('/api/investigations')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const nav = useNavigate()
  const run = async () => {
    setBusy(true)
    try { const r = await api<{ id: number }>('/api/investigations', { method: 'POST', json: { question: q } }); nav(`/app/investigations/${r.id}`) }
    catch (e) { toast({ tone: 'error', message: (e as Error).message }) } finally { setBusy(false) }
  }
  if (error) return <ErrorState message={error} onRetry={reload} />
  return (
    <div>
      <PageHeader eyebrow="Intelligence" title="Agentic investigations" description="Each run executes the LangGraph workflow: understand → classify → identify entities → retrieve documents → retrieve graph → analyse operations → assess risk → evaluate evidence → recommend → human approval gate." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card padded={false}>
          {loading || !data ? <div className="p-4"><LoadingBlock /></div> : !data.length ? (
            <div className="p-6"><EmptyState icon={<Brain className="size-6" />} title="No investigations yet" description="Start one from a ticket (Run AI investigation) or ask a free-form question on the right." /></div>
          ) : (
            <ul className="divide-y divide-line">{data.map((i) => (
              <li key={i.id}><Link to={`/app/investigations/${i.id}`} className="block px-5 py-4 hover:bg-brand-50/30">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[13px] font-semibold">{i.code}</span><StatusBadge status={i.status} />
                  {i.risk_level && <PriorityBadge priority={i.risk_level} />}{i.sufficiency && <span className="text-xs text-ink-500">{titleCase(i.sufficiency)}</span>}
                  {i.ticket_code && <span className="font-mono text-xs text-ink-400">{i.ticket_code}</span>}<span className="ml-auto text-xs text-ink-400">{fmtDate(i.created_at)}</span></div>
                <div className="mt-1 line-clamp-1 text-[13px] text-ink-700">{i.question}</div>
                <div className="mt-0.5 text-xs text-ink-500">{i.summary}</div>
              </Link></li>))}</ul>
          )}
        </Card>
        {can('investigation:run') && (
          <Card>
            <CardHeader title="Investigate a question" subtitle="Free-form investigation without a ticket" />
            <Field label="Issue or question"><Textarea rows={4} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Escalator at Guindy stops frequently during evening peak" /></Field>
            <Button className="mt-3 w-full" variant="primary" loading={busy} disabled={q.trim().length < 5} onClick={run} icon={<Play className="size-4" />}>Run workflow</Button>
            <div className="mt-3 text-[11px] text-ink-400">Outputs are AI hypotheses. Solutions require supervisor approval; nothing is executed automatically.</div>
          </Card>
        )}
      </div>
    </div>
  )
}
