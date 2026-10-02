import type { EntryRow, ModuleMeta } from '@/data/types'

// 环节型模块的流转工具：状态只能沿 statuses 逐环推进，不许回退、不许跳级。

/** 判断动作能否执行：目标状态必须恰好是当前状态的下一环。 */
export function orderedActionAllowed(meta: ModuleMeta, current: string, target: string): boolean {
  if (!meta.orderedFlow) {
    return true
  }
  const from = meta.statuses.indexOf(current)
  const to = meta.statuses.indexOf(target)
  return from >= 0 && to === from + 1
}

/** 当前环节允许执行的动作（只返回推进到下一环节的那个）；已到末环或状态未知时为空。 */
export function availableActions(meta: ModuleMeta, status: string): string[] {
  if (!meta.orderedFlow) {
    return meta.actions
  }
  const index = meta.statuses.indexOf(status)
  if (index < 0 || index >= meta.statuses.length - 1) {
    return []
  }
  const nextStatus = meta.statuses[index + 1]
  return meta.actions.filter((action) => meta.actionTargets[action] === nextStatus)
}
