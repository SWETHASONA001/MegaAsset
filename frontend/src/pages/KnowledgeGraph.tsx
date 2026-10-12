import { Crosshair, ExternalLink, Eye, EyeOff, Loader2, Maximize2, Network, RotateCcw, Search, Send, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnswerText, type Citation, CitationCard } from '../components/evidence'
import { type GEdge, type GNode, Graph3D, type Graph3DHandle, NODE_STYLE, styleKey } from '../components/Graph3D'
import { StationInventory } from '../components/StationInventory'
import { Badge, Button, Card, cx, ErrorState, Input, PageHeader, ProvenanceBadge, Select, Tabs, useToast } from '../components/ui'
import { api, fileUrl } from '../lib/api'
import { titleCase } from '../lib/format'
import { useApi, useDebounced } from '../lib/hooks'

const TYPE_COLOR: Record<string, string> = Object.fromEntries(Object.entries(NODE_STYLE).map(([k, v]) => [k, v.color]))
const FILTER_TYPES = ['station', 'line', 'project', 'complaint', 'ticket', 'incident', 'resolution', 'action', 'asset', 'document', 'topic', 'investigation', 'solution']
const STATION_LEVEL = ['station', 'line', 'project', 'complaint', 'ticket', 'incident', 'resolution', 'action']

