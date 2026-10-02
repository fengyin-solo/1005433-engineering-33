import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  DESIGN_BASIS_FIELD,
  ELEVATION_FIELD,
  SLOPE_RATIO_FIELD,
  VOLUME_FIELD,
  parseVolume,
  resolveDesignDecision,
} from '@/domain/cutting'
import { orderedActionAllowed } from '@/domain/flow'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

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
  // 环节型模块（削坡工序）：待开工→施工中→待验收→已验收，只许逐环前进。
  // 回退（已验收再开工等）和跳级（待开工直接提交验收）一律拦下。
  if (!orderedActionAllowed(meta, current, target)) {
    return {
      ok: false,
      message: `${meta.entity}环节不许回退/跳级：「${current}」不能直接流转到「${target}」`,
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const isNegative = NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    // 顺序流转模块的异常（如坡比待核对）要挂着核对，不能被正常推进动作顺手清掉。
    abnormal: meta.orderedFlow ? rows[index].abnormal === true || isNegative : isNegative,
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

export type CuttingImportResult = {
  ok: boolean
  message: string
  imported: number
  duplicated: number
  rejected: number
  totalVolume: number
  signboardCode: string | null
  errors: string[]
}

type ParsedCsv = {
  headers: string[]
  records: Record<string, string>[]
}

// 极简 CSV 解析：支持双引号包裹、引号内逗号与 "" 转义，够导入导出闭环用，不引第三方依赖。
function parseCsv(text: string): ParsedCsv {
  const source = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') {
        i += 1
      }
      row.push(field)
      field = ''
      if (row.some((cell) => cell.trim() !== '')) {
        rows.push(row)
      }
      row = []
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some((cell) => cell.trim() !== '')) {
      rows.push(row)
    }
  }
  if (rows.length === 0) {
    return { headers: [], records: [] }
  }
  const headers = rows[0].map((item) => item.trim())
  const records = rows.slice(1).map((cells) => {
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? '').trim()
    })
    return record
  })
  return { headers, records }
}

function todayText(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
}

/** 警示标识编号不与既有/本次台账撞号，统一从现有最大序号续编。 */
function nextSignboardCode(rows: EntryRow[]): string {
  let max = 0
  for (const row of rows) {
    const code = String(row['标识编号'] ?? '')
    const matched = code.match(/^SIGN-(\d+)$/)
    if (matched) {
      max = Math.max(max, Number(matched[1]))
    }
  }
  return `SIGN-${String(max + 1).padStart(4, '0')}`
}

/**
 * 导入削坡工序（CSV，表头需含工序编号/所属工程/削坡方量/坡比要求/开挖高程）。
 * - 重复导入按第一次已收处理：工序编号已在台账里的整行跳过，不重复入库、不重复挂标识；
 * - 坡比要求与开挖高程的业务判定、坡比超范围按无效处理，统一走 domain/cutting；
 * - 导入收尾驱动警示标识台账：本批有新收工序时，向 signboard 补一条「待核对工序」。
 */
