.PHONY: dev front back agent build clean install kill cli

-include .env
export

CARGO := $(HOME)/.cargo/bin/cargo

# Kill any running dev processes
kill:
	@pkill -f "target/debug/kanwise" 2>/dev/null || true
	@pkill -f "target/release/kanwise" 2>/dev/null || true
	@pkill -f "node.*vite" 2>/dev/null || true
	@sleep 1

# Start backend, wait until healthy, then start agent + frontend
dev: kill
	@$(MAKE) back &
	@printf "Waiting for backend..."
	@until curl -sf http://localhost:4000/api/v1/health > /dev/null 2>&1; do printf "."; sleep 0.5; done
	@echo " ready."
	@$(MAKE) agent &
	@printf "Waiting for agent..."
	@until curl -sf http://localhost:9876/health > /dev/null 2>&1; do printf "."; sleep 0.5; done
	@echo " ready."
	@$(MAKE) front

# Frontend dev server (port 3000)
front:
	cd frontend && corepack pnpm run dev

# Backend dev server (port 4000)
back:
	$(CARGO) run --bin kanwise

# Agent server (port 9876) — auto-login to get a token
agent:
	@TOKEN=$$(curl -sf http://localhost:4000/api/v1/auth/login \
		-H 'Content-Type: application/json' \
		-d '{"email":"$(KANWISE_EMAIL)","password":"$(KANWISE_PASSWORD)"}' \
		| python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null) && \
	if [ -z "$$TOKEN" ]; then echo "Warning: could not auto-login for agent (set KANWISE_EMAIL and KANWISE_PASSWORD)"; exit 0; fi && \
	$(CARGO) run --bin kanwise -- agent --server http://localhost:4000 --token "$$TOKEN"

# Production build (frontend + backend)
build:
	cd frontend && corepack pnpm run build
	$(CARGO) build --release
	@echo "Binary at target/release/kanwise"

# Install frontend dependencies
install:
	cd frontend && corepack pnpm install

# Build kanwise-cli
cli:
	$(CARGO) build -p kanwise-cli

# Clean build artifacts
clean:
	$(CARGO) clean
	rm -rf frontend/dist frontend/node_modules
