// 示例数据的播种版本：scripts/dev-reset.mjs 每次复位会把这里 +1。
// 浏览器里存的版本和这里不一致时，local-store 会丢弃旧台账、重新播种示例数据，
// 这样「一条命令复位本地环境」不用碰浏览器，克隆下来的机器上也同样生效。
export const SEED_VERSION = 1
export const SEED_VERSION_STORAGE_KEY = 'geohazard-patrol:seed-version'