export function importCuttingRows(text: string): CuttingImportResult {
  const { records } = parseCsv(text)
  const empty: CuttingImportResult = {
    ok: false,
    message: '导入文件里没有可读取的数据行',
    imported: 0,
    duplicated: 0,
    rejected: 0,
    totalVolume: 0,
    signboardCode: null,
    errors: [],
  }
  if (records.length === 0) {
    return empty
  }

  const cutting = listRows('cutting')
  const existingCodes = new Set(cutting.map((row) => String(row['工序编号'] ?? '').trim()))
  const accepted: EntryRow[] = []
  const batchCodes = new Set<string>()
  let duplicated = 0
  const errors: string[] = []

  records.forEach((record, lineIndex) => {
    const lineNo = lineIndex + 2
    const code = (record['工序编号'] ?? '').trim()
    const project = (record['所属工程'] ?? '').trim()
    const volumeRaw = record[VOLUME_FIELD] ?? ''
    const slopeRaw = record[SLOPE_RATIO_FIELD] ?? ''
    const elevationRaw = record[ELEVATION_FIELD] ?? ''

    if (!code) {
      errors.push(`第${lineNo}行：缺少工序编号，已拒收`)
      return
    }
    // 既在台账里、又在本文件前面行里出现过的，都按「第一次已收」处理。
    if (existingCodes.has(code) || batchCodes.has(code)) {
      duplicated += 1
      return
    }
    batchCodes.add(code)

    if (!project) {
      errors.push(`第${lineNo}行（${code}）：缺少所属工程，已拒收`)
      return
    }
    const volume = parseVolume(volumeRaw)
    if (volume.state !== 'valid' || volume.value === null) {
      errors.push(`第${lineNo}行（${code}）：削坡方量「${volumeRaw}」无法识别，已拒收`)
      return
    }
    const decision = resolveDesignDecision(slopeRaw, elevationRaw)
    if (decision.rejected) {
      errors.push(`第${lineNo}行（${code}）：坡比要求与开挖高程均无效/缺失，已拒收`)
      return
    }

    accepted.push({
      id: 0,
      status: '待开工',
      pending: true,
      // 坡比无效但高程兜得住的工序要挂异常，提醒现场核对坡比。
      abnormal: decision.slopeState === 'invalid',
      '工序编号': code,
      '所属工程': project,
      [VOLUME_FIELD]: volume.value,
      [SLOPE_RATIO_FIELD]: slopeRaw,
      [ELEVATION_FIELD]: elevationRaw,
      [DESIGN_BASIS_FIELD]: decision.basis,
      '验收日期': '',
      '验收人': '',
      '工序状态': '待开工',
    })
  })

  if (accepted.length === 0) {
    const rejectedCount = records.length - duplicated
    return {
      ...empty,
      message:
        duplicated > 0
          ? `本批没有新收工序：重复 ${duplicated} 行已按第一次已收跳过${
              rejectedCount > 0 ? `，拒收 ${rejectedCount} 行` : ''
            }，台账未变动`
          : empty.message,
      duplicated,
      rejected: rejectedCount,
      errors,
    }
  }

  const nextCutting = [...cutting]
  let nextIdValue = nextId(cutting)
  for (const row of accepted) {
    row.id = nextIdValue
    nextIdValue += 1
    nextCutting.push(row)
  }
  saveRows('cutting', nextCutting)

  // 导入收尾：一批新收工序驱动一条「待核对工序」上警示标识台账，重复导入不会重复挂账。
  const signboard = listRows('signboard')
  const signboardCode = nextSignboardCode(signboard)
  const referenceCodes = accepted.map((row) => String(row['工序编号'])).join('、')
  const signRow: EntryRow = {
    id: nextId(signboard),
    status: '待设置',
    pending: true,
    abnormal: accepted.some((row) => row.abnormal),
    '标识编号': signboardCode,
    '所属隐患点': `削坡导入待核对：${referenceCodes}`,
    '标识类别': '待核对工序',
    '设置位置': `对应削坡工序 ${accepted.length} 道（${referenceCodes}），导入后需现场核对坡比/高程`,
    '设置日期': todayText(),
    '责任人': '',
    '更换日期': '',
    '标识状态': '待设置',
  }
  saveRows('signboard', [...signboard, signRow])

  const totalVolume = accepted.reduce((sum, row) => sum + parseVolume(row[VOLUME_FIELD]).value!, 0)
  const summary = `导入完成：新收 ${accepted.length} 道，重复 ${duplicated} 行（按第一次已收跳过），拒收 ${
    records.length - accepted.length - duplicated
  } 行；本批削坡方量合计 ${totalVolume} m³；警示标识台账新增 ${signboardCode}（待核对工序）`

  return {
    ok: true,
    message: summary,
    imported: accepted.length,
    duplicated,
    rejected: records.length - accepted.length - duplicated,
    totalVolume,
    signboardCode,
    errors,
  }
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
