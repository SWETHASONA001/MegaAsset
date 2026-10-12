import { AlertTriangle, Bot, Check, Copy, ExternalLink, FileSearch, Layers, Library, Loader2, MessageSquare, Plus, RotateCcw, Send, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnswerText, type Citation, CitationCard, Collapsible, DocKindBadge } from '../components/evidence'
import { Badge, Button, cx, Drawer, EmptyState, IconButton, Modal, Progress, ProvenanceBadge, Select, useToast } from '../components/ui'
import { api, fileUrl, streamSSE } from '../lib/api'
import { timeAgo, titleCase } from '../lib/format'
import { useApi, usePolling } from '../lib/hooks'

interface Conv { id: number; title: string; scope: Scope; updated_at: string }
interface Scope { document_ids?: number[]; categories?: string[] }
interface Meta {
  intent?: string; scope?: string; coverage?: { passages_retrieved: number; documents_with_evidence: number; cited_documents: number }
  evidence_strength?: { level: string; max_vector: number; term_coverage: number }; labels?: string[]; limitations?: string[]
  conflicts?: { subject: string; unit: string; values: { value: string; document: string; page: number | null }[] }[]; gaps?: string[]
  follow_ups?: string[]; mode?: string; standalone_query?: string; is_followup?: boolean; error?: string
  consulted_documents?: string[]; retrieval?: string[]
}
interface Msg { id: number | string; role: 'user' | 'assistant'; content: string; citations: Citation[]; meta: Meta; pending?: boolean; status?: string }
interface DocLite { id: number; filename: string; title: string; category: string; status: string; doc_kind: string; page_count: number }
interface Stats { indexed: number; total: number; chunks: number; indexed_pages: number; by_category: { category: string; count: number }[]; active_job: unknown }

const INTENT_LABEL: Record<string, string> = { changes: 'Tender changes', qa: 'Direct question', locate: 'Find documents & pages', summary: 'Cross-document summary', risk: 'Risk scan', compare: 'Comparison', conflict: 'Conflict check', gaps: 'Evidence gaps', actions: 'Corrective actions', resolution: 'Resolution memory' }

const SUGGESTIONS = [
  'What are the main risks identified in these documents?',
  'Which documents discuss lift and escalator maintenance?',
  'Compare the requirements in the lift/escalator and UPS battery tenders',
  'Summarise the key findings on ridership across the annual reports',
  'Are there conflicting statements about the number of stations?',
  'What information is missing before we can confirm the root cause of a lift failure?',
  'Compare the original lift and escalator tender with its addenda and corrigenda. Which requirements or dates changed?',
  'What does the latest annual report state about ridership?',
]

function scopeLabel(s: Scope, docs: DocLite[]) {
  if (s.document_ids?.length === 1) return docs.find((d) => d.id === s.document_ids![0])?.filename ?? 'One document'
  if (s.document_ids?.length) return `${s.document_ids.length} selected documents`
  if (s.categories?.length) return s.categories.join(', ')
  return 'Full indexed collection'
}