interface GraphData { nodes: GNode[]; edges: GEdge[]; counts: Record<string, number>; relationship_counts: Record<string, number>; provenance_counts: Record<string, number> }

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ink-500">
      {Object.entries(NODE_STYLE).map(([k, v]) => (
        <span key={k} className="flex items-center gap-1">
          <span className={cx('inline-block size-2.5 rounded-full', v.hypothesis && 'border border-dashed border-ink-500 bg-transparent')} style={v.hypothesis ? {} : { background: v.color }} />{v.label}
        </span>
      ))}
      <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-slate-500" />documented edge</span>
      <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-violet-400" />processed / reported / hypothesis edge</span>
    </div>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function KnowledgeGraph() {
  const [types, setTypes] = useState<string[]>(STATION_LEVEL)
  const [minWeight, setMinWeight] = useState(2)
  const [limit, setLimit] = useState(450)
  const { data, error, loading, reload } = useApi<GraphData>(`/api/graph?${types.map((t) => `types=${t}`).join('&')}&min_weight=${minWeight}&limit=${limit}`, [])
  const { data: stations } = useApi<{ items: { id: number; name: string; code: string }[] }>('/api/stations')
  const [expansions, setExpansions] = useState<Record<number, { nodes: GNode[]; edges: GEdge[] }>>({})
  const [expanding, setExpanding] = useState<number | null>(null)
  const [selNode, setSelNode] = useState<GNode | null>(null)
  const [selEdge, setSelEdge] = useState<GEdge | null>(null)
  const [status, setStatus] = useState<'all' | 'active' | 'closed'>('all')
  const [days, setDays] = useState('')
  const [focusMode, setFocusMode] = useState(false)
  const [labelMode, setLabelMode] = useState<'smart' | 'all' | 'selection'>('smart')
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 250)
  const [results, setResults] = useState<GNode[]>([])
  const [panel, setPanel] = useState<'details' | 'rag'>('details')
  const [highlight, setHighlight] = useState<Set<number>>(new Set())
  const onEntities = useCallback((ids: number[]) => setHighlight(new Set(ids)), [])
  const g3 = useRef<Graph3DHandle>(null)
  const toast = useToast()

  useEffect(() => {
    if (dq.trim().length < 2) { setResults([]); return }
    api<GNode[]>(`/api/graph/search?q=${encodeURIComponent(dq)}`).then(setResults).catch(() => setResults([]))
  }, [dq])

  const expand = useCallback(async (id: number) => {
    if (expansions[id]) return expansions[id]
    setExpanding(id)
    try {
      const r = await api<{ entity: GNode; nodes: GNode[]; edges: GEdge[] }>(`/api/graph/entity/${id}?depth=1`)
      const v = { nodes: [r.entity, ...r.nodes], edges: r.edges }
      setExpansions((x) => ({ ...x, [id]: v }))
      return v
    } catch (e) { toast({ tone: 'error', message: (e as Error).message }); return null } finally { setExpanding(null) }
  }, [expansions, toast])

  const merged = useMemo(() => {
    const nodes = new Map<number, GNode>(), edges = new Map<number, GEdge>()
    for (const n of data?.nodes ?? []) nodes.set(n.id, n)
    for (const e of data?.edges ?? []) edges.set(e.id, e)
    for (const x of Object.values(expansions)) { x.nodes.forEach((n) => nodes.set(n.id, { ...nodes.get(n.id), ...n })); x.edges.forEach((e) => edges.set(e.id, e)) }
    const cutoff = days ? Date.now() - Number(days) * 86400000 : null
    const keep = (n: GNode) => {
      if (n.type === 'ticket' && status !== 'all') { const closed = styleKey(n) === 'ticket_closed'; if ((status === 'active') === closed) return false }
      if (cutoff && (n.type === 'complaint' || n.type === 'ticket')) { const t = Date.parse(String(n.properties?.created_at ?? '')); if (!isNaN(t) && t < cutoff) return false }
      return true
    }
    let ns = [...nodes.values()].filter(keep)
    let ids = new Set(ns.map((n) => n.id))
    let es = [...edges.values()].filter((e) => ids.has(e.source) && ids.has(e.target))
    const deg = new Map<number, number>()
    es.forEach((e) => { deg.set(e.source, (deg.get(e.source) ?? 0) + 1); deg.set(e.target, (deg.get(e.target) ?? 0) + 1) })
    ns = ns.filter((n) => deg.has(n.id) || n.type === 'station' || n.id === selNode?.id).map((n) => ({ ...n, degree: deg.get(n.id) ?? 0 }))
    if (focusMode && selNode) {
      const nb = new Set<number>([selNode.id]); es.forEach((e) => { if (e.source === selNode.id) nb.add(e.target); if (e.target === selNode.id) nb.add(e.source) })
      ns = ns.filter((n) => nb.has(n.id)); ids = new Set(ns.map((n) => n.id)); es = es.filter((e) => ids.has(e.source) && ids.has(e.target))
    }
    return { nodes: ns, edges: es }
  }, [data, expansions, status, days, focusMode, selNode])

  const searchSet = useMemo(() => (dq.length >= 2 ? new Set(merged.nodes.filter((n) => n.label.toLowerCase().includes(dq.toLowerCase())).map((n) => n.id)) : null), [dq, merged])
  const hl = highlight.size ? highlight : searchSet
  const nodeById = (id: number) => merged.nodes.find((n) => n.id === id) ?? data?.nodes.find((n) => n.id === id)

  const select = async (n: GNode | null, focusCam = false) => {
    setSelEdge(null); setSelNode(n); setPanel('details')
    if (n && n.type === 'station') await expand(n.id)  // station-level view expands on demand
    if (n && focusCam) setTimeout(() => g3.current?.focus(n.id), 60)
  }
  const pickResult = async (n: GNode) => { setQ(''); setResults([]); await expand(n.id); await select(n, true) }
  const pickStation = async (sid: string) => {
    if (!sid) { setFocusMode(false); setSelNode(null); return }
    const code = stations?.items.find((s) => String(s.id) === sid)?.code
    const n = data?.nodes.find((x) => x.key === `station:${code}`) ?? (await api<GNode[]>(`/api/graph/search?q=${code}`)).find((x) => x.key === `station:${code}`)
    if (n) { await expand(n.id); await select(n, true); setFocusMode(true) }
  }
  const reset = () => { setSelNode(null); setSelEdge(null); setExpansions({}); setFocusMode(false); setHighlight(new Set()); setStatus('all'); setDays(''); setQ(''); g3.current?.resetView() }
  const toggleType = (t: string) => setTypes((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))
  if (error) return <ErrorState message={error} onRetry={reload} />

  return (
    <div>
      <PageHeader eyebrow="Intelligence" title="Knowledge graph" description="A 3D view of stations, assets, complaints, tickets, documents and resolutions built from real records. Start at the station level and expand entities on demand; every edge links back to the document, dataset row or record it came from."
        meta={data && <><Badge tone="gray">{merged.nodes.length} shown</Badge><Badge tone="gray">{merged.edges.length} relationships shown</Badge>
          {Object.entries(data.provenance_counts).map(([k, v]) => <span key={k} className="flex items-center gap-1"><ProvenanceBadge label={k} /><span className="text-xs text-ink-500">{v}</span></span>)}</>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <Card padded={false} className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <div className="relative w-72 shrink-0">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
              <Input className="h-8 pl-8 text-[13px]" placeholder="Search station, asset, ticket, document…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search graph" />
              {results.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-white shadow-pop thin-scroll">
                  {results.map((r) => <button key={r.id} onClick={() => pickResult(r)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-slate-50">
                    <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[styleKey(r)] }} /><span className="truncate">{r.label}</span><span className="ml-auto text-[10px] text-ink-400">{titleCase(r.type)}</span></button>)}
                </div>
              )}
            </div>
            <div className="w-48 shrink-0"><Select className="h-8 text-[13px]" value="" onChange={(e) => pickStation(e.target.value)} aria-label="Focus station"><option value="">Focus a station…</option>{stations?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
            <div className="w-36 shrink-0"><Select className="h-8 text-[13px]" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Ticket status"><option value="all">All tickets</option><option value="active">Active tickets</option><option value="closed">Resolved/closed</option></Select></div>
            <div className="w-36 shrink-0"><Select className="h-8 text-[13px]" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Time range"><option value="">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></Select></div>
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant={focusMode ? 'subtle' : 'ghost'} disabled={!selNode} onClick={() => setFocusMode(!focusMode)} icon={focusMode ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}>{focusMode ? 'Show all' : 'Hide unrelated'}</Button>
              <Button size="sm" variant="ghost" onClick={() => g3.current?.resetView()} icon={<Maximize2 className="size-3.5" />}>Fit</Button>
              <Button size="sm" variant="ghost" onClick={reset} icon={<RotateCcw className="size-3.5" />}>Reset</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
            {FILTER_TYPES.map((t) => (
              <button key={t} onClick={() => toggleType(t)} aria-pressed={types.includes(t)} className={cx('flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', types.includes(t) ? 'border-line bg-white text-ink-700' : 'border-transparent bg-slate-100 text-ink-400')}>
                <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[t] ?? '#94a3b8', opacity: types.includes(t) ? 1 : 0.3 }} />{titleCase(t)}{data?.counts[t] ? <span className="text-ink-400">{data.counts[t]}</span> : null}</button>))}
            <span className="ml-auto flex items-center gap-3 text-[11px] text-ink-500">
              <label className="flex items-center gap-1">Labels<select className="rounded border border-line px-1" value={labelMode} onChange={(e) => setLabelMode(e.target.value as typeof labelMode)}><option value="smart">Key nodes</option><option value="selection">Selection</option><option value="all">All</option></select></label>
              <label className="flex items-center gap-1">Min. mentions<input type="range" min={1} max={10} value={minWeight} onChange={(e) => setMinWeight(Number(e.target.value))} /><b className="w-3 text-ink-900">{minWeight}</b></label>
              <label className="flex items-center gap-1">Limit<select className="rounded border border-line px-1" value={limit} onChange={(e) => setLimit(Number(e.target.value))}><option value={200}>200</option><option value={450}>450</option><option value={900}>900</option></select></label>
            </span>
          </div>
          <div className="relative h-[620px]">
            {loading && !data ? <div className="flex h-full items-center justify-center"><Loader2 className="size-6 animate-spin text-brand-600" /></div>
              : !merged.nodes.length ? <div className="flex h-full items-center justify-center text-sm text-ink-500">No entities for these filters. The graph is built after document ingestion.</div>
                : <Graph3D ref={g3} nodes={merged.nodes} edges={merged.edges} selectedId={selNode?.id ?? null} highlight={hl} dimOthers={!!selNode} labelMode={labelMode} onSelect={(n) => select(n)} fitKey={`${focusMode}|${types.join(',')}|${status}|${days}`} />}
            {expanding && <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-white/95 px-2 py-1 text-xs shadow"><Loader2 className="size-3.5 animate-spin" />Expanding…</div>}
            <div className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-ink-400">Drag to orbit · scroll to zoom · right-drag to pan · click a node for details</div>
          </div>
          <div className="border-t border-line px-3 py-2"><Legend /></div>
        </Card>
        <Card padded={false} className="flex max-h-[760px] flex-col">
          <div className="px-4 pt-2"><Tabs value={panel} onChange={setPanel} tabs={[{ value: 'details', label: 'Details & provenance' }, { value: 'rag', label: <span className="flex items-center gap-1"><Sparkles className="size-3.5" />Graph-RAG</span> }]} /></div>
          <div className="flex-1 overflow-y-auto p-4 thin-scroll">
            {panel === 'rag' ? <GraphRag onEntities={onEntities} /> : selEdge ? <EdgePanel e={selEdge} nodeById={nodeById} onClose={() => setSelEdge(null)} /> : selNode ? (
              <>
                <NodePanel n={selNode} edges={merged.edges} nodeById={nodeById} onEdge={setSelEdge} onClose={() => { setSelNode(null); setFocusMode(false) }}
                  onExpand={() => expand(selNode.id)} expanded={!!expansions[selNode.id]} onFocus={() => g3.current?.focus(selNode.id)} />
                {selNode.type === 'station' && selNode.ref_id && <div className="mt-5 border-t border-line pt-4"><StationInventory stationId={selNode.ref_id} compact /></div>}
              </>
            ) : (
              <div className="space-y-4 text-[13px] text-ink-500">
                <div className="flex items-center gap-2 text-ink-700"><Network className="size-4 text-brand-600" />Click a station to expand it and see its inventory, complaints and evidence.</div>
                {data && <div><div className="mb-1.5 text-xs font-semibold uppercase tracking-wider">Relationship types</div><ul className="space-y-1">{Object.entries(data.relationship_counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k} className="flex justify-between"><span className="font-mono text-xs">{k}</span><span className="tabular-nums">{v}</span></li>)}</ul></div>}
                <div className="rounded-lg bg-slate-50 p-3 text-xs">Text-derived edges (MENTIONS, DISCUSSES, REFERENCES) record that a document mentions an entity. Similarity edges (RESEMBLES) link complaints that read alike. Neither asserts a physical or causal link.</div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}


function EvidenceList({ ev }: { ev: Record<string, any>[] }) {
  return (
    <ul className="space-y-2">{ev.map((x, i) => (
      <li key={i} className="rounded-lg bg-slate-50 p-2.5 text-[12px]">
        <div className="mb-0.5 font-medium text-ink-700">{x.kind === 'chunk' ? `Document passage · p.${x.page ?? '—'}` : x.kind === 'dataset' ? `Dataset: ${x.dataset}` : x.kind === 'record' ? `Record: ${x.table} #${x.id}${x.code ? ` (${x.code})` : ''}` : titleCase(x.kind)}</div>
        {x.excerpt && <div className="text-ink-700">{x.excerpt}</div>}
        {x.source && <div className="text-ink-500">{x.source}</div>}
        {x.file && <div className="text-ink-500">{x.file}</div>}
        {x.path && <div className="font-mono text-[10.5px] text-ink-500">{x.path}</div>}
        {x.kind === 'chunk' && x.document_id && <a className="mt-1 inline-flex items-center gap-1 text-brand-700 hover:underline" href={fileUrl(x.document_id, x.page)} target="_blank" rel="noreferrer">Open page<ExternalLink className="size-3" /></a>}
      </li>))}</ul>
  )
}

function entityLink(n: GNode) {
  const m: Record<string, string> = { station: `/app/stations/${n.ref_id}`, action: `/app/tickets/${String(n.properties?.ticket_id ?? '')}`, document: `/app/documents?doc=${n.ref_id}`, ticket: `/app/tickets/${n.ref_id}`, complaint: `/app/complaints/${n.ref_id}`, investigation: `/app/investigations/${n.ref_id}`, asset: `/app/assets/${n.ref_id}` }
  return n.ref_id ? m[n.type] : undefined
}

function NodePanel({ n, edges, nodeById, onEdge, onClose, onExpand, expanded, onFocus }: { n: GNode; edges: GEdge[]; nodeById: (id: number) => GNode | undefined; onEdge: (e: GEdge) => void; onClose: () => void; onExpand: () => void; expanded: boolean; onFocus: () => void }) {
  const rel = edges.filter((e) => e.source === n.id || e.target === n.id).sort((a, b) => b.weight - a.weight)
  const link = entityLink(n)
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2"><div><div className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: TYPE_COLOR[styleKey(n)] }} /><span className="text-xs font-medium text-ink-500">{titleCase(n.type)}</span><ProvenanceBadge label={n.provenance} /></div>
        <div className="mt-1 text-base font-semibold">{n.label}</div><div className="font-mono text-[10.5px] text-ink-400">{n.key}</div></div>
        <button onClick={onClose} aria-label="Clear selection" className="rounded p-1 text-ink-400 hover:bg-slate-100"><X className="size-4" /></button></div>
      <div className="flex flex-wrap gap-2">
        {link && <Link to={link}><Button size="sm" variant="subtle" icon={<ExternalLink className="size-3.5" />}>Open {n.type}</Button></Link>}
        <Button size="sm" disabled={expanded} onClick={onExpand} icon={<Network className="size-3.5" />}>{expanded ? 'Expanded' : 'Expand neighbours'}</Button>
        <Button size="sm" variant="ghost" onClick={onFocus} icon={<Crosshair className="size-3.5" />}>Centre</Button>
      </div>
      {Object.keys(n.properties || {}).length > 0 && <dl className="grid grid-cols-2 gap-2 text-xs">{Object.entries(n.properties).filter(([, v]) => v !== null && typeof v !== 'object').slice(0, 8).map(([k, v]) => <div key={k}><dt className="text-ink-500">{titleCase(k)}</dt><dd className="truncate font-medium">{String(v)}</dd></div>)}</dl>}
      <div><div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-500">Relationships ({rel.length})</div>
        <ul className="space-y-1">{rel.slice(0, 40).map((e) => { const other = nodeById(e.source === n.id ? e.target : e.source); return (
          <li key={e.id}><button onClick={() => onEdge(e)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] hover:bg-slate-50">
            <span className="font-mono text-[10px] text-ink-400">{e.source === n.id ? '→' : '←'} {e.type}</span><span className="min-w-0 flex-1 truncate">{other?.label}</span>{e.weight > 1 && <span className="text-[10px] text-ink-400">×{e.weight}</span>}</button></li>) })}</ul></div>
    </div>
  )
}

