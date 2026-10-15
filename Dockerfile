# ---- 依赖阶段 ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts：better-sqlite3 v13 的 .node 预编译产物随 npm 包发布
# （prebuilds/ 含 linuxmusl），无需 node-gyp 编译，跳过可避免镜像内装编译链
RUN npm ci --omit=dev --ignore-scripts --cache /tmp/npm-cache-probe

# ---- 构建阶段 ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
# tsc 在 devDependencies，构建阶段需完整安装（deps 阶段是 --omit=dev）
RUN npm ci --ignore-scripts --cache /tmp/npm-cache-probe
COPY src ./src
RUN npm run build

# ---- 运行阶段 ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY config ./config
COPY package.json ./
EXPOSE 3000
VOLUME /app/data
CMD ["node", "dist/index.js"]