function ScopePicker({ scope, onChange, docs, stats }: { scope: Scope; onChange: (s: Scope) => void; docs: DocLite[]; stats: Stats | null }) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<number[]>(scope.document_ids ?? [])
  const [cat, setCat] = useState(scope.categories?.[0] ?? '')
  const indexed = docs.filter((d) => d.status === 'INDEXED' || d.status === 'PARTIAL')
  return (
    <>
      <button onClick={() => { setSel(scope.document_ids ?? []); setCat(scope.categories?.[0] ?? ''); setOpen(true) }}
        className="flex max-w-full items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:border-brand-300">
        <Layers className="size-3.5 text-brand-600" /><span className="text-ink-500">Searching:</span><span className="truncate">{scopeLabel(scope, docs)}</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Search scope" width="max-w-2xl"
        footer={<><Button onClick={() => { onChange({}); setOpen(false) }}>Use full collection</Button>
          <Button variant="primary" onClick={() => { onChange(sel.length ? { document_ids: sel } : cat ? { categories: [cat] } : {}); setOpen(false) }}>Apply scope</Button></>}>
        <div className="space-y-4">
          <div className="text-sm text-ink-500">The assistant searches {stats ? <b>{stats.indexed} indexed documents</b> : 'the indexed collection'} by default. Narrow it to a category or specific files.</div>
          <div><div className="mb-1.5 text-[13px] font-medium">Category</div>
            <Select value={cat} onChange={(e) => { setCat(e.target.value); setSel([]) }}><option value="">All categories</option>{stats?.by_category.map((c) => <option key={c.category} value={c.category}>{c.category} ({c.count})</option>)}</Select></div>
          <div><div className="mb-1.5 text-[13px] font-medium">Or select documents ({sel.length} selected)</div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-line thin-scroll">
              {indexed.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3 py-2 text-[13px] last:border-0 hover:bg-slate-50">
                  <input type="checkbox" checked={sel.includes(d.id)} onChange={(e) => { setCat(''); setSel(e.target.checked ? [...sel, d.id] : sel.filter((x) => x !== d.id)) }} />
                  <span className="min-w-0 flex-1 truncate">{d.filename}</span><DocKindBadge kind={d.doc_kind} />
                </label>))}
            </div></div>
        </div>
      </Modal>
    </>
  )
}

interface JobState { id: number; status: string; progress: number; total: number; message: string; result?: any }
/* eslint-disable @typescript-eslint/no-explicit-any */
function AnalysisPanel({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const [job, setJob] = useState<JobState | null>(null)
  const load = useCallback(() => api<JobState>(`/api/jobs/${jobId}`).then(setJob).catch(() => {}), [jobId])
  useEffect(() => { load() }, [load])
  usePolling(load, 1500, !job || ['QUEUED', 'RUNNING'].includes(job.status))
  const r = job?.result
  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title="Collection-wide analysis" subtitle={job?.result?.question ?? 'Map-reduce over every document in scope'}>
      <div className="space-y-5 p-5">
        {!job ? <Loader2 className="size-5 animate-spin text-brand-600" /> : (
          <>
            <div className="rounded-xl border border-line p-4">
              <div className="flex items-center justify-between text-sm"><span className="font-medium">{titleCase(job.status)}</span><span className="text-ink-500">{job.progress}/{job.total} documents</span></div>
              <Progress className="mt-2" value={job.progress} total={job.total || 1} />
              <div className="mt-2 text-xs text-ink-500">{job.message}</div>
              {['QUEUED', 'RUNNING'].includes(job.status) && <Button size="sm" className="mt-3" icon={<Square className="size-3.5" />} onClick={() => api(`/api/jobs/${jobId}/cancel`, { method: 'POST' }).then(load)}>Cancel</Button>}
            </div>
            {r?.coverage && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[['In scope', r.coverage.documents_in_scope], ['Analysed', r.coverage.documents_analysed], ['With evidence', r.coverage.documents_with_evidence], ['Skipped', r.coverage.documents_skipped]].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-line p-3"><div className="text-[11px] text-ink-500">{k}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>))}
              </div>
            )}
            {r && !r.coverage?.complete && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Coverage incomplete — not every document in scope was analysed. Results below cover only the analysed subset.</div>}
            {r?.conclusion && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">{r.conclusion}</div>}
            {r?.findings?.map((f: any) => (
              <Collapsible key={f.document_id} defaultOpen={false} title={<span className="flex min-w-0 items-center gap-2"><span className="min-w-0"><span className="block truncate">{f.title}</span><span className="block truncate text-[11px] font-normal text-ink-400">{f.filename}</span></span><DocKindBadge kind={f.doc_kind} /></span>} right={<Badge tone="brand">rel. {f.relevance}</Badge>}>
                <ul className="space-y-2">{f.passages.map((p: any, i: number) => (
                  <li key={i} className="text-[12.5px]"><div className="text-[11px] font-medium text-ink-500">{p.sheet ? `Sheet ${p.sheet}, rows ${p.row_start}–${p.row_end}` : `p. ${p.page}`}
                    <a className="ml-2 text-brand-700 hover:underline" href={fileUrl(f.document_id, p.sheet ? null : p.page)} target="_blank" rel="noreferrer">open</a></div>
                    <blockquote className="border-l-2 border-brand-200 pl-2 text-ink-700">“{p.excerpt}”</blockquote></li>))}</ul>
              </Collapsible>
            ))}
            {r?.skipped?.length > 0 && <Collapsible title={`Skipped documents (${r.skipped.length})`}><ul className="space-y-1 text-xs">{r.skipped.map((s: any) => <li key={s.document_id}><b>{s.filename}</b> — {s.status}: {s.reason}</li>)}</ul></Collapsible>}
            {r?.no_evidence?.length > 0 && <Collapsible title={`Analysed without relevant evidence (${r.no_evidence.length})`}><ul className="space-y-0.5 text-xs text-ink-500">{r.no_evidence.map((s: any) => <li key={s.document_id}>{s.filename}</li>)}</ul></Collapsible>}
            {r?.note && <div className="text-[11px] text-ink-400">{r.note}</div>}
          </>
        )}
      </div>
    </Drawer>
  )
}

