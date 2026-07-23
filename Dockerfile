FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/atlas-check/package.json packages/atlas-check/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/execution-passports/package.json packages/execution-passports/package.json
COPY packages/exports/package.json packages/exports/package.json
COPY packages/extractor/package.json packages/extractor/package.json
COPY packages/federation/package.json packages/federation/package.json
COPY packages/github/package.json packages/github/package.json
COPY packages/knowledge/package.json packages/knowledge/package.json
COPY packages/protocols/package.json packages/protocols/package.json
COPY packages/trust/package.json packages/trust/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/zenodo/package.json packages/zenodo/package.json

RUN pnpm install --frozen-lockfile

COPY . .

# Production uses the checked-in PostgreSQL schema while local development
# continues to use packages/db/prisma/schema.prisma (SQLite).
RUN pnpm --filter @oratlas/db exec prisma generate --schema prisma/schema.postgres.prisma
RUN pnpm --filter @oratlas/web build
RUN pnpm prune --prod

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app
COPY --from=build /app /app

USER node
EXPOSE 8080

CMD ["sh", "-c", "pnpm --filter @oratlas/web start -- -H 0.0.0.0 -p ${PORT:-8080}"]
