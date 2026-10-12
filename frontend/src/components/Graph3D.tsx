import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, type ThreeEvent, useThree } from '@react-three/fiber'
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, forceZ, type Node3D } from 'd3-force-3d'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

export interface GNode { id: number; key: string; type: string; label: string; provenance: string; ref_id: number | null; properties: Record<string, unknown>; degree?: number | null }
export interface GEdge { id: number; source: number; target: number; type: string; provenance: string; method: string; weight: number; evidence: Record<string, unknown>[] }

/** Colour system (legend shown on the page). Colour never implies a confirmed fault unless the record says so. */
export const NODE_STYLE: Record<string, { color: string; label: string; hypothesis?: boolean }> = {
  station: { color: '#2563eb', label: 'Station' },
  asset: { color: '#0d9488', label: 'Asset (documented)' },
  complaint: { color: '#f59e0b', label: 'Complaint (reported)' },
  ticket: { color: '#ea580c', label: 'Ticket (active)' },
  ticket_closed: { color: '#fdba74', label: 'Ticket (resolved/closed)' },
  incident: { color: '#dc2626', label: 'Verified incident' },
  document: { color: '#9333ea', label: 'Document / evidence' },
  project: { color: '#4f46e5', label: 'Project / corridor' },
  resolution: { color: '#16a34a', label: 'Verified resolution' },
  resolution_failed: { color: '#be123c', label: 'Failed (reopened) resolution' },
  action: { color: '#059669', label: 'Approved engineer action' },
  line: { color: '#475569', label: 'Metro line' },
  topic: { color: '#0891b2', label: 'Subject area' },
  investigation: { color: '#9ca3af', label: 'Investigation (AI hypothesis)', hypothesis: true },
  solution: { color: '#9ca3af', label: 'Proposed solution (hypothesis)', hypothesis: true },
}

export function styleKey(n: GNode): string {
  if (n.type === 'ticket') return n.properties?.active === false || ['RESOLVED', 'CLOSED'].includes(String(n.properties?.status)) ? 'ticket_closed' : 'ticket'
  if (n.type === 'resolution') return n.properties?.outcome === 'VERIFIED_RESOLVED' ? 'resolution' : 'resolution_failed'
  if (n.type === 'solution' && n.properties?.status === 'APPROVED') return 'action'
  return n.type in NODE_STYLE ? n.type : 'topic'
}

const EDGE_COLOR: Record<string, string> = { DOCUMENTED: '#64748b', VERIFIED: '#16a34a', REPORTED: '#d97706', PROCESSED: '#a78bfa', AI_HYPOTHESIS: '#9ca3af', POTENTIAL: '#9ca3af' }
const DASHED = new Set(['PROCESSED', 'AI_HYPOTHESIS', 'POTENTIAL', 'REPORTED'])

export interface Graph3DHandle { resetView: () => void; focus: (id: number) => void }

interface Props {
  nodes: GNode[]; edges: GEdge[]; selectedId: number | null; highlight: Set<number> | null; dimOthers: boolean
  labelMode: 'smart' | 'all' | 'selection'; onSelect: (n: GNode | null) => void; fitKey?: string
}

type Pos = Record<number, { x: number; y: number; z: number }>

function useLayout(nodes: GNode[], edges: GEdge[]) {
  const prev = useRef<Pos>({})
  return useMemo(() => {
    const sim: Node3D[] = nodes.map((n) => {
      const p = prev.current[n.id]
      return p ? { id: n.id, x: p.x, y: p.y, z: p.z, kind: n.type } : { id: n.id, kind: n.type }
    })
    const ids = new Set(nodes.map((n) => n.id))
    const links = edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target }))
    const s = forceSimulation(sim, 3)
      .force('charge', forceManyBody().strength(-38))
      .force('link', forceLink(links).id((d: Node3D) => d.id).distance(28).strength(0.5))
      .force('collide', forceCollide(4))
      .force('x', forceX(0).strength(0.03)).force('y', forceY(0).strength(0.03)).force('z', forceZ(0).strength(0.03))
      .stop()
    const ticks = Object.keys(prev.current).length ? 120 : 260
    for (let i = 0; i < ticks; i++) s.tick()
    const out: Pos = {}
    sim.forEach((n) => { out[n.id] = { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 } })
    prev.current = { ...prev.current, ...out }
    return out
  }, [nodes, edges])
}

function radiusOf(n: GNode) {
  const base = n.type === 'station' ? 2.6 : n.type === 'line' ? 3.2 : n.type === 'document' ? 1.9 : n.type === 'ticket' || n.type === 'complaint' ? 1.6 : 1.4
  return base + Math.min(2.2, Math.sqrt(n.degree || 1) * 0.25)
}

