FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile

# Build frontend
COPY packages/web/ packages/web/
RUN cd packages/web && bunx vite build

# Copy server source
COPY packages/server/ packages/server/

# Production
FROM oven/bun:1-slim
WORKDIR /app

COPY --from=base /app/package.json /app/bun.lock ./
COPY --from=base /app/packages/server/ packages/server/
COPY --from=base /app/packages/web/dist packages/web/dist
COPY --from=base /app/node_modules node_modules
COPY --from=base /app/packages/server/node_modules packages/server/node_modules

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["bun", "run", "packages/server/index.ts"]
