import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../lib/hooks'
import { Skeleton } from './ui'

interface MapData { stations: { id: number; code: string; name: string; lat: number; lon: number; lines: string[] }[]; shapes: { shape_id: string; color: string; points: [number, number][] }[]; source: string }

/** Equirectangular projection of CMRL GTFS shapes and stations. `value` sizes station markers (e.g. ridership). */
export function NetworkMap({ height = 520, values, highlight, valueLabel }: { height?: number; values?: Record<number, number>; highlight?: number; valueLabel?: string }) {
  const { data } = useApi<MapData>('/api/network-map')
  const nav = useNavigate()
  const [hover, setHover] = useState<{ id: number; x: number; y: number } | null>(null)
  const geo = useMemo(() => {
    if (!data) return null
    const lats = data.stations.map((s) => s.lat); const lons = data.stations.map((s) => s.lon)
    const pad = 0.012
    const minLat = Math.min(...lats) - pad, maxLat = Math.max(...lats) + pad, minLon = Math.min(...lons) - pad, maxLon = Math.max(...lons) + pad
    const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
    const W = (maxLon - minLon) * k, H = maxLat - minLat
    const width = 1000, h = (width * H) / W
    const px = (lat: number, lon: number): [number, number] => [((lon - minLon) * k / W) * width, ((maxLat - lat) / H) * h]
    return { px, width, h }
  }, [data])
  if (!data || !geo) return <Skeleton className="w-full" />
  const maxV = values ? Math.max(1, ...Object.values(values)) : 1
  const hs = hover ? data.stations.find((s) => s.id === hover.id) : null
  return (
    <div className="relative mx-auto" style={{ height, aspectRatio: `${geo.width} / ${geo.h}`, maxWidth: "100%" }}>
      <svg viewBox={`0 0 ${geo.width} ${geo.h}`} className="h-full w-full" role="img" aria-label="CMRL network map from GTFS shapes">
        <rect width={geo.width} height={geo.h} fill="#f8fafc" rx={12} />
        {data.shapes.map((s) => (
          <polyline key={s.shape_id} fill="none" stroke={s.color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}
            points={s.points.map(([la, lo]) => geo.px(la, lo).join(',')).join(' ')} />
        ))}
        {data.stations.map((s) => {
          const [x, y] = geo.px(s.lat, s.lon)
          const v = values?.[s.id]
          const r = values ? (v ? 5 + Math.sqrt(v / maxV) * 13 : 4) : 6
          const hl = highlight === s.id
          return (
            <g key={s.id} className="cursor-pointer" onMouseEnter={() => setHover({ id: s.id, x, y })} onMouseLeave={() => setHover(null)} onClick={() => nav(`/app/stations/${s.id}`)}>
              <circle cx={x} cy={y} r={r + 8} fill="transparent" />
              <circle cx={x} cy={y} r={r} fill={hl ? '#0ea5e9' : values && v ? 'rgba(22,140,184,0.28)' : '#fff'} stroke={hl ? '#0b3b5c' : '#0b3b5c'} strokeWidth={hl ? 3 : 2} />
              {(hl || (values && v && v / maxV > 0.55)) && <text x={x + r + 5} y={y + 6} fontSize={20} fontWeight={600} fill="#0f1b2d" paintOrder="stroke" stroke="#f8fafc" strokeWidth={4}>{s.name}</text>}
            </g>
          )
        })}
      </svg>
      {hover && hs && (
        <div className="pointer-events-none absolute z-10 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-pop" style={{ left: `${(hover.x / geo.width) * 100}%`, top: `${(hover.y / geo.h) * 100}%`, transform: 'translate(12px, -50%)' }}>
          <div className="font-semibold text-ink-900">{hs.name}</div>
          <div className="text-ink-500">{hs.code} · {hs.lines.join(', ') || 'line n/a'}</div>
          {values && <div className="mt-0.5 text-ink-700">{valueLabel}: <b>{values[hs.id]?.toLocaleString('en-IN') ?? 'no data'}</b></div>}
        </div>
      )}
      <div className="absolute bottom-2 left-3 text-[10px] text-ink-400">Geometry: CMRL GTFS shapes.txt · stops.txt</div>
    </div>
  )
}