function Nodes({ nodes, pos, selectedId, active, onSelect, onHover }: {
  nodes: GNode[]; pos: Pos; selectedId: number | null; active: Set<number> | null; onSelect: (n: GNode | null) => void; onHover: (n: GNode | null) => void
}) {
  const solid = useMemo(() => nodes.filter((n) => !NODE_STYLE[styleKey(n)]?.hypothesis), [nodes])
  const hyp = useMemo(() => nodes.filter((n) => NODE_STYLE[styleKey(n)]?.hypothesis), [nodes])
  return (
    <>
      <NodeMesh list={solid} pos={pos} selectedId={selectedId} active={active} onSelect={onSelect} onHover={onHover} wire={false} />
      <NodeMesh list={hyp} pos={pos} selectedId={selectedId} active={active} onSelect={onSelect} onHover={onHover} wire />
    </>
  )
}

function NodeMesh({ list, pos, selectedId, active, onSelect, onHover, wire }: {
  list: GNode[]; pos: Pos; selectedId: number | null; active: Set<number> | null; onSelect: (n: GNode | null) => void; onHover: (n: GNode | null) => void; wire: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const col = useMemo(() => new THREE.Color(), [])
  const dim = useMemo(() => new THREE.Color('#e2e8f0'), [])
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    list.forEach((n, i) => {
      const p = pos[n.id] ?? { x: 0, y: 0, z: 0 }
      const r = radiusOf(n) * (n.id === selectedId ? 1.5 : 1)
      dummy.position.set(p.x, p.y, p.z); dummy.scale.setScalar(r); dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      col.set(NODE_STYLE[styleKey(n)]?.color ?? '#94a3b8')
      if (active && !active.has(n.id)) col.lerp(dim, 0.85)
      m.setColorAt(i, col)
    })
    m.count = list.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [list, pos, selectedId, active, dummy, col, dim])
  if (!list.length) return null
  const pick = (e: ThreeEvent<MouseEvent | PointerEvent>) => (e.instanceId !== undefined ? list[e.instanceId] : null)
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(list.length, 1)]}
      onClick={(e) => { e.stopPropagation(); onSelect(pick(e)) }}
      onPointerMove={(e) => { e.stopPropagation(); onHover(pick(e)); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { onHover(null); document.body.style.cursor = '' }}>
      {wire ? <icosahedronGeometry args={[1, 1]} /> : <sphereGeometry args={[1, 18, 14]} />}
      <meshStandardMaterial wireframe={wire} roughness={0.45} metalness={0.05} />
    </instancedMesh>
  )
}

function Edges({ edges, pos, active, selectedId }: { edges: GEdge[]; pos: Pos; active: Set<number> | null; selectedId: number | null }) {
  const groups = useMemo(() => {
    const g: Record<string, { pts: number[]; dashed: boolean; color: string; strong: boolean }> = {}
    for (const e of edges) {
      const a = pos[e.source], b = pos[e.target]
      if (!a || !b) continue
      const inFocus = !active || (active.has(e.source) && active.has(e.target))
      const strong = selectedId !== null && (e.source === selectedId || e.target === selectedId)
      const key = `${e.provenance}|${inFocus ? 1 : 0}|${strong ? 1 : 0}`
      g[key] ??= { pts: [], dashed: DASHED.has(e.provenance), color: EDGE_COLOR[e.provenance] ?? '#94a3b8', strong }
      g[key].pts.push(a.x, a.y, a.z, b.x, b.y, b.z)
      ;(g[key] as { focus?: boolean }).focus = inFocus
    }
    return Object.entries(g)
  }, [edges, pos, active, selectedId])
  return <>{groups.map(([k, v]) => <EdgeGroup key={k} {...v} focus={(v as { focus?: boolean }).focus !== false} />)}</>
}

function EdgeGroup({ pts, dashed, color, strong, focus }: { pts: number[]; dashed: boolean; color: string; strong: boolean; focus: boolean }) {
  const ref = useRef<THREE.LineSegments>(null)
  const geo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g }, [pts])
  useEffect(() => { if (dashed && ref.current) ref.current.computeLineDistances() }, [geo, dashed])
  useEffect(() => () => geo.dispose(), [geo])
  const opacity = strong ? 0.95 : focus ? 0.45 : 0.06
  return (
    <lineSegments ref={ref} geometry={geo}>
      {dashed ? <lineDashedMaterial color={strong ? '#0c709a' : color} dashSize={1.6} gapSize={1.1} transparent opacity={opacity} />
        : <lineBasicMaterial color={strong ? '#0c709a' : color} transparent opacity={opacity} />}
    </lineSegments>
  )
}

