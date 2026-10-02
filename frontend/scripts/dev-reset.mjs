#!/usr/bin/env node
/**
 * 本地开发一键播种与复位：
 *   npm run dev:reset
 *
 * 跑完之后：
 *   1. 先做依赖体检（node/npm、node_modules、关键包），缺依赖给出明确提示并退出；
 *   2. 把 src/data/seed-version.ts 里的 SEED_VERSION +1（路径相对脚本自身定位，
 *      不钉死任何绝对路径，克隆到任何目录都能跑）；
 *   3. 浏览器下次打开/刷新时发现播种版本对不上，会把 localStorage 旧台账整体清掉，
 *      按最新示例数据重新播种——削坡工序回到示例数据，治理工程等清单条数一起回到初始。
 *
 * 可选：
 *   node scripts/dev-reset.mjs --check   只做依赖体检，不改文件
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = join(scriptDir, '..')
const rootDir = join(frontendDir, '..')
const seedVersionFile = join(frontendDir, 'src', 'data', 'seed-version.ts')
const packageFile = join(frontendDir, 'package.json')

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function ok(message) {
  console.log(`✓ ${message}`)
}

// ---- 1. 运行环境体检：node / npm 版本与仓库结构 ---------------------------------

const nodeMajor = Number(process.versions.node.split('.')[0])
if (Number.isNaN(nodeMajor) || nodeMajor < 18) {
  fail(`Node.js 版本过低（当前 ${process.versions.node}），需要 18 及以上，请先升级 Node`)
}
ok(`Node.js ${process.versions.node}`)

if (!existsSync(packageFile)) {
  fail(`找不到 ${packageFile}，请在克隆下来的仓库根目录或 frontend/ 下通过 npm 运行本命令`)
}
if (!existsSync(seedVersionFile)) {
  fail(`找不到播种版本文件 ${seedVersionFile}，请确认在完整克隆的仓库里运行`)
}
ok('仓库结构完整（frontend/package.json、src/data/seed-version.ts 在位）')

// ---- 2. 依赖体检：node_modules 与关键包在不在 -----------------------------------

const nodeModulesDir = join(frontendDir, 'node_modules')
if (!existsSync(nodeModulesDir)) {
  fail(
    [
      '依赖还没安装（frontend/node_modules 不存在）。',
      '请先执行：npm install  （或在仓库根目录执行 make install）',
      '安装完成后重新跑 npm run dev:reset。',
    ].join('\n  '),
  )
}
ok('node_modules 已存在')

const requireFromFrontend = createRequire(join(frontendDir, 'package.json'))
const pkg = JSON.parse(readFileSync(packageFile, 'utf8'))
const requiredPackages = [
  ...Object.keys(pkg.dependencies ?? {}),
  'vite',
  'vue-tsc',
  'typescript',
]
const missing = []
for (const name of requiredPackages) {
  try {
    requireFromFrontend.resolve(name)
  } catch {
    missing.push(name)
  }
}
if (missing.length > 0) {
  fail(
    [
      `以下依赖在 node_modules 里找不到：${missing.join('、')}`,
      '请先执行：npm install  （或在仓库根目录执行 make install）',
      '安装完成后重新跑 npm run dev:reset。',
    ].join('\n  '),
  )
}
ok(`关键依赖齐全（vue / vite / vue-tsc 等 ${requiredPackages.length} 项）`)

// ---- 可选 --check：只体检 -------------------------------------------------------------------

if (process.argv.includes('--check')) {
  console.log('\n依赖体检通过，可以启动开发环境或执行复位。')
  process.exit(0)
}

// ---- 3. 播种版本 +1，驱动浏览器端重新播种 ---------------------------------------------------

const source = readFileSync(seedVersionFile, 'utf8')
const matched = source.match(/export const SEED_VERSION = (\d+)/)
if (!matched) {
  fail(`无法从 ${seedVersionFile} 解析 SEED_VERSION，请检查文件是否被改动`)
}
const oldVersion = Number(matched[1])
const newVersion = oldVersion + 1
writeFileSync(
  seedVersionFile,
  source.replace(matched[0], `export const SEED_VERSION = ${newVersion}`),
  'utf8',
)
ok(`播种版本 SEED_VERSION：${oldVersion} → ${newVersion}`)

console.log(`
复位已完成。请刷新（或重新打开）浏览器页面：
  · localStorage 里上一轮的工序编号、削坡方量、坡比要求、开挖高程等旧台账会被整体丢弃
  · 削坡工序回到示例数据，治理工程等全部模块的清单条数一起回到初始
  · dev server 若已在运行，Vite 会因 seed-version.ts 变化自动整页刷新；没有运行就 npm run dev
`)
