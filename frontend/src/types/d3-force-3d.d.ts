declare module 'd3-force-3d' {
  export interface Node3D { id: number; x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number; fx?: number | null; fy?: number | null; fz?: number | null; [k: string]: unknown }
  export interface Link3D { source: number | Node3D; target: number | Node3D; [k: string]: unknown }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Force = any
  export function forceSimulation(nodes?: Node3D[], numDimensions?: number): Force
  export function forceLink(links?: Link3D[]): Force
  export function forceManyBody(): Force
  export function forceCenter(x?: number, y?: number, z?: number): Force
  export function forceCollide(radius?: number): Force
  export function forceX(x?: number): Force
  export function forceY(y?: number): Force
  export function forceZ(z?: number): Force
}
