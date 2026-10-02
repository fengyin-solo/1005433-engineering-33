.PHONY: install frontend build reset check-deps

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

# 本地开发一键播种与复位：先体检依赖，再把播种版本 +1，
# 刷新浏览器后削坡工序与治理工程等清单一起回到示例数据。
reset:
	cd frontend && npm run dev:reset

# 只做依赖体检，不改任何文件。
check-deps:
	cd frontend && node scripts/dev-reset.mjs --check
