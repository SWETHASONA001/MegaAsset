import { Bot, Check, CheckCircle2, FileText, Film, ImagePlus, Languages, Loader2, MapPin, Paperclip, RotateCcw, Search, Send, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getToken } from '../lib/api'
import { useApi } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { bytes } from '../lib/format'
import { Badge, Button, cx, Drawer, Progress } from './ui'

type Lang = 'en' | 'ta'
interface Station { id: number; code: string; name: string; lines: string[] }
interface Category { value: string; en: string; ta: string }
interface Created { id: number; complaint_code: string; ticket: { id: number; ticket_code: string; status: string; priority: string } | null; attachments: unknown[] }

const T = {
  en: {
    title: 'Raise a Complaint', subtitle: 'Your report creates a tracked ticket with the operations team.',
    describe: 'Please describe your issue.', descHint: 'What happened, where in the station, and when? (min. 10 characters)',
    station: 'Which station is this about?', stationSearch: 'Search stations…',
    category: 'Which category fits best?', categoryNote: 'The category helps routing — it is not treated as proof that an incident occurred.',
    attach: 'Add photos, videos or documents (optional).', attachHint: 'Images ≤10 MB (JPG, PNG, WebP) · Videos ≤50 MB (MP4, WebM, MOV) · Documents ≤20 MB (PDF, TXT, DOCX)',
    review: 'Please review and submit.', submit: 'Submit complaint', submitting: 'Submitting…', skip: 'Continue without files',
    next: 'Continue', edit: 'Edit', done: 'Complaint registered', doneBody: 'The backend has confirmed your complaint and created a ticket.',
    view: 'View complaint & ticket', another: 'Raise another', typeHere: 'Type your issue…', images: 'Images', videos: 'Videos', documents: 'Documents',
    stationLabel: 'Station', categoryLabel: 'Category', descLabel: 'Description', files: 'Attachments', none: 'None',
    equipment: 'Which equipment or entrance? (optional)', equipmentHint: 'From CMRL records for this station. Choose only if you are sure — it is recorded as your report, not a confirmed fault.', notSure: 'Not sure / somewhere else', equipmentLabel: 'Equipment',
  },
  ta: {
    title: 'புகார் அளிக்கவும்', subtitle: 'உங்கள் புகார் செயல்பாட்டுக் குழுவிடம் கண்காணிக்கப்படும் டிக்கெட்டாக பதிவாகும்.',
    describe: 'தயவுசெய்து உங்கள் பிரச்சினையை விவரிக்கவும்.', descHint: 'என்ன நடந்தது, நிலையத்தில் எங்கே, எப்போது? (குறைந்தது 10 எழுத்துகள்)',
    station: 'இது எந்த நிலையம் பற்றியது?', stationSearch: 'நிலையங்களைத் தேடவும்…',
    category: 'எந்த வகை பொருத்தமானது?', categoryNote: 'வகை வழிநடத்தலுக்கு மட்டுமே — அது சம்பவம் நடந்ததற்கான ஆதாரமாகக் கருதப்படாது.',
    attach: 'புகைப்படங்கள், வீடியோக்கள் அல்லது ஆவணங்களைச் சேர்க்கவும் (விருப்பம்).', attachHint: 'படங்கள் ≤10 MB · வீடியோக்கள் ≤50 MB · ஆவணங்கள் ≤20 MB',
    review: 'சரிபார்த்து சமர்ப்பிக்கவும்.', submit: 'புகாரைச் சமர்ப்பிக்கவும்', submitting: 'சமர்ப்பிக்கிறது…', skip: 'கோப்புகள் இல்லாமல் தொடரவும்',
    next: 'தொடரவும்', edit: 'திருத்து', done: 'புகார் பதிவு செய்யப்பட்டது', doneBody: 'உங்கள் புகார் உறுதிசெய்யப்பட்டு டிக்கெட் உருவாக்கப்பட்டது.',
    view: 'புகார் & டிக்கெட்டைப் பார்க்கவும்', another: 'மற்றொரு புகார்', typeHere: 'உங்கள் பிரச்சினையைத் தட்டச்சு செய்யவும்…', images: 'படங்கள்', videos: 'வீடியோக்கள்', documents: 'ஆவணங்கள்',
    stationLabel: 'நிலையம்', categoryLabel: 'வகை', descLabel: 'விவரம்', files: 'இணைப்புகள்', none: 'இல்லை',
    equipment: 'எந்த உபகரணம் அல்லது நுழைவாயில்? (விருப்பம்)', equipmentHint: 'இந்த நிலையத்தின் CMRL பதிவுகளிலிருந்து. உறுதியாக இருந்தால் மட்டும் தேர்வு செய்யவும்.', notSure: 'உறுதியாக தெரியவில்லை', equipmentLabel: 'உபகரணம்',
  },
}

