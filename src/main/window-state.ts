import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'

export interface Bounds { x: number; y: number; width: number; height: number }
export interface WindowState extends Bounds { maximized: boolean }
export const MIN_WINDOW = { width: 760, height: 480 }
const validBounds = (v: unknown): v is Bounds => {
  if (!v || typeof v !== 'object') return false
  const b = v as Bounds
  return [b.x, b.y, b.width, b.height].every(n => typeof n === 'number' && Number.isFinite(n)) && b.width > 0 && b.height > 0
}

export function fitWindow(state: unknown, areas: Bounds[], primary: Bounds): WindowState {
  const saved = validBounds(state) ? state as Partial<WindowState> & Bounds : undefined
  let area = primary, overlap = 0
  if (saved) {
    for (const candidate of areas) {
      const w = Math.max(0, Math.min(saved.x + saved.width, candidate.x + candidate.width) - Math.max(saved.x, candidate.x))
      const h = Math.max(0, Math.min(saved.y + saved.height, candidate.y + candidate.height) - Math.max(saved.y, candidate.y))
      if (w * h > overlap) { overlap = w * h; area = candidate }
    }
  }
  const width = Math.round(Math.min(area.width, Math.max(MIN_WINDOW.width, saved?.width ?? 1280)))
  const height = Math.round(Math.min(area.height, Math.max(MIN_WINDOW.height, saved?.height ?? 800)))
  const x = saved && overlap ? Math.min(Math.max(saved.x, area.x), area.x + area.width - width) : area.x + (area.width - width) / 2
  const y = saved && overlap ? Math.min(Math.max(saved.y, area.y), area.y + area.height - height) : area.y + (area.height - height) / 2
  return { x: Math.round(x), y: Math.round(y), width, height, maximized: saved?.maximized === true }
}

export function readWindowState(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return undefined }
}
export function writeWindowState(file: string, state: WindowState): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify(state), { mode: 0o600 })
  renameSync(file + '.tmp', file)
}
