export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0B3B5C" />
      <path d="M7 22 L13 10 L19 22 L25 10" fill="none" stroke="#38BDF8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="13" cy="10" r="2.4" fill="#fff" />
      <circle cx="19" cy="22" r="2.4" fill="#34D399" />
    </svg>
  )
}

export function BrandLockup({ collapsed = false, inverse = false }: { collapsed?: boolean; inverse?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      {!collapsed && (
        <div className="leading-tight">
          <div className={`text-[15px] font-semibold tracking-tight ${inverse ? 'text-white' : 'text-ink-900'}`}>
            MegaAsset<span className={inverse ? 'text-sky-300' : 'text-brand-600'}>·Agentic</span>
          </div>
          <div className={`text-[10.5px] font-medium uppercase tracking-[0.08em] ${inverse ? 'text-slate-400' : 'text-ink-500'}`}>Infrastructure Intelligence</div>
        </div>
      )}
    </div>
  )
}
