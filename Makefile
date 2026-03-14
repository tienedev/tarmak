.PHONY: dev front back build clean install kill

CARGO := $(HOME)/.cargo/bin/cargo

# Kill any running dev processes
kill:
	@pkill -f "target/debug/kanwise" 2>/dev/null || true
	@pkill -f "target/release/kanwise" 2>/dev/null || true
	@pkill -f "node.*vite" 2>/dev/null || true
	@sleep 1

# Start backend, wait until healthy, then start frontend
dev: kill
	@$(MAKE) back &
	@printf "Waiting for backend..."
	@until curl -sf http://localhost:3001/api/v1/health > /dev/null 2>&1; do printf "."; sleep 0.5; done
	@echo " ready."
	@$(MAKE) front

# Frontend dev server (port 3000)
front:
	cd frontend && npm run dev

# Backend dev server (port 3001)
back:
	$(CARGO) run

# Production build (frontend + backend)
build:
	cd frontend && npm run build
	$(CARGO) build --release
	@echo "Binary at target/release/kanwise"

# Install frontend dependencies
install:
	cd frontend && npm install

# Clean build artifacts
clean:
	$(CARGO) clean
	rm -rf frontend/dist
