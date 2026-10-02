<template>
  <section class="page" data-module="cutting">
    <header class="page-head">
      <div>
        <h2>削坡减载管理</h2>
        <p class="page-desc">维护削坡工序，围绕工序编号、所属工程、削坡方量、坡比要求做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记削坡工序</button>
        <button class="btn" type="button" @click="triggerImport">导入削坡工序</button>
        <input
          ref="fileInput"
          type="file"
          accept=".csv,text/csv"
          hidden
          @change="onFilePicked"
        />
        <button class="btn" type="button" @click="exportRows">导出削坡减载清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item warn">环节只许按 待开工 → 施工中 → 待验收 → 已验收 顺序推进，不许回退</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-abnormal': row.abnormal }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.abnormal" class="tag-warn">待核对</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="actionsFor(row).length === 0" class="muted-text">已到末环</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无削坡减载数据，可先登记或导入削坡工序</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条削坡减载记录 · 累计削坡方量 {{ totalVolume }} m³（台账/统计/导入同一取数口径）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="importMessage" class="import-text">{{ importMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  importCuttingRows,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { VOLUME_FIELD, sumCuttingVolume } from '@/domain/cutting'
import { availableActions } from '@/domain/flow'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('cutting')
const columns = ["工序编号", "所属工程", "削坡方量", "坡比要求", "开挖高程", "设计依据", "验收日期", "验收人", "工序状态"]
const statuses = ["待开工", "施工中", "待验收", "已验收"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const importMessage = ref('')
const filters = ref<Record<string, string>>({})
const fileInput = ref<HTMLInputElement | null>(null)
const filterFields = [columns[0], columns[1], VOLUME_FIELD]

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 统计卡和页脚方量走同一取数函数，避免多个入口各取各的。
const stats = computed(() => [
  { label: '施工中工序', value: rows.value.filter((row) => row.status === '施工中').length },
  { label: '待验收工序', value: rows.value.filter((row) => row.status === '待验收').length },
  { label: '累计削坡方量', value: `${sumCuttingVolume(rows.value)} m³` },
])
const totalVolume = computed(() => sumCuttingVolume(rows.value))

function actionsFor(row: EntryRow): string[] {
  return availableActions(meta, String(row.status))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '削坡工序登记入口尚未接入审批流，批量数据请用「导入削坡工序」'
}

function triggerImport() {
  errorMessage.value = ''
  importMessage.value = ''
  fileInput.value?.click()
}

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }
  file.text().then((text) => {
    const result = importCuttingRows(text)
    importMessage.value = result.message
    if (result.errors.length > 0) {
      importMessage.value += `；${result.errors.slice(0, 3).join('；')}${result.errors.length > 3 ? ' 等' : ''}`
    }
    errorMessage.value = result.ok ? '' : result.message
    reload()
  }).catch(() => {
    errorMessage.value = `文件「${file.name}」读取失败`
  })
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '削坡减载列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.row-abnormal {
  background: #fef6ec;
}
.tag-warn {
  display: inline-block;
  margin-left: 6px;
  padding: 0 8px;
  border-radius: 999px;
  background: #f79009;
  color: #fff;
  font-size: 12px;
}
.muted-text {
  color: var(--muted);
  font-size: 12px;
}
.legend-item.warn {
  background: #fef3c7;
  color: #92400e;
}
.import-text {
  color: #1f6feb;
}
</style>
