import { Brain, Cpu, FileSearch, GitBranch, ScanText, Search, ShieldAlert, Tags } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge, Card, CardHeader, ErrorState, KeyValue, LoadingBlock, Notice, PageHeader, ProvenanceBadge } from '../components/ui'
import { fmtNum, titleCase } from '../lib/format'
import { useApi } from '../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
function Status({ ok, label }: { ok: boolean; label?: string }) {
  return <Badge tone={ok ? 'green' : 'amber'} dot>{label ?? (ok ? 'Active' : 'Not configured')}</Badge>
}
function ModelCard({ icon, title, status, children }: { icon: ReactNode; title: string; status: ReactNode; children: ReactNode }) {
  return <Card><CardHeader title={title} icon={icon} action={status} />{children}</Card>
}

export default function Models() {
  const { data: m, error, loading, reload } = useApi<any>('/api/models')
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !m) return <LoadingBlock rows={6} />
  return (
    <div>
      <PageHeader eyebrow="Data & models" title="AI models & components" description="Every AI component runs locally. This page reports what is actually loaded — nothing depends on a hosted AI API." />
      <div className="grid gap-6 lg:grid-cols-2">
        <ModelCard icon={<FileSearch className="size-4" />} title="Embedding model" status={<Status ok={!m.embedding.fallback && m.embedding.loaded} label={m.embedding.fallback ? 'Fallback active' : m.embedding.loaded ? 'Loaded' : 'Loading'} />}>
          <KeyValue items={[['Model', m.embedding.name ?? m.embedding.configured], ['Dimensions', m.embedding.dim], ['Embedded passages', fmtNum(m.embedding.embedded_chunks)], ['Vector index size', fmtNum(m.embedding.vector_index_size)], ['Index built with', m.embedding.index_model ?? '—'], ['Runtime', 'ONNX Runtime (fastembed), CPU']]} />
          <p className="mt-3 text-xs text-ink-500">{m.embedding.description}</p>
          {m.embedding.error && <div className="mt-2 text-xs text-amber-700">{m.embedding.error}</div>}
        </ModelCard>
        <ModelCard icon={<Search className="size-4" />} title="Keyword index, fusion & reranking" status={<Status ok={m.reranker.loaded} label={m.reranker.loaded ? 'Reranker loaded' : m.reranker.enabled ? (m.reranker.error ? 'Reranker unavailable' : 'Reranker loading') : 'Reranker disabled'} />}>
          <KeyValue items={[['Keyword engine', m.keyword_index.engine], ['Fusion', 'Reciprocal-rank fusion (k = 60)'], ['Cross-encoder', m.reranker.model], ['Status', m.reranker.loaded ? 'Loaded (local ONNX)' : m.reranker.error ?? 'Not loaded yet']]} />
          <p className="mt-3 text-xs text-ink-500">{m.reranker.note}</p>
        </ModelCard>
        {m.workflow_policy && <ModelCard icon={<Tags className="size-4" />} title="Ticket workflow policy" status={<Badge tone="brand">Server-enforced</Badge>}>
          <KeyValue items={[['Supervisor review', m.workflow_policy.require_supervisor_review ? 'Required' : 'Disabled'], ['Self-approval', m.workflow_policy.allow_self_approval ? 'Allowed' : 'Not allowed'],
            ['After passenger confirms', m.workflow_policy.auto_close_on_passenger_confirmation ? 'Resolved → closed automatically (logged)' : 'Resolved; staff close'], ['No passenger response', `Stays awaiting verification; flagged after ${m.workflow_policy.verification_reminder_days} days`]]} />
          <p className="mt-3 text-xs text-ink-500">{m.workflow_policy.no_response_policy}</p>
        </ModelCard>}
        <ModelCard icon={<Cpu className="size-4" />} title="Generative language model" status={<Status ok={m.llm.active} label={m.llm.active ? `Active: ${m.llm.configured_model}` : 'Not configured'} />}>
          <KeyValue items={[['Configured model', m.llm.configured_model ?? 'None'], ['Ollama endpoint', m.llm.url], ['Reachable', m.llm.reachable ? 'Yes' : 'No'], ['Installed models', m.llm.available_models.join(', ') || '—']]} />
          {!m.llm.active && <div className="mt-3"><Notice title="Answers use extractive grounded synthesis">Without a local LLM, every answer sentence is quoted from a cited passage. To enable fluent generation: {m.llm.setup}</Notice></div>}
        </ModelCard>
        <ModelCard icon={<ScanText className="size-4" />} title="OCR" status={<Status ok={m.ocr.available && m.ocr.enabled} label={m.ocr.available ? (m.ocr.enabled ? 'Enabled' : 'Disabled') : 'Unavailable'} />}>
          <KeyValue items={[['Engine', m.ocr.engine], ['Mode', 'Background job for image-only PDF pages and uploaded images']]} />
          {m.ocr.setup && <div className="mt-2 text-xs text-amber-700">Setup: {m.ocr.setup}</div>}
        </ModelCard>
        <ModelCard icon={<Tags className="size-4" />} title="Complaint classifier" status={<ProvenanceBadge label={m.classifier.provenance} />}>
          <div className="text-[13px] text-ink-700">{m.classifier.type}</div>
          <div className="mt-3 space-y-1.5">{Object.entries(m.classifier.categories).map(([k, v]: any) => <div key={k} className="text-xs"><b>{titleCase(k)}:</b> <span className="text-ink-500">{v.join(', ')}…</span></div>)}</div>
          <div className="mt-3 text-xs text-ink-500">{m.classifier.evaluation}</div>
        </ModelCard>
        <ModelCard icon={<ShieldAlert className="size-4" />} title="Risk scoring" status={<ProvenanceBadge label={m.risk_scoring.provenance} />}>
          <div className="text-[13px] text-ink-700">{m.risk_scoring.type}</div><div className="mt-2 text-xs text-ink-500">{m.risk_scoring.evaluation}</div>
        </ModelCard>
        <ModelCard icon={<GitBranch className="size-4" />} title="Agentic workflow" status={<Badge tone="brand">{m.workflow.engine}</Badge>}>
          <ol className="flex flex-wrap gap-1.5">{m.workflow.stages.map((s: string, i: number) => <li key={s} className="rounded-md border border-line px-2 py-1 text-[11px]"><span className="text-ink-400">{i + 1}.</span> {titleCase(s)}</li>)}</ol>
          <div className="mt-3 text-xs text-ink-500">Human approval gate: solutions remain PROPOSED until a supervisor approves. No ticket is closed and no physical action is taken automatically.</div>
        </ModelCard>
        <ModelCard icon={<Brain className="size-4" />} title="Provenance vocabulary" status={null}>
          <div className="flex flex-wrap gap-1.5">{m.provenance_labels.map((l: string) => <ProvenanceBadge key={l} label={l} />)}</div>
        </ModelCard>
      </div>
    </div>
  )
}
