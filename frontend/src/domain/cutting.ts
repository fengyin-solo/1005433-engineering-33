import type { EntryRow } from '@/data/types'

// 削坡工序的领域口径：削坡方量、坡比要求、开挖高程三个量在台账、统计卡、导入
// 汇总等任何入口都走这里解析，禁止各入口各写一套正则。

// 坡比系数（竖直 1 对应水平 n 中的 n）业务允许范围：陡于 1:0.5 或缓于 1:2 视为无效。
export const SLOPE_RATIO_MIN = 0.5
export const SLOPE_RATIO_MAX = 2

// 开挖高程（米）业务允许范围：0～9999m，越界或解析不出按无效处理。
export const ELEVATION_MIN = 0
export const ELEVATION_MAX = 9999

// 削坡方量字段名：所有入口统一从这个键取数。
export const VOLUME_FIELD = '削坡方量'
export const SLOPE_RATIO_FIELD = '坡比要求'
export const ELEVATION_FIELD = '开挖高程'
export const DESIGN_BASIS_FIELD = '设计依据'

export type FieldState = 'valid' | 'invalid' | 'missing'

/** 削坡方量取数：支持 1200、1200.5、"1200m³"、"1,200 方" 等写法；空为缺失，无法解析为无效。 */
export function parseVolume(raw: unknown): { value: number | null; state: FieldState } {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { value: null, state: 'missing' }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw >= 0 ? { value: raw, state: 'valid' } : { value: null, state: 'invalid' }
  }
  const normalized = String(raw).replace(/[,，\s]/g, '').replace(/(?:m³|立方米|方|方量)$/i, '')
  const value = Number(normalized)
  if (Number.isFinite(value) && value >= 0) {
    return { value, state: 'valid' }
  }
  return { value: null, state: 'invalid' }
}

/**
 * 坡比取数：支持「1:0.75」「1：0.75」「0.75」（水平系数）三种写法，统一换算成水平系数。
 * 超出生意范围（含写反成 7.5 这类陡到不可能的值）按无效处理。
 */
export function parseSlopeRatio(raw: unknown): { value: number | null; state: FieldState } {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { value: null, state: 'missing' }
  }
  const text = String(raw).trim().replace(/[：∶]/g, ':')
  let value: number
  const colon = text.match(/^1:([0-9]*\.?[0-9]+)$/i)
  if (colon) {
    value = Number(colon[1])
  } else {
    const bare = text.match(/^([0-9]*\.?[0-9]+)$/)
    if (!bare) {
      return { value: null, state: 'invalid' }
    }
    value = Number(bare[1])
  }
  if (!Number.isFinite(value) || value < SLOPE_RATIO_MIN || value > SLOPE_RATIO_MAX) {
    return { value: null, state: 'invalid' }
  }
  return { value, state: 'valid' }
}

/** 开挖高程取数：剥离 m/米 等单位，范围 0～9999m，空为缺失，越界或无法解析为无效。 */
export function parseElevation(raw: unknown): { value: number | null; state: FieldState } {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { value: null, state: 'missing' }
  }
  const normalized = String(raw).replace(/[,，\s]/g, '').replace(/(?:m|米|高程)$/i, '')
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < ELEVATION_MIN || value > ELEVATION_MAX) {
    return { value: null, state: 'invalid' }
  }
  return { value, state: 'valid' }
}

export type DesignDecision = {
  basis: string
  slopeState: FieldState
  elevationState: FieldState
  /** 两个设计参数都不能用，整行拒收。 */
  rejected: boolean
}

/**
 * 坡比要求与开挖高程对不上时的业务判定：
 * 1. 坡比要求有效——以坡比为准（坡比是削坡成型的直接控制指标）；
 * 2. 坡比要求无效或缺失、开挖高程有效——退而按开挖高程控制，并提示坡比待核对；
 * 3. 两者都无效/缺失——参数不足，整行拒收。
 */
export function resolveDesignDecision(slopeRaw: unknown, elevationRaw: unknown): DesignDecision {
  const slope = parseSlopeRatio(slopeRaw)
  const elevation = parseElevation(elevationRaw)
  if (slope.state === 'valid') {
    return { basis: '按坡比控制', slopeState: slope.state, elevationState: elevation.state, rejected: false }
  }
  if (slope.state === 'invalid' && elevation.state === 'valid') {
    return { basis: '坡比无效，按高程控制', slopeState: slope.state, elevationState: elevation.state, rejected: false }
  }
  if (slope.state === 'missing' && elevation.state === 'valid') {
    return { basis: '坡比缺失，按高程控制', slopeState: slope.state, elevationState: elevation.state, rejected: false }
  }
  return { basis: '参数不足，无法判定', slopeState: slope.state, elevationState: elevation.state, rejected: true }
}

/** 累计削坡方量：所有入口（统计卡、导入汇总、导出）共用的取数口径，无效值不计入。 */
export function sumCuttingVolume(rows: readonly EntryRow[]): number {
  return rows.reduce((sum, row) => {
    const { value, state } = parseVolume(row[VOLUME_FIELD])
    return state === 'valid' && value !== null ? sum + value : sum
  }, 0)
}

export function formatVolume(value: number): string {
  return `${value} m³`
}
