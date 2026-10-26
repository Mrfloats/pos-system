# Floatly API (NestJS). Built from the repository root:
#   docker build -f docker/api.Dockerfile .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/backoffice/package.json apps/backoffice/
RUN npm ci --workspace apps/api --include-workspace-root=false
COPY apps/api apps/api
RUN npm run build -w apps/api \
 && npm prune --omit=dev --workspace apps/api --include-workspace-root=false

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
WORKDIR /app/apps/api
USER node
EXPOSE 4000
# Bring the database up to date, then start the API.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/main.js"]