export default function Assistant() {
  const toast = useToast()
  const { data: convs, reload: reloadConvs } = useApi<Conv[]>('/api/chat/conversations')
  const { data: stats } = useApi<Stats>('/api/documents/stats')
  const { data: docList } = useApi<{ items: DocLite[] }>('/api/documents?page_size=500')
  const docs = useMemo(() => docList?.items ?? [], [docList])
  const [active, setActive] = useState<number | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [scope, setScope] = useState<Scope>({})
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [focusCite, setFocusCite] = useState<{ msg: Msg; n: number } | null>(null)
  const [preview, setPreview] = useState<Citation | null>(null)
  const [jobId, setJobId] = useState<number | null>(null)
  const [copied, setCopied] = useState<number | string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages])
  const openConv = async (id: number) => {
    if (streaming) return
    const c = await api<Conv & { messages: Msg[] }>(`/api/chat/conversations/${id}`)
    setActive(id); setMessages(c.messages); setScope(c.scope ?? {}); setFocusCite(null)
  }
  const newConv = () => { if (streaming) return; setActive(null); setMessages([]); setFocusCite(null) }
  const delConv = async (id: number) => { await api(`/api/chat/conversations/${id}`, { method: 'DELETE' }); if (active === id) newConv(); reloadConvs(true) }

  const ask = async (question: string, retryOf?: number | string) => {
    const q = question.trim()
    if (!q || streaming) return
    let cid = active
    if (!cid) { const c = await api<Conv>('/api/chat/conversations', { method: 'POST', json: { scope } }); cid = c.id; setActive(c.id) }
    const pendingId = `p-${Date.now()}`
    setMessages((m) => [...(retryOf ? m.filter((x) => x.id !== retryOf) : [...m, { id: `u-${Date.now()}`, role: 'user', content: q, citations: [], meta: {} } as Msg]),
      { id: pendingId, role: 'assistant', content: '', citations: [], meta: {}, pending: true, status: 'Understanding the question' }])
    setInput(''); setStreaming(true)
    const ctrl = new AbortController(); abortRef.current = ctrl
    const patch = (fn: (m: Msg) => Msg) => setMessages((ms) => ms.map((m) => (m.id === pendingId ? fn(m) : m)))
    try {
      await streamSSE(`/api/chat/conversations/${cid}/ask`, { question: q, scope, retry_of: typeof retryOf === 'number' ? retryOf : undefined }, (e) => {
        if (e.type === 'status') patch((m) => ({ ...m, status: String(e.message) }))
        else if (e.type === 'evidence') patch((m) => ({ ...m, citations: e.citations as Citation[], meta: { ...m.meta, scope: e.scope as string, coverage: e.coverage as Meta['coverage'], evidence_strength: e.strength as Meta['evidence_strength'], intent: e.intent as string, is_followup: e.is_followup as boolean, standalone_query: e.standalone_query as string }, status: `Found ${(e.coverage as Meta['coverage'])?.passages_retrieved ?? 0} passages in ${(e.coverage as Meta['coverage'])?.documents_with_evidence ?? 0} documents` }))
        else if (e.type === 'delta') patch((m) => ({ ...m, content: m.content + String(e.text) }))
        else if (e.type === 'replace') patch((m) => ({ ...m, content: String(e.text) }))
        else if (e.type === 'done') setMessages((ms) => ms.map((m) => (m.id === pendingId ? { ...(e.message as Msg), pending: false } : m)))
        else if (e.type === 'error') patch((m) => ({ ...m, id: (e.message_id as number) ?? m.id, pending: false, content: '', meta: { error: String(e.message) } }))
      }, ctrl.signal)
    } catch (err) {
      if ((err as Error).name === 'AbortError') patch((m) => ({ ...m, pending: false, meta: { ...m.meta, error: 'Generation stopped. The partial answer was not saved.' } }))
      else patch((m) => ({ ...m, pending: false, meta: { error: err instanceof Error ? err.message : String(err) } }))
    } finally {
      setStreaming(false); abortRef.current = null; reloadConvs(true)
    }
  }
  const stop = () => abortRef.current?.abort()
  const lastUserBefore = (idx: number) => { for (let i = idx - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i].content; return '' }
  const updateScope = async (s: Scope) => { setScope(s); if (active) await api(`/api/chat/conversations/${active}`, { method: 'PATCH', json: { scope: s } }).catch(() => {}) }
  const startAnalysis = async (question: string) => {
    try { const r = await api<{ job_id: number }>('/api/chat/analysis', { method: 'POST', json: { question, document_ids: scope.document_ids ?? null, categories: scope.categories ?? null } }); setJobId(r.job_id) }
    catch (e) { toast({ tone: 'error', message: e instanceof Error ? e.message : String(e) }) }
  }
  const copy = async (m: Msg) => {
    const refs = m.citations.map((c) => `[${c.n}] ${c.filename}, ${c.location}`).join('\n')
    await navigator.clipboard.writeText(`${m.content}\n\nSources:\n${refs}`).catch(() => {})
    setCopied(m.id); setTimeout(() => setCopied(null), 1500)
  }
  const sideMsg = focusCite?.msg ?? [...messages].reverse().find((m) => m.role === 'assistant' && m.citations.length)

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-4rem)] md:-mx-8 md:-my-8">
      {/* Conversations */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-white lg:flex">
        <div className="p-3"><Button variant="primary" className="w-full" icon={<Plus className="size-4" />} onClick={newConv} disabled={streaming}>New conversation</Button></div>
        <div className="flex-1 overflow-y-auto px-2 pb-3 thin-scroll">
          <div className="px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">History</div>
          {!convs?.length && <div className="px-2 text-xs text-ink-500">No conversations yet.</div>}
          {convs?.map((c) => (
            <div key={c.id} className={cx('group flex items-center gap-1 rounded-lg px-2 py-2 text-[13px]', active === c.id ? 'bg-brand-50 text-brand-900' : 'hover:bg-slate-50')}>
              <button onClick={() => openConv(c.id)} className="min-w-0 flex-1 text-left"><div className="truncate font-medium">{c.title}</div><div className="text-[11px] text-ink-400">{timeAgo(c.updated_at)}</div></button>
              <button aria-label="Delete conversation" onClick={() => delConv(c.id)} className="rounded p-1 text-ink-400 opacity-0 hover:bg-white hover:text-rose-600 group-hover:opacity-100"><Trash2 className="size-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="border-t border-line p-3 text-[11px] leading-relaxed text-ink-500">
          <div className="flex items-center gap-1.5 font-medium text-ink-700"><Library className="size-3.5" />Index</div>
          {stats ? <>{stats.indexed} of {stats.total} documents indexed · {stats.indexed_pages.toLocaleString()} pages · {stats.chunks.toLocaleString()} passages</> : 'Loading…'}
        </div>
      </aside>

      {/* Chat */}
      <section className="flex min-w-0 flex-1 flex-col bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-white px-4 py-2.5 md:px-6">
          <div className="flex min-w-0 items-center gap-2"><FileSearch className="size-4 text-brand-600" /><h1 className="truncate text-sm font-semibold">Document Assistant</h1><Badge tone="teal">Evidence-grounded</Badge></div>
          <div className="flex items-center gap-2"><ScopePicker scope={scope} onChange={updateScope} docs={docs} stats={stats} />
            <Button size="sm" icon={<Sparkles className="size-3.5" />} onClick={() => { const q = input.trim() || lastUserBefore(messages.length); if (q) startAnalysis(q); else toast({ tone: 'info', message: 'Type a question first, then run it across the whole collection.' }) }}>Analyse all docs</Button></div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-6 thin-scroll md:px-8">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-2xl pt-6 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-900 text-white"><Bot className="size-6" /></div>
              <h2 className="mt-4 text-xl font-semibold tracking-tight">Ask across the CMRL document collection</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm text-ink-500">Answers quote the indexed passages they are based on, with file and page references. When the evidence does not support a conclusion, the assistant says so.</p>
              {stats && <p className="mt-2 text-xs text-ink-400">{stats.indexed} documents indexed from ingestion records{stats.total > stats.indexed ? ` · ${stats.total - stats.indexed} not searchable (see Documents)` : ''}</p>}
              <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
                {SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-xl border border-line bg-white px-3.5 py-3 text-[13px] text-ink-700 transition hover:border-brand-300 hover:shadow-card">{s}</button>)}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6">
              {messages.map((m, idx) => m.role === 'user' ? (
                <div key={m.id} className="flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand-800 px-4 py-2.5 text-sm text-white">{m.content}</div></div>
              ) : (
                <div key={m.id} className="flex gap-3">
                  <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-900 text-white"><Bot className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="rounded-2xl rounded-tl-sm border border-line bg-white px-4 py-3 shadow-card">
                      {(m.meta.scope || m.meta.evidence_strength) && (
                        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
                          {m.meta.scope && <span className="flex items-center gap-1"><Layers className="size-3" />{m.meta.scope}</span>}
                          {m.meta.coverage && <span>· {m.meta.coverage.passages_retrieved} passages / {m.meta.coverage.documents_with_evidence} docs</span>}
                          {m.meta.evidence_strength && <Badge tone={m.meta.evidence_strength.level === 'STRONG' ? 'green' : m.meta.evidence_strength.level === 'MODERATE' ? 'blue' : 'amber'}>Evidence: {titleCase(m.meta.evidence_strength.level)}</Badge>}
                          {m.meta.intent && <Badge tone="gray">{INTENT_LABEL[m.meta.intent] ?? titleCase(m.meta.intent)}</Badge>}
                          {m.meta.is_followup && <Badge tone="violet" className="max-w-[16rem] truncate">Follow-up → “{m.meta.standalone_query}”</Badge>}
                        </div>
                      )}
                      {m.pending && !m.content && <div className="flex items-center gap-2 text-[13px] text-ink-500"><Loader2 className="size-4 animate-spin text-brand-600" />{m.status}</div>}
                      {m.content && <AnswerText text={m.content} onCite={(n) => setFocusCite({ msg: m, n })} />}
                      {m.meta.error && (
                        <div className="mt-1 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div className="flex-1">{m.meta.error}</div>
                          <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => ask(lastUserBefore(idx), m.id)} disabled={streaming}>Retry</Button></div>
                      )}
                      {!m.pending && ((m.meta.retrieval?.length ?? 0) > 0 || (m.meta.consulted_documents?.length ?? 0) > 0) && (
                        <details className="mt-3 rounded-lg border border-line px-3 py-2 text-[12px] text-ink-500">
                          <summary className="cursor-pointer font-medium text-ink-700">How this answer was retrieved · {m.meta.consulted_documents?.length ?? 0} document(s) consulted, {new Set(m.citations.map((c) => c.document_id)).size} cited</summary>
                          {m.meta.retrieval && <ul className="mt-1.5 list-disc space-y-0.5 pl-4">{m.meta.retrieval.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                          {m.meta.consulted_documents && <div className="mt-1.5"><span className="font-medium text-ink-700">Consulted:</span> {m.meta.consulted_documents.join(' · ')}</div>}
                        </details>
                      )}
                      {!m.pending && m.meta.limitations && m.meta.limitations.length > 0 && (
                        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-ink-500"><div className="mb-0.5 font-semibold text-ink-700">Limitations</div><ul className="list-disc space-y-0.5 pl-4">{m.meta.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></div>
                      )}
                      {!m.pending && !m.meta.error && (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
                          {m.meta.labels?.map((l) => <ProvenanceBadge key={l} label={l} />)}
                          {m.meta.mode && <span className="text-[11px] text-ink-400">· {m.meta.mode === 'extractive' ? 'Extractive synthesis (quoted passages)' : m.meta.mode}</span>}
                          <span className="ml-auto flex items-center gap-0.5">
                            <IconButton label={copied === m.id ? 'Copied' : 'Copy answer with sources'} onClick={() => copy(m)}>{copied === m.id ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}</IconButton>
                            <IconButton label="Regenerate" onClick={() => ask(lastUserBefore(idx), m.id)} disabled={streaming}><RotateCcw className="size-4" /></IconButton>
                          </span>
                        </div>
                      )}
                    </div>
                    {!m.pending && m.citations.length > 0 && (
                      <button onClick={() => setFocusCite({ msg: m, n: 1 })} className="mt-1.5 text-xs font-medium text-brand-700 hover:underline xl:hidden">{m.citations.length} sources — view</button>
                    )}
                    {!m.pending && idx === messages.length - 1 && m.meta.follow_ups && m.meta.follow_ups.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">{m.meta.follow_ups.map((f) => <button key={f} onClick={() => ask(f)} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs text-ink-700 hover:border-brand-300 hover:bg-brand-50">{f}</button>)}</div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>
        <div className="border-t border-line bg-white px-4 py-3 md:px-8">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder="Ask a question about the indexed documents…" aria-label="Question"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) } }}
              className="focus-ring max-h-40 min-h-[44px] flex-1 resize-y rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm shadow-sm" />
            {streaming ? <Button variant="danger" className="h-11" icon={<Square className="size-4" />} onClick={stop}>Stop</Button>
              : <Button variant="primary" className="h-11" icon={<Send className="size-4" />} onClick={() => ask(input)} disabled={!input.trim()}>Ask</Button>}
          </div>
          <div className="mx-auto mt-1.5 max-w-3xl text-[11px] text-ink-400">Answers are grounded in retrieved passages and may be incomplete. Verify important conclusions against the cited pages.</div>
        </div>
      </section>

      {/* Sources */}
      <aside className="hidden w-[23rem] shrink-0 flex-col border-l border-line bg-white xl:flex">
        <div className="flex items-center justify-between border-b border-line px-4 py-3"><div className="text-sm font-semibold">Sources</div>{sideMsg && <span className="text-xs text-ink-500">{sideMsg.citations.length} cited</span>}</div>
        <div className="flex-1 space-y-2.5 overflow-y-auto p-3 thin-scroll">
          {!sideMsg ? <EmptyState icon={<MessageSquare className="size-5" />} title="No sources yet" description="Citations for the latest answer appear here, with exact pages and quoted excerpts." className="border-0 bg-transparent" /> :
            sideMsg.citations.map((c) => <CitationCard key={c.chunk_id} c={c} active={focusCite?.msg.id === sideMsg.id && focusCite.n === c.n} onOpen={setPreview} />)}
          {sideMsg?.meta.conflicts && sideMsg.meta.conflicts.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><div className="mb-1 font-semibold">Potential inconsistencies</div>
              {sideMsg.meta.conflicts.map((c, i) => <div key={i} className="mt-1"><b>{c.subject}</b> ({c.unit}): {c.values.map((v) => `${v.value} in ${v.document}${v.page ? ` p.${v.page}` : ''}`).join(' vs ')}</div>)}</div>
          )}
        </div>
      </aside>

      {/* Mobile sources drawer */}
      <Drawer open={!!focusCite && typeof window !== 'undefined' && window.innerWidth < 1280} onClose={() => setFocusCite(null)} title="Sources">
        <div className="space-y-2.5 p-4">{focusCite?.msg.citations.map((c) => <CitationCard key={c.chunk_id} c={c} active={c.n === focusCite.n} onOpen={setPreview} />)}</div>
      </Drawer>
      <PreviewDrawer c={preview} onClose={() => setPreview(null)} />
      {jobId && <AnalysisPanel jobId={jobId} onClose={() => setJobId(null)} />}
    </div>
  )
}

function PreviewDrawer({ c, onClose }: { c: Citation | null; onClose: () => void }) {
  const { data } = useApi<{ text: string; page: number | null; heading: string | null; ocr: boolean }>(c ? `/api/documents/${c.document_id}/chunks/${c.chunk_id}` : null, [c?.chunk_id])
  const parts = useMemo(() => {
    if (!data || !c) return null
    const ex = c.excerpt.split(' … ')[0].slice(0, 60)
    const norm = data.text.replace(/\s+/g, ' ')
    const i = norm.indexOf(ex)
    if (i < 0) return [norm, '', '']
    const end = norm.indexOf(c.excerpt.split(' … ')[0].slice(-30), i)
    const stop = end > 0 ? end + Math.min(30, c.excerpt.split(' … ')[0].length) : i + ex.length
    return [norm.slice(0, i), norm.slice(i, stop), norm.slice(stop)]
  }, [data, c])
  return (
    <Drawer open={!!c} onClose={onClose} title={c?.filename ?? ''} subtitle={c ? `${c.location}${c.heading ? ` · ${c.heading}` : ''}` : ''}
      footer={c && <div className="flex justify-between"><Button icon={<X className="size-4" />} onClick={onClose}>Close</Button><a href={fileUrl(c.document_id, c.sheet ? null : c.page)} target="_blank" rel="noreferrer"><Button variant="primary" icon={<ExternalLink className="size-4" />}>Open original{c.page && !c.sheet ? ` at p.${c.page}` : ''}</Button></a></div>}>
      <div className="p-5">
        {!data ? <Loader2 className="size-5 animate-spin text-brand-600" /> : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5"><ProvenanceBadge label="DOCUMENTED" />{data.ocr && <Badge tone="violet">OCR text</Badge>}<DocKindBadge kind={c?.doc_kind} /></div>
            <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-[13px] leading-relaxed text-ink-700">
              {parts ? <>{parts[0]}<mark className="rounded bg-amber-100 px-0.5 text-ink-900">{parts[1]}</mark>{parts[2]}</> : data.text}
            </div>
            <div className="mt-2 text-[11px] text-ink-400">Full indexed passage; the highlighted span is the quoted excerpt.</div>
          </>
        )}
      </div>
    </Drawer>
  )
}