function EdgePanel({ e, nodeById, onClose }: { e: GEdge; nodeById: (id: number) => GNode | undefined; onClose: () => void }) {
  const s = nodeById(e.source), t = nodeById(e.target)
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between"><div><div className="font-mono text-xs text-ink-500">{e.type}</div><div className="mt-1 text-sm font-semibold">{s?.label} <span className="text-ink-400">→</span> {t?.label}</div></div>
        <button onClick={onClose} aria-label="Clear selection" className="rounded p-1 text-ink-400 hover:bg-slate-100"><X className="size-4" /></button></div>
      <div className="flex flex-wrap gap-1.5"><ProvenanceBadge label={e.provenance} />{e.weight > 1 && <Badge>weight {e.weight}</Badge>}</div>
      <div className="rounded-lg border border-line p-3 text-[12.5px]"><div className="text-xs font-semibold text-ink-500">Derivation method</div><div className="mt-0.5 text-ink-900">{e.method}</div></div>
      <div><div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-500">Traceable origin ({e.evidence.length})</div><EvidenceList ev={e.evidence} /></div>
    </div>
  )
}

function GraphRag({ onEntities }: { onEntities: (ids: number[]) => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  useEffect(() => () => onEntities([]), [onEntities])
  const run = async () => {
    if (q.trim().length < 3) return
    setLoading(true)
    try { const r = await api<any>('/api/graph/query', { method: 'POST', json: { question: q } }); setRes(r); onEntities(r.graph.nodes.map((n: any) => n.id)) }
    catch (e) { toast({ tone: 'error', message: (e as Error).message }) } finally { setLoading(false) }
  }
  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-500">Query → entities → vector + keyword retrieval + graph retrieval → evidence fusion → evaluation → grounded answer.</div>
      <div className="flex gap-2"><Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="e.g. lift maintenance at Egmore" /><Button variant="primary" loading={loading} onClick={run} icon={<Send className="size-4" />} aria-label="Run" /></div>
      {loading && <div className="flex items-center gap-2 text-xs text-ink-500"><Loader2 className="size-4 animate-spin" />Running pipeline…</div>}
      {res && (
        <>
          <ol className="space-y-1.5">{res.stages.map((s: any, i: number) => (
            <li key={i} className="rounded-lg border border-line px-3 py-2 text-[12px]"><div className="flex justify-between font-medium"><span>{i + 1}. {s.stage}</span><span className="text-ink-400">{s.ms} ms</span></div>
              <div className="mt-0.5 text-ink-500">{s.stage === 'Entity identification' ? (s.output.entities.map((e: any) => e.label).join(', ') || 'No entities recognised') : Object.entries(s.output).filter(([k]) => k !== 'entities').map(([k, v]) => `${titleCase(k)}: ${Array.isArray(v) ? (v as unknown[]).join(', ') : String(v)}`).join(' · ')}</div></li>))}</ol>
          <div className="rounded-xl border border-line p-3"><AnswerText text={res.answer} /></div>
          {res.citations.length > 0 && <div className="space-y-2">{res.citations.slice(0, 6).map((c: Citation) => <CitationCard key={c.chunk_id} c={c} />)}</div>}
          <div className="text-[11px] text-ink-500"><b>Evidence sources:</b> {res.evidence.map((e: any) => `${e.filename} p.${e.page ?? '—'} [${e.sources.join('+')}]`).slice(0, 6).join('; ')}</div>
          <ul className="list-disc pl-4 text-[11px] text-ink-400">{res.limitations.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul>
        </>
      )}
    </div>
  )
}
