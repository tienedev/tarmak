# Stage 1: Build frontend
FROM node:22-alpine AS frontend
RUN corepack enable
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# Stage 2: Build backend
FROM rust:1-alpine AS backend
RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY --from=frontend /app/frontend/dist ./frontend/dist
RUN cargo build --release

# Stage 3: Runtime
FROM alpine:3.21
RUN apk add --no-cache ca-certificates && mkdir -p /data
COPY --from=backend /app/target/release/kanwise /usr/local/bin/
EXPOSE 4000
ENV PORT=4000
ENV DATABASE_PATH=/data/kanwise.db
CMD ["kanwise", "serve"]
