# Floatly website (Next.js backoffice). Built from the repository root:
#   docker build -f docker/web.Dockerfile .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/backoffice/package.json apps/backoffice/
RUN npm ci --workspace apps/backoffice --include-workspace-root=false
COPY apps/backoffice apps/backoffice
# The website talks to the API on the same domain (Caddy sends /api/* to it).
ENV NEXT_PUBLIC_API_URL=/api/v1 NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w apps/backoffice

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# The standalone server, plus the static files it serves.
COPY --from=build /app/apps/backoffice/.next/standalone ./
COPY --from=build /app/apps/backoffice/.next/static ./apps/backoffice/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/backoffice/server.js"]
