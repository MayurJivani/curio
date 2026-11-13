FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npx vitest run && npx vite build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4431 DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY shared ./shared
COPY server ./server
VOLUME /data
EXPOSE 4431
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:4431/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "server/index.ts"]
