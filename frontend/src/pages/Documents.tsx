import { AlertTriangle, Copy, ExternalLink, FileSpreadsheet, FileText, FolderOpen, Layers, RefreshCw, ScanText, Search, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { DocKindBadge } from '../components/evidence'
import { Badge, Button, Card, CardHeader, cx, Drawer, EmptyState, ErrorState, Input, KeyValue, LoadingBlock, Notice, PageHeader, Progress, ProvenanceBadge, SectionTitle, Select, Stat, StatusBadge, useToast } from '../components/ui'
import { api, fileUrl } from '../lib/api'
import { useAuth } from '../lib/auth'
import { bytes, fmtDate, fmtNum, titleCase } from '../lib/format'
import { useApi, usePolling } from '../lib/hooks'

interface Doc { id: number; filename: string; title: string; category: string; file_type: string; size_bytes: number; checksum: string; page_count: number; status: string; error: string | null
  ocr_used: boolean; ocr_pages: number; empty_pages: number; chunk_count: number; char_count: number; origin: string; doc_kind: string; duplicate_of_id: number | null; rel_path: string
  created_at: string; indexed_at: string | null; detected_period: string | null; filename_mismatch: string | null; ocr_pending_pages: number; warnings: string[] }
interface Stats { by_status: Record<string, number>; by_category: { category: string; count: number; chunks: number; pages: number }[]; total: number; indexed: number; chunks: number; embedded_chunks: number
  indexed_pages: number; ocr_pages: number; vector_index_size: number; embedder: { name: string; dim: number; fallback: boolean }; active_job: { id: number; type: string; status: string; progress: number; total: number; message: string } | null }

/* eslint-disable @typescript-eslint/no-explicit-any */
function DocDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data: d } = useApi<any>(id ? `/api/documents/${id}` : null, [id])
  const [page, setPage] = useState<number | null>(null)
  const { data: pageText } = useApi<{ text: string; ocr: boolean; label: string | null }>(id && page ? `/api/documents/${id}/pages/${page}` : null, [id, page])
  const { user } = useAuth()
  const toast = useToast()
  useEffect(() => setPage(null), [id])
  const reindex = async () => { try { await api(`/api/documents/${id}/reindex`, { method: 'POST' }); toast({ tone: 'success', message: 'Re-index job queued' }) } catch (e) { toast({ tone: 'error', message: String((e as Error).message) }) } }
  return (
    <Drawer open={!!id} onClose={onClose} width="max-w-2xl" title={d?.title ?? 'Document'} subtitle={d?.filename}
      footer={d && <div className="flex flex-wrap justify-between gap-2">{user?.role === 'admin' && !['DUPLICATE', 'MISSING'].includes(d.status) ? <Button icon={<RefreshCw className="size-4" />} onClick={reindex}>Re-index</Button> : <span />}
        <a href={fileUrl(d.id)} target="_blank" rel="noreferrer"><Button variant="primary" icon={<ExternalLink className="size-4" />}>Open original</Button></a></div>}>
      {!d ? <div className="p-5"><LoadingBlock /></div> : (
        <div className="space-y-5 p-5">
          <div className="flex flex-wrap gap-1.5"><StatusBadge status={d.status} /><DocKindBadge kind={d.doc_kind} /><Badge>{d.category}</Badge>{d.ocr_used && <Badge tone="violet"><ScanText className="size-3" />OCR {d.ocr_pages}p</Badge>}<ProvenanceBadge label="DOCUMENTED" /></div>
          {d.filename_mismatch && <Notice tone="warn" title="Filename does not match content">{d.filename_mismatch}</Notice>}
          {d.error && <Notice tone={d.status === 'FAILED' ? 'warn' : 'info'}>{d.error}</Notice>}
          {d.duplicate_of && <Notice>This file is byte-identical to <b>{d.duplicate_of.filename}</b> and was not indexed separately.</Notice>}
          {d.doc_kind?.startsWith('TENDER') && <Notice>Procurement document: it describes intended scope and requirements, not completed maintenance or asset condition.</Notice>}
          <KeyValue items={[['Reporting period', d.detected_period ?? '—'], ['Pages', fmtNum(d.page_count)], ['Indexed passages', fmtNum(d.chunk_count)], ['Characters extracted', fmtNum(d.char_count)],
            ['Pages without text', d.empty_pages], ['OCR pending', d.ocr_pending_pages ? `${d.ocr_pending_pages} page(s)` : 'None'], ['File size', bytes(d.size_bytes)], ['Origin', d.origin === 'RAW' ? 'Workspace raw data' : 'Uploaded'],
            ['Indexed at', fmtDate(d.indexed_at)], ['SHA-256', <span className="font-mono text-[11px]" title={d.checksum}>{d.checksum.slice(0, 20)}…</span>]]} />
          <div className="text-[11px] text-ink-400">Path: <span className="font-mono">{d.rel_path}</span></div>
          {d.graph_links?.length > 0 && (
            <div><SectionTitle>Knowledge-graph links</SectionTitle>
              <div className="flex flex-wrap gap-1.5">{d.graph_links.slice(0, 24).map((l: any, i: number) => <span key={i} title={`${l.type} · ${l.method}`} className="rounded-md border border-line px-2 py-1 text-[11px]"><span className="text-ink-400">{l.type.toLowerCase()} </span>{l.target.label}<span className="ml-1 text-ink-400">×{l.weight}</span></span>)}</div></div>
          )}
          {d.pages?.length > 0 && (
            <div><SectionTitle>Extracted text by page</SectionTitle>
              <div className="flex flex-wrap gap-1">{d.pages.map((p: any) => (
                <button key={p.page_number} onClick={() => setPage(p.page_number)} title={`${p.char_count} chars${p.ocr ? ' · OCR' : ''}`}
                  className={cx('min-w-9 rounded-md border px-1.5 py-1 text-[11px] tabular-nums', page === p.page_number ? 'border-brand-600 bg-brand-600 text-white' : p.ocr ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-line bg-white hover:border-brand-300')}>{p.label ?? p.page_number}</button>))}</div>
              {page && <div className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[12.5px] leading-relaxed text-ink-700 thin-scroll">{pageText ? pageText.text : 'Loading…'}</div>}
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}

export default function Documents() {
  const { user, can } = useAuth()
  const toast = useToast()
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [status, setStatus] = useState('')
  const { data, error, loading, reload } = useApi<{ total: number; items: Doc[] }>('/api/documents?page_size=500')
  const { data: stats, reload: reloadStats } = useApi<Stats>('/api/documents/stats')
  usePolling(() => { reloadStats(true); if (stats?.active_job) reload(true) }, 5000)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const openId = sp.get('doc') ? Number(sp.get('doc')) : null
  const items = useMemo(() => (data?.items ?? []).filter((d) => (!q || `${d.filename} ${d.title}`.toLowerCase().includes(q.toLowerCase())) && (!cat || d.category === cat) && (!status || d.status === status)), [data, q, cat, status])
  const grouped = useMemo(() => { const g: Record<string, Doc[]> = {}; items.forEach((d) => { (g[d.category] ??= []).push(d) }); return g }, [items])

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    const fd = new FormData(); Array.from(files).forEach((f) => fd.append('files', f))
    try { const r = await api<{ saved: string[] }>('/api/documents/upload', { method: 'POST', body: fd }); toast({ tone: 'success', message: `${r.saved.length} file(s) uploaded — indexing started` }); reloadStats(true) }
    catch (e) { toast({ tone: 'error', message: (e as Error).message }) } finally { setUploading(false) }
  }
  const ingest = async () => { try { await api('/api/documents/ingest', { method: 'POST' }); toast({ tone: 'success', message: 'Incremental ingestion queued — unchanged files are skipped by checksum' }); reloadStats(true) } catch (e) { toast({ tone: 'error', message: (e as Error).message }) } }
  const job = stats?.active_job

  return (
    <div>
      <PageHeader eyebrow="Data & models" title="Document library"
        description="Every file discovered in the workspace with its real processing state. Originals are preserved; extracted text, passages, embeddings and the keyword index are stored separately."
        actions={<>
          {user?.role === 'admin' && <Button icon={<RefreshCw className="size-4" />} onClick={ingest}>Scan for changes</Button>}
          {can('document:upload') && <><Button variant="primary" loading={uploading} icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>Upload documents</Button>
            <input ref={fileRef} type="file" multiple hidden accept=".pdf,.txt,.md,.csv,.xlsx,.docx,.png,.jpg,.jpeg" onChange={(e) => { upload(e.target.files); e.target.value = '' }} /></>}
          <Link to="/app/assistant"><Button icon={<Search className="size-4" />}>Ask these documents</Button></Link>
        </>} />

      {job && (
        <Card className="mb-6 border-brand-200 bg-brand-50/40">
          <div className="flex items-center justify-between gap-4 text-sm"><div><span className="font-semibold">{titleCase(job.type)}</span> <span className="text-ink-500">· {job.message}</span></div><span className="tabular-nums text-ink-500">{job.progress}/{job.total}</span></div>
          <Progress className="mt-2" value={job.progress} total={job.total || 1} />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Indexed documents" value={stats ? `${stats.indexed}/${stats.total}` : '—'} hint="Searchable in the assistant" icon={<FileText className="size-4" />} />
        <Stat label="Indexed pages" value={fmtNum(stats?.indexed_pages)} hint={`${fmtNum(stats?.ocr_pages)} via OCR`} icon={<Layers className="size-4" />} />
        <Stat label="Passages" value={fmtNum(stats?.chunks)} hint={`${fmtNum(stats?.embedded_chunks)} embedded`} icon={<FolderOpen className="size-4" />} />
        <Stat label="Vector index" value={fmtNum(stats?.vector_index_size)} hint={stats?.embedder?.name ? `${stats.embedder.name} · ${stats.embedder.dim}-d` : 'Loading model…'} icon={<FileSpreadsheet className="size-4" />} />
        <Stat label="Needs attention" value={fmtNum((stats?.by_status.FAILED ?? 0) + (stats?.by_status.OCR_PENDING ?? 0) + (stats?.by_status.MISSING ?? 0))} hint={`${stats?.by_status.DUPLICATE ?? 0} duplicate(s) skipped`} icon={<AlertTriangle className="size-4" />} tone="warn" />
      </div>

      <Card padded={false} className="mt-6">
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" /><Input className="pl-9" placeholder="Filter by filename or title…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select className="md:w-56" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{stats?.by_category.map((c) => <option key={c.category}>{c.category}</option>)}</Select>
          <Select className="md:w-44" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Object.keys(stats?.by_status ?? {}).map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
        </div>
        {error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : loading ? <div className="p-4"><LoadingBlock /></div> : !items.length ? <div className="p-6"><EmptyState title="No documents match" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-line bg-slate-50/60 text-xs text-ink-500"><tr>
                <th className="px-4 py-2.5 text-left font-medium">Document</th><th className="px-4 py-2.5 text-left font-medium">Type</th><th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Pages</th><th className="px-4 py-2.5 text-right font-medium">Passages</th><th className="px-4 py-2.5 text-right font-medium">Size</th><th className="px-4 py-2.5 text-left font-medium">Notes</th></tr></thead>
              {Object.entries(grouped).map(([g, docs]) => (
                <tbody key={g} className="divide-y divide-line">
                  <tr className="bg-slate-50/40"><td colSpan={7} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">{g} <span className="font-normal">· {docs.length}</span></td></tr>
                  {docs.map((d) => (
                    <tr key={d.id} onClick={() => setSp({ doc: String(d.id) })} className="cursor-pointer hover:bg-brand-50/30">
                      <td className="max-w-md px-4 py-3"><div className="flex items-center gap-2.5"><span className="rounded-md bg-slate-100 p-1.5 text-ink-500">{['csv', 'xlsx'].includes(d.file_type) ? <FileSpreadsheet className="size-4" /> : <FileText className="size-4" />}</span>
                        <div className="min-w-0"><div className="truncate font-medium text-ink-900">{d.title}</div><div className="truncate text-xs text-ink-500">{d.filename}</div></div></div></td>
                      <td className="px-4 py-3"><DocKindBadge kind={d.doc_kind} /></td>
                      <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                      <td className="px-4 py-3 text-right tabular-nums">{d.page_count || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtNum(d.chunk_count)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-500">{bytes(d.size_bytes)}</td>
                      <td className="px-4 py-3 text-xs"><div className="flex flex-wrap gap-1">
                        {d.filename_mismatch && <Badge tone="amber">Filename ≠ content ({d.detected_period})</Badge>}
                        {d.duplicate_of_id && <Badge tone="violet"><Copy className="size-3" />Duplicate</Badge>}
                        {d.ocr_used && <Badge tone="violet">OCR {d.ocr_pages}p</Badge>}
                        {d.ocr_pending_pages > 0 && <Badge tone="gray">OCR pending {d.ocr_pending_pages}p</Badge>}
                        {d.status === 'FAILED' && <span className="text-rose-600">{d.error}</span>}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </Card>
      <Card className="mt-6"><CardHeader title="Processing pipeline" subtitle="How files become searchable evidence" />
        <ol className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
          {[['Discover & register', 'Recursive scan; SHA-256 checksum; duplicates and unchanged files are skipped.'], ['Extract', 'PDF text per page (PyMuPDF), DOCX sections, CSV/XLSX rows with sheet and row numbers. Image-only pages are queued for local OCR.'],
            ['Chunk & index', 'Structure-aware passages that never cross a page; SQLite FTS5 keyword index (BM25).'], ['Embed & retrieve', 'Local ONNX embeddings; hybrid retrieval fuses keyword and semantic rankings with reciprocal-rank fusion.']].map(([t, d], i) => (
            <li key={t} className="rounded-lg border border-line p-3"><div className="mb-1 flex items-center gap-2 font-semibold"><span className="flex size-5 items-center justify-center rounded-full bg-brand-100 text-[11px] text-brand-800">{i + 1}</span>{t}</div><div className="text-ink-500">{d}</div></li>))}
        </ol>
      </Card>
      <DocDrawer id={openId} onClose={() => setSp({})} />
    </div>
  )
}
