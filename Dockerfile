# Stage 1: Build frontend
FROM node:22-alpine AS frontend
RUN corepack enable
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# Stage 2: Build backend
FROM rust:1.85-alpine AS backend
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY --from=frontend /app/frontend/dist ./frontend/dist
RUN cargo build --release

# Stage 3: Runtime
FROM alpine:3.21
RUN apk add --no-cache ca-certificates && mkdir -p /data
COPY --from=backend /app/target/release/cortx /usr/local/bin/
EXPOSE 3001
ENV DATABASE_PATH=/data/cortx.db
CMD ["cortx", "web"]
