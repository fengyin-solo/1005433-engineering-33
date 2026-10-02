.PHONY: install frontend build reset

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

# 复位本地数据：削坡工序、治理工程等模块回到示例数据（跑之前脚本会先查依赖）
reset:
	cd frontend && npm run reset
