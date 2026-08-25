FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN corepack enable && pnpm install --frozen-lockfile=false
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 1234
CMD ["node", "dist/server.js"]
