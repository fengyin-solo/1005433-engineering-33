import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ImportResult,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 环节按顺序流转，不许回退也不许跳环节：目标状态必须是当前状态的下一环
  const currentIndex = meta.statuses.indexOf(current)
  const targetIndex = meta.statuses.indexOf(target)
  if (currentIndex < 0 || targetIndex !== currentIndex + 1) {
    return {
      ok: false,
      message: `${meta.entity}要按「${meta.statuses.join('→')}」顺序流转，不能从「${current}」直接到「${target}」`,
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// —— 削坡方量统一取数 ——
// 页面统计卡、看板、导出都从这里拿，别各算各的。

function toFiniteNumber(value: unknown): number {
  const num = Number(String(value ?? '').trim())
  return Number.isFinite(num) ? num : 0
}

export function cuttingVolumeTotal(): number {
  return listRows('cutting').reduce((sum, row) => sum + toFiniteNumber(row['削坡方量']), 0)
}

export function cuttingStats(): { label: string; value: number }[] {
  const meta = moduleMeta('cutting')
  const rows = listRows('cutting')
  const counters: Record<string, () => number> = {
    施工中工序: () => rows.filter((row) => row.status === '施工中').length,
    待验收工序: () => rows.filter((row) => row.status === '待验收').length,
    累计削坡方量: cuttingVolumeTotal,
  }
  return meta.metrics.map((label) => ({ label, value: counters[label]?.() ?? 0 }))
}

// —— 清单导入 ——
// 重复导入按第一次已收处理：业务编号已存在的行直接跳过，不覆盖、不报错。

type RowCheck = { valid: boolean; abnormal?: boolean; reason?: string }

// 坡比要求的合法区间：1:0.5（陡）到 1:3（缓），超出范围按无效处理。
const SLOPE_RATIO_MIN = 0.5
const SLOPE_RATIO_MAX = 3

function parseSlopeRatio(raw: unknown): number | null {
  const text = String(raw ?? '').trim()
  if (!text) {
    return null
  }
  const match = text.match(/^(?:1\s*[:：]\s*)?(\d+(?:\.\d+)?)$/)
  if (!match) {
    return null
  }
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

// 削坡工序的导入校验：坡比要求优先于开挖高程。
// 坡比要求超出范围 → 整条按无效处理；坡比合格但开挖高程对不上（缺失或读不出数）→
// 以坡比要求为准收下，记录标异常，留待现场核对开挖高程。
function checkCuttingRow(row: EntryRow): RowCheck {
  const ratio = parseSlopeRatio(row['坡比要求'])
  if (ratio === null || ratio < SLOPE_RATIO_MIN || ratio > SLOPE_RATIO_MAX) {
    return {
      valid: false,
      reason: `坡比要求「${String(row['坡比要求'] ?? '')}」超出范围（${SLOPE_RATIO_MIN}~${SLOPE_RATIO_MAX}），按无效处理`,
    }
  }
  const elevation = String(row['开挖高程'] ?? '').trim()
  if (!elevation || !Number.isFinite(Number(elevation))) {
    return { valid: true, abnormal: true }
  }
  return { valid: true }
}

const ROW_CHECKS: Record<string, (row: EntryRow) => RowCheck> = {
  cutting: checkCuttingRow,
}

// 导入收尾的结果驱动警示标识台账：每收下一条削坡工序，
// 警示标识那边就多一条待核对记录，提醒去作业面核对警示设置。
function followUpSignboards(cuttingRows: EntryRow[]): number {
  const meta = moduleMeta('signboard')
  const boards = listRows('signboard')
  let nextId = boards.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  let nextCode = boards.reduce((max, row) => {
    const match = String(row['标识编号'] ?? '').match(/(\d+)$/)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  const today = new Date().toISOString().slice(0, 10)
  const created: EntryRow[] = cuttingRows.map((row) => {
    nextCode += 1
    const board: EntryRow = {
      id: nextId,
      status: meta.statuses[0],
      pending: true,
      abnormal: false,
      标识编号: `SIGN-${String(nextCode).padStart(4, '0')}`,
      所属隐患点: String(row['所属工程'] ?? ''),
      标识类别: '削坡作业警示',
      设置位置: `削坡工序${String(row['工序编号'] ?? '')}作业面`,
      设置日期: today,
      责任人: '待核对',
      更换日期: '',
      标识状态: '待核对',
    }
    nextId += 1
    return board
  })
  saveRows('signboard', [...boards, ...created])
  return created.length
}

export function importEntries(key: string, csvText: string): ImportResult {
  const meta = moduleMeta(key)
  const fail = (message: string): ImportResult => ({
    ok: false,
    added: 0,
    duplicates: 0,
    invalid: 0,
    signboards: 0,
    message,
  })
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (lines.length < 2) {
    return fail('导入文件是空的，或只有表头没有数据行')
  }
  const header = lines[0].split(',').map((cell) => cell.trim())
  const codeField = meta.fields[0]
  if (!header.includes(codeField)) {
    return fail(`导入文件缺少「${codeField}」列，没法比对是否重复`)
  }
  const rows = listRows(key)
  const seen = new Set(rows.map((row) => String(row[codeField] ?? '')))
  let nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const statusField = meta.fields.find((field) => field.endsWith('状态'))
  const check = ROW_CHECKS[key]
  const addedRows: EntryRow[] = []
  const invalidReasons: string[] = []
  let duplicates = 0
  let invalid = 0
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((cell) => cell.trim())
    const record: Record<string, string> = {}
    header.forEach((name, index) => {
      record[name] = cells[index] ?? ''
    })
    const code = record[codeField] ?? ''
    if (code && seen.has(code)) {
      duplicates += 1
      continue
    }
    const row: EntryRow = { id: nextId, status: meta.statuses[0], pending: true, abnormal: false }
    for (const field of meta.fields) {
      row[field] = record[field] ?? ''
    }
    if (statusField) {
      row[statusField] = meta.statuses[0]
    }
    if (key === 'cutting') {
      const volumeText = String(row['削坡方量'] ?? '').trim()
      if (volumeText !== '' && Number.isFinite(Number(volumeText))) {
        row['削坡方量'] = Number(volumeText)
      }
    }
    if (check) {
      const result = check(row)
      if (!result.valid) {
        invalid += 1
        if (result.reason) {
          invalidReasons.push(`${code || '未编号'}：${result.reason}`)
        }
        continue
      }
      if (result.abnormal) {
        row.abnormal = true
      }
    }
    seen.add(code)
    nextId += 1
    addedRows.push(row)
  }
  if (addedRows.length > 0) {
    saveRows(key, [...rows, ...addedRows])
  }
  let signboards = 0
  if (key === 'cutting' && addedRows.length > 0) {
    signboards = followUpSignboards(addedRows)
  }
  const parts = [
    `新增 ${addedRows.length} 条`,
    `重复 ${duplicates} 条按第一次已收处理`,
    `无效 ${invalid} 条`,
  ]
  if (signboards > 0) {
    parts.push(`警示标识台账新增 ${signboards} 条待核对`)
  }
  const detail = invalidReasons.length > 0 ? `（${invalidReasons.join('；')}）` : ''
  return {
    ok: true,
    added: addedRows.length,
    duplicates,
    invalid,
    signboards,
    message: `导入完成：${parts.join('，')}${detail}`,
  }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
