# 網頁伺服器。建置情境是 monorepo 根目錄(見 docker-compose.yml 的 context: .)。
#
# 分三段:deps 只裝相依、build 只建置、runner 只留執行需要的東西。
# 這樣改程式碼時不必重跑 pnpm install —— Docker 的層快取會沿用 deps 那層。

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---------- deps:先只複製 manifest,讓相依套件單獨成一層 ----------
FROM base AS deps
# 只有這些檔案變動時才需要重跑 install。原始碼改動不會讓這層失效。
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/
RUN pnpm install --frozen-lockfile

# ---------- build ----------
FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /repo/packages ./packages
COPY . .

# next build 的 collect page data 階段會真的執行 server 模組,而 lib/env.ts 會
# 驗證環境變數 —— 沒有值就會編譯失敗。這裡給的是**建置期的假值**,只為了通過
# 驗證;真正的值在執行時由 compose 的 env_file 注入,不會留在映像裡。
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    SESSION_SECRET=build-time-placeholder-not-used-at-runtime \
    COMPANY_TAX_ID= \
    UPLOAD_DIR=/data/uploads \
    EXPORT_DIR=/data/exports \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @expense-receipts/web build

# ---------- runner ----------
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# standalone 已經把用得到的 node_modules 一起輸出,不需要再 pnpm install。
# 目錄結構會保留 monorepo 的形狀(outputFileTracingRoot 是 repo 根)。
COPY --from=build /repo/apps/web/.next/standalone ./
# static 與 public 不在 standalone 追蹤範圍內,要自己補
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static

# 憑證影像與匯出檔掛在這裡(compose 的 volumes)
RUN mkdir -p /data/uploads /data/exports && chown -R node:node /data
USER node

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
