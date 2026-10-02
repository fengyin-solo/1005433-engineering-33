#!/usr/bin/env node
// 本地开发复位命令：把浏览器里残留的本地数据切回示例数据。
//
// 做法：改写 src/data/seed-version.ts 里的播种版本号。前端下次加载（dev server
// 开着的话走热更新）发现浏览器里存的版本对不上，就清掉 localStorage 里的旧台账
// 重新播种——削坡工序回到示例数据，治理工程等模块的清单条数也跟着回到初始。
//
// 路径全部从脚本所在位置推导，不写死绝对路径，别人克隆到任何目录都能跑。

import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 跑之前先看依赖缺不缺：缺了就直接报出来，不闷头往下走。
const problems = []
if (!existsSync(path.join(frontendDir, 'package.json'))) {
  problems.push('没找到 frontend/package.json，请确认在完整克隆的仓库里运行')
}
if (!existsSync(path.join(frontendDir, 'node_modules'))) {
  problems.push('缺少 frontend/node_modules，请先跑 npm install（或仓库根目录的 make install）')
}
for (const file of ['src/data/seed.ts', 'src/data/local-store.ts']) {
  if (!existsSync(path.join(frontendDir, file))) {
    problems.push(`缺少 frontend/${file}，仓库可能没拉全`)
  }
}
if (problems.length > 0) {
  console.error('复位中止，先补齐依赖：')
  for (const problem of problems) {
    console.error(`  - ${problem}`)
  }
  process.exit(1)
}

const versionFile = path.join(frontendDir, 'src', 'data', 'seed-version.ts')
const token = `seed-${Date.now().toString(36)}`
const content = `// 本地播种版本号：跑 \`npm run reset\`（或仓库根目录的 \`make reset\`）时由脚本改写，请勿手改。
// 浏览器里存的版本对不上这个值，local-store 就会清掉旧数据重新播种，
// 削坡工序、治理工程等模块一起回到示例数据。
export const SEED_VERSION = '${token}'
`
writeFileSync(versionFile, content, 'utf8')

console.log(`复位完成：播种版本已切换到 ${token}`)
console.log('下次打开或刷新页面时，削坡工序、治理工程等模块会回到示例数据；')
console.log('dev server 正在跑的话，热更新会自动生效，不用重启。')