type Step = 'describe' | 'station' | 'category' | 'attach' | 'review' | 'done'
interface PickedFile { file: File; kind: 'image' | 'video' | 'document'; url?: string }
const LIMITS = { image: { mb: 10, max: 5, exts: ['.jpg', '.jpeg', '.png', '.webp'] }, video: { mb: 50, max: 2, exts: ['.mp4', '.webm', '.mov'] }, document: { mb: 20, max: 3, exts: ['.pdf', '.txt', '.docx'] } }

function BotBubble({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-900 text-white"><Bot className="size-4" /></span>
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-slate-100 px-3.5 py-2.5 text-sm text-ink-900">{children}</div>
    </motion.div>
  )
}
function UserBubble({ children, onEdit, editLabel }: { children: React.ReactNode; onEdit?: () => void; editLabel?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-end gap-1">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand-700 px-3.5 py-2.5 text-sm text-white">{children}</div>
      {onEdit && <button onClick={onEdit} className="text-[11px] font-medium text-ink-500 hover:text-brand-700">{editLabel}</button>}
    </motion.div>
  )
}

export function ComplaintDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const [lang, setLang] = useState<Lang>(user?.preferred_language ?? 'en')
  const t = T[lang]
  const nav = useNavigate()
  const { data: stationsData } = useApi<{ items: Station[] }>(open ? '/api/stations' : null, [open])
  const { data: categories } = useApi<Category[]>(open ? '/api/complaints/categories' : null, [open])
  const [step, setStep] = useState<Step>('describe')
  const [desc, setDesc] = useState('')
  const [draft, setDraft] = useState('')
  const [station, setStation] = useState<Station | null>(null)
  const [stationQ, setStationQ] = useState('')
  const [category, setCategory] = useState<Category | null>(null)
  const [files, setFiles] = useState<PickedFile[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Created | null>(null)
  // One idempotency key per draft: retries and double-clicks resubmit the same key, so the server never creates a second ticket.
  const [requestKey, setRequestKey] = useState(() => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`))
  const [assetId, setAssetId] = useState('')
  const relevantTypes = category?.value === 'lifts_escalators' ? ['lift', 'escalator'] : category?.value === 'accessibility' ? ['lift', 'accessibility_ramp', 'station_entrance'] : ['station_entrance']
  const { data: stationAssets } = useApi<{ items: { id: number; name: string; asset_type: string; description: string }[] }>(station ? `/api/assets?station_id=${station.id}&page_size=200` : null, [station?.id])
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [step, files.length, error])
  useEffect(() => { if (user) setLang(user.preferred_language ?? 'en') }, [user])

  const reset = () => {
    files.forEach((f) => f.url && URL.revokeObjectURL(f.url))
    setStep('describe'); setDesc(''); setDraft(''); setStation(null); setStationQ(''); setCategory(null); setFiles([]); setError(null); setCreated(null); setProgress(0); setFileError(null)
    setAssetId(''); setRequestKey(crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
  }
  const close = () => { onClose(); if (step === 'done') reset() }

  const stations = useMemo(() => {
    const all = stationsData?.items ?? []
    const q = stationQ.trim().toLowerCase()
    return q ? all.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)) : all
  }, [stationsData, stationQ])

  const addFiles = (list: FileList | null) => {
    if (!list) return
    setFileError(null)
    const next = [...files]
    for (const f of Array.from(list)) {
      const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase()
      const kind = (Object.keys(LIMITS) as (keyof typeof LIMITS)[]).find((k) => LIMITS[k].exts.includes(ext))
      if (!kind) { setFileError(`${f.name}: unsupported file type`); continue }
      if (f.size > LIMITS[kind].mb * 1024 * 1024) { setFileError(`${f.name}: exceeds ${LIMITS[kind].mb} MB`); continue }
      if (next.filter((x) => x.kind === kind).length >= LIMITS[kind].max) { setFileError(`Maximum ${LIMITS[kind].max} ${kind}s`); continue }
      next.push({ file: f, kind, url: kind === 'image' || kind === 'video' ? URL.createObjectURL(f) : undefined })
    }
    setFiles(next)
  }
  const removeFile = (i: number) => { const f = files[i]; if (f.url) URL.revokeObjectURL(f.url); setFiles(files.filter((_, j) => j !== i)) }

  const submitDesc = () => {
    if (draft.trim().length < 10) return
    setDesc(draft.trim()); setStep(station ? (category ? 'attach' : 'category') : 'station')
  }

  const submit = () => {
    if (!station || !category || desc.length < 10) return
    setSubmitting(true); setError(null); setProgress(0)
    const fd = new FormData()
    fd.append('description', desc); fd.append('station_id', String(station.id)); fd.append('category', category.value); fd.append('language', lang); fd.append('client_request_id', requestKey)
    if (assetId) fd.append('asset_id', assetId)
    files.forEach((f) => fd.append(f.kind === 'image' ? 'images' : f.kind === 'video' ? 'videos' : 'documents', f.file, f.file.name))
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/complaints')
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 95)) }
    xhr.onload = () => {
      setSubmitting(false)
      let body: { detail?: string } & Partial<Created> = {}
      try { body = JSON.parse(xhr.responseText) } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.complaint_code) {
        setProgress(100); setCreated(body as Created); setStep('done')
        window.dispatchEvent(new Event('megaasset:complaint-created'))
      } else {
        setError(typeof body.detail === 'string' ? body.detail : `Submission failed (HTTP ${xhr.status}). Your complaint was not recorded.`)
      }
    }
    xhr.onerror = () => { setSubmitting(false); setError('Network error — the complaint was not recorded. Please retry.') }
    xhr.send(fd)
  }

  const kindIcon = (k: string) => k === 'image' ? <ImagePlus className="size-4" /> : k === 'video' ? <Film className="size-4" /> : <FileText className="size-4" />
  const reached = (s: Step) => ['describe', 'station', 'category', 'attach', 'review', 'done'].indexOf(step) >= ['describe', 'station', 'category', 'attach', 'review', 'done'].indexOf(s)

  return (
    <Drawer open={open} onClose={close} width="max-w-lg"
      title={<span className="flex items-center gap-2">{t.title}</span>}
      subtitle={t.subtitle}
      footer={step === 'describe' ? (
        <div className="flex items-end gap-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={t.typeHere} maxLength={4000}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitDesc() } }}
            className="focus-ring max-h-40 min-h-[44px] flex-1 resize-y rounded-xl border border-line bg-white px-3 py-2.5 text-sm" aria-label={t.describe} />
          <Button variant="primary" className="h-11 w-11 !px-0" onClick={submitDesc} disabled={draft.trim().length < 10} aria-label="Send"><Send className="size-4" /></Button>
        </div>
      ) : undefined}>
      <div className="flex items-center justify-between border-b border-line bg-slate-50/60 px-5 py-2.5">
        <div className="flex items-center gap-1 text-xs text-ink-500"><Languages className="size-3.5" />Language</div>
        <div className="flex rounded-lg border border-line bg-white p-0.5 text-xs font-medium">
          {(['en', 'ta'] as Lang[]).map((l) => (
            <button key={l} onClick={() => setLang(l)} className={cx('rounded-md px-2.5 py-1 transition', lang === l ? 'bg-brand-700 text-white' : 'text-ink-500 hover:text-ink-900')}>{l === 'en' ? 'English' : 'தமிழ்'}</button>
          ))}
        </div>
      </div>
      <div ref={scrollRef} className="space-y-4 px-5 py-5">
        <BotBubble>
          <div className="font-medium">{t.describe}</div>
          <div className="mt-1 text-xs text-ink-500">{t.descHint}</div>
        </BotBubble>
        {desc && <UserBubble onEdit={step !== 'done' ? () => { setDraft(desc); setStep('describe') } : undefined} editLabel={t.edit}>{desc}</UserBubble>}

        {reached('station') && desc && (
          <>
            <BotBubble><div className="font-medium">{t.station}</div></BotBubble>
            {step === 'station' ? (
              <div className="ml-9 rounded-xl border border-line bg-white p-3 shadow-card">
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
                  <input autoFocus value={stationQ} onChange={(e) => setStationQ(e.target.value)} placeholder={t.stationSearch}
                    className="focus-ring h-9 w-full rounded-lg border border-line pl-8 pr-3 text-sm" />
                </div>
                <div className="max-h-56 overflow-y-auto thin-scroll">
                  {!stationsData && <div className="flex items-center gap-2 p-3 text-sm text-ink-500"><Loader2 className="size-4 animate-spin" />Loading stations…</div>}
                  {stationsData && stations.length === 0 && <div className="p-3 text-sm text-ink-500">No station matches.</div>}
                  {stations.map((s) => (
                    <button key={s.id} onClick={() => { setStation(s); setAssetId(''); setStep(category ? 'attach' : 'category') }}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-brand-50">
                      <span className="flex items-center gap-2"><MapPin className="size-3.5 text-ink-400" />{s.name}</span>
                      <span className="flex gap-1">{s.lines.map((l) => <span key={l} className={cx('size-2 rounded-full', l.startsWith('Blue') ? 'bg-blue-700' : 'bg-green-600')} title={l} />)}<span className="ml-1 font-mono text-[10px] text-ink-400">{s.code}</span></span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 border-t border-line pt-2 text-[11px] text-ink-400">Station list from the CMRL GTFS feed (stops.txt).</div>
              </div>
            ) : station && <UserBubble onEdit={step !== 'done' ? () => setStep('station') : undefined} editLabel={t.edit}>{station.name}</UserBubble>}
          </>
        )}

        {reached('category') && station && (
          <>
            <BotBubble><div className="font-medium">{t.category}</div><div className="mt-1 text-xs text-ink-500">{t.categoryNote}</div></BotBubble>
            {step === 'category' ? (
              <div className="ml-9 flex flex-wrap gap-2">
                {(categories ?? []).map((c) => (
                  <button key={c.value} onClick={() => { setCategory(c); setStep('attach') }}
                    className={cx('rounded-full border px-3 py-1.5 text-[13px] font-medium transition', category?.value === c.value ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-line bg-white text-ink-700 hover:border-brand-300 hover:bg-brand-50')}>
                    {c[lang]}
                  </button>
                ))}
              </div>
            ) : category && <UserBubble onEdit={step !== 'done' ? () => setStep('category') : undefined} editLabel={t.edit}>{category[lang]}</UserBubble>}
          </>
        )}

        {reached('attach') && category && (
          <>
            <BotBubble><div className="font-medium">{t.attach}</div><div className="mt-1 text-xs text-ink-500">{t.attachHint}</div></BotBubble>
            {step === 'attach' ? (
              <div className="ml-9 space-y-3">
                <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
                  onClick={() => fileInput.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-line bg-white px-4 py-6 text-center transition hover:border-brand-300 hover:bg-brand-50/40">
                  <Paperclip className="size-5 text-ink-400" />
                  <div className="text-sm font-medium text-ink-700">Drop files or click to browse</div>
                  <div className="flex gap-1.5"><Badge>{t.images}</Badge><Badge>{t.videos}</Badge><Badge>{t.documents}</Badge></div>
                  <input ref={fileInput} type="file" multiple hidden accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,.pdf,.txt,.docx" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
                </div>
                {fileError && <div className="text-xs text-rose-600">{fileError}</div>}
                {files.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {files.map((f, i) => (
                      <div key={i} className="group relative overflow-hidden rounded-lg border border-line bg-white">
                        {f.kind === 'image' && f.url ? <img src={f.url} alt={f.file.name} className="h-24 w-full object-cover" /> :
                          f.kind === 'video' && f.url ? <video src={f.url} className="h-24 w-full bg-black object-cover" muted /> :
                            <div className="flex h-24 items-center justify-center bg-slate-50 text-ink-400"><FileText className="size-8" /></div>}
                        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px]">
                          <span className="text-ink-400">{kindIcon(f.kind)}</span>
                          <span className="min-w-0 flex-1 truncate">{f.file.name}</span>
                          <span className="text-ink-400">{bytes(f.file.size)}</span>
                        </div>
                        <button onClick={() => removeFile(i)} aria-label={`Remove ${f.file.name}`} className="absolute right-1.5 top-1.5 rounded-md bg-white/90 p-1 text-rose-600 shadow opacity-90 hover:opacity-100"><Trash2 className="size-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
                {(stationAssets?.items ?? []).filter((a) => relevantTypes.includes(a.asset_type)).length > 0 && (
                  <label className="block">
                    <span className="mb-1 block text-[13px] font-medium text-ink-700">{t.equipment}</span>
                    <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className="focus-ring h-9 w-full rounded-lg border border-line bg-white px-2 text-sm">
                      <option value="">{t.notSure}</option>
                      {(stationAssets?.items ?? []).filter((a) => relevantTypes.includes(a.asset_type)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <span className="mt-1 block text-[11px] text-ink-500">{t.equipmentHint}</span>
                  </label>
                )}
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => setStep('review')} icon={<Check className="size-4" />}>{files.length ? t.next : t.skip}</Button>
                </div>
              </div>
            ) : (
              <UserBubble onEdit={step !== 'done' ? () => setStep('attach') : undefined} editLabel={t.edit}>{files.length ? files.map((f) => f.file.name).join(', ') : t.none}</UserBubble>
            )}
          </>
        )}

        {step === 'review' && station && category && (
          <>
            <BotBubble><div className="font-medium">{t.review}</div></BotBubble>
            <div className="ml-9 rounded-xl border border-line bg-white p-4 shadow-card">
              <dl className="space-y-2.5 text-sm">
                <div><dt className="text-xs text-ink-500">{t.descLabel}</dt><dd className="mt-0.5 whitespace-pre-wrap">{desc}</dd></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><dt className="text-xs text-ink-500">{t.stationLabel}</dt><dd className="mt-0.5 font-medium">{station.name}</dd></div>
                  <div><dt className="text-xs text-ink-500">{t.categoryLabel}</dt><dd className="mt-0.5 font-medium">{category[lang]}</dd></div>
                </div>
                {assetId && <div><dt className="text-xs text-ink-500">{t.equipmentLabel}</dt><dd className="mt-0.5">{stationAssets?.items.find((a) => String(a.id) === assetId)?.name}</dd></div>}
                <div><dt className="text-xs text-ink-500">{t.files}</dt><dd className="mt-0.5">{files.length ? `${files.length} file(s)` : t.none}</dd></div>
              </dl>
              {submitting && <div className="mt-4"><Progress value={progress} total={100} /><div className="mt-1 text-xs text-ink-500">{t.submitting} {progress}%</div></div>}
              {error && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">{error}</div>}
              <Button variant="primary" className="mt-4 w-full" size="lg" loading={submitting} onClick={submit} icon={error ? <RotateCcw className="size-4" /> : <Send className="size-4" />}>
                {submitting ? t.submitting : error ? 'Retry submission' : t.submit}
              </Button>
            </div>
          </>
        )}

        <AnimatePresence>
          {step === 'done' && created && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-5 text-center">
              <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
              <div className="mt-2 text-base font-semibold">{t.done}</div>
              <div className="mt-1 text-[13px] text-ink-500">{t.doneBody}</div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-left">
                <div className="rounded-lg border border-line bg-white p-3"><div className="text-[11px] text-ink-500">Complaint ID</div><div className="font-mono text-sm font-semibold">{created.complaint_code}</div></div>
                <div className="rounded-lg border border-line bg-white p-3"><div className="text-[11px] text-ink-500">Ticket</div><div className="font-mono text-sm font-semibold">{created.ticket?.ticket_code}</div>
                  <div className="mt-1 text-[11px] text-ink-500">Status: {created.ticket?.status} · {created.ticket?.priority}</div></div>
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button variant="primary" className="flex-1" onClick={() => { onClose(); nav(`/app/complaints/${created.id}`); reset() }}>{t.view}</Button>
                <Button className="flex-1" onClick={reset} icon={<X className="size-4" />}>{t.another}</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Drawer>
  )
}
