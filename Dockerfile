FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.6.2 --activate

# Copy only package files first for better layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/kbf/package.json packages/kbf/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/agent/package.json apps/agent/
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/ apps/
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.6.2 --activate

# Copy only what's needed at runtime
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/shared/dist/ packages/shared/dist/
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/db/dist/ packages/db/dist/
COPY --from=builder /app/packages/db/package.json packages/db/
COPY --from=builder /app/packages/kbf/dist/ packages/kbf/dist/
COPY --from=builder /app/packages/kbf/package.json packages/kbf/
COPY --from=builder /app/apps/api/dist/ apps/api/dist/
COPY --from=builder /app/apps/api/package.json apps/api/
COPY --from=builder /app/apps/web/dist/ apps/web/dist/
RUN pnpm install --prod --frozen-lockfile

# Run as non-root user
RUN addgroup -S tarmak && adduser -S tarmak -G tarmak
RUN mkdir -p /data && chown tarmak:tarmak /data
USER tarmak

ENV PORT=4000
ENV DATABASE_PATH=/data/tarmak.db
EXPOSE 4000

CMD ["node", "apps/api/dist/index.js"]
