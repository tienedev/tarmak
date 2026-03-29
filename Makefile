.PHONY: dev back front agent build clean install kill test lint help

dev:
	pnpm dev

back:
	pnpm --filter=@tarmak/api dev

front:
	pnpm --filter=@tarmak/web dev

agent:
	pnpm --filter=@tarmak/agent dev

build:
	pnpm build

clean:
	rm -rf node_modules packages/*/dist apps/*/dist .turbo packages/*/.turbo apps/*/.turbo

install:
	pnpm install

kill:
	-pkill -f "tsx watch" 2>/dev/null || true
	-pkill -f "vite" 2>/dev/null || true

test:
	pnpm test

lint:
	pnpm lint

help:
	@echo "dev     - Start all dev servers"
	@echo "back    - Backend only"
	@echo "front   - Frontend only"
	@echo "agent   - Agent server only"
	@echo "build   - Production build"
	@echo "test    - Run all tests"
	@echo "lint    - Lint all packages"
	@echo "clean   - Clean artifacts"
	@echo "install - Install dependencies"
	@echo "kill    - Kill dev processes"
