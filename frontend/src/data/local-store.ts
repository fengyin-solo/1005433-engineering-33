import { SEED_ROWS } from './seed'
import { SEED_VERSION, SEED_VERSION_STORAGE_KEY } from './seed-version'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-patrol:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function writeSeed(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(SEED_VERSION_STORAGE_KEY, String(SEED_VERSION))
  }
  return fallback
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  // 播种版本对不上（跑过 dev:reset，或有人手工清了台账）：丢掉旧数据重新播种，
  // 保证削坡工序、治理工程清单一起回到示例数据，不用开发同学手动清浏览器存储。
  const storedVersion = window.localStorage.getItem(SEED_VERSION_STORAGE_KEY)
  if (storedVersion !== String(SEED_VERSION)) {
    return writeSeed()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return writeSeed()
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    return writeSeed()
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