function CameraRig({ handleRef, pos, fitKey }: { handleRef: React.MutableRefObject<Graph3DHandle | null>; pos: Pos; fitKey: string }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null }
  const fit = () => {
    const pts = Object.values(pos)
    if (!pts.length) return
    const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length, z: a.z + p.z / pts.length }), { x: 0, y: 0, z: 0 })
    const ds = pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z)).sort((a, b) => a - b)
    const r = Math.max(20, ds[Math.floor((ds.length - 1) * 0.9)])  // ignore far outliers so the main structure fills the view
    const d = r / Math.tan((camera.fov * Math.PI) / 360) * 1.05
    camera.position.set(c.x + d * 0.3, c.y + d * 0.22, c.z + d)
    camera.near = 0.1; camera.far = d * 20; camera.updateProjectionMatrix()
    controls?.target.set(c.x, c.y, c.z); controls?.update()
  }
  useEffect(() => { const id = setTimeout(fit, 30); return () => clearTimeout(id) }, [fitKey, controls]) // eslint-disable-line react-hooks/exhaustive-deps
  handleRef.current = {
    resetView: fit,
    focus: (id: number) => {
      const p = pos[id]
      if (!p || !controls) return
      controls.target.set(p.x, p.y, p.z)
      const dir = camera.position.clone().sub(controls.target).normalize()
      camera.position.copy(new THREE.Vector3(p.x, p.y, p.z).add(dir.multiplyScalar(140)))
      controls.update()
    },
  }
  return null
}

export const Graph3D = forwardRef<Graph3DHandle, Props>(function Graph3D({ nodes, edges, selectedId, highlight, dimOthers, labelMode, onSelect, fitKey = '' }, ref) {
  const pos = useLayout(nodes, edges)
  const [hover, setHover] = useState<GNode | null>(null)
  const handle = useRef<Graph3DHandle | null>(null)
  useImperativeHandle(ref, () => ({ resetView: () => handle.current?.resetView(), focus: (id: number) => handle.current?.focus(id) }), [])
  const neighbours = useMemo(() => {
    if (selectedId === null) return null
    const s = new Set<number>([selectedId])
    edges.forEach((e) => { if (e.source === selectedId) s.add(e.target); if (e.target === selectedId) s.add(e.source) })
    return s
  }, [selectedId, edges])
  const active = useMemo(() => {
    if (highlight && highlight.size) return highlight
    if (neighbours && dimOthers) return neighbours
    return neighbours
  }, [highlight, neighbours, dimOthers])
  const labelled = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const ids = new Set<number>()
    if (labelMode === 'all') nodes.forEach((n) => ids.add(n.id))
    if (labelMode === 'smart') nodes.forEach((n) => { if (n.type === 'line' || (n.type === 'station' && (n.degree ?? 0) >= 6) || n.type === 'ticket') ids.add(n.id) })
    if (neighbours) [...neighbours].slice(0, 40).forEach((i) => ids.add(i))
    if (hover) ids.add(hover.id)
    return [...ids].map((i) => byId.get(i)).filter(Boolean) as GNode[]
  }, [nodes, labelMode, neighbours, hover])
  return (
    <Canvas camera={{ fov: 50, position: [0, 0, 220] }} dpr={[1, 2]} onPointerMissed={() => onSelect(null)} gl={{ antialias: true }}>
      <color attach="background" args={['#f8fafc']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[80, 120, 100]} intensity={1.1} />
      <directionalLight position={[-100, -60, -80]} intensity={0.35} />
      <Edges edges={edges} pos={pos} active={active} selectedId={selectedId} />
      <Nodes nodes={nodes} pos={pos} selectedId={selectedId} active={active} onSelect={onSelect} onHover={setHover} />
      {labelled.map((n) => {
        const p = pos[n.id]
        if (!p) return null
        const faded = active && !active.has(n.id)
        return (
          <Html key={n.id} position={[p.x, p.y + radiusOf(n) + 1.2, p.z]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] font-medium shadow-sm ${n.id === selectedId ? 'bg-brand-800 text-white' : 'bg-white/90 text-ink-900'} ${faded ? 'opacity-30' : ''}`}>
              {n.label.length > 42 ? n.label.slice(0, 40) + '…' : n.label}
            </div>
          </Html>
        )
      })}
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
      <CameraRig handleRef={handle} pos={pos} fitKey={fitKey} />
    </Canvas>
  )
})
