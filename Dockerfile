# The pinned PhotoCraft CLI and its compatibility libraries are Linux x86_64.
# Pin both stages so Apple Silicon hosts do not produce an incompatible ARM image.
FROM --platform=linux/amd64 node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM --platform=linux/amd64 node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/boot.js"]
