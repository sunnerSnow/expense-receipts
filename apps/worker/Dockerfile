# 背景工作程序(AI 辨識、月結匯出)。建置情境是 monorepo 根目錄。
#
# 與 web 不同,worker 沒有打包步驟 —— 直接用 tsx 執行 TypeScript。
# 自用規模下這比多維護一套 tsc 輸出設定划算,啟動慢的那零點幾秒無感。

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---------- deps ----------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/
# worker 要 tsx(在 devDependencies),所以不能用 --prod
RUN pnpm install --frozen-lockfile --filter @expense-receipts/worker...

# ---------- runner ----------
FROM base AS runner
ENV NODE_ENV=production

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /repo/packages ./packages
COPY pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker

RUN mkdir -p /data/uploads /data/exports && chown -R node:node /data
USER node

WORKDIR /repo/apps/worker
# 不經 pnpm:少一層程序,容器收到 SIGTERM 時能直接傳給 node,
# 讓 index.ts 的 shutdown（boss.stop()）真的跑得到。
#
# tsx 在**套件自己的** node_modules/.bin,不在 repo 根 —— pnpm 只會把
# workspace 套件自己宣告的相依放進該套件的 .bin(踩過一次)。
CMD ["node_modules/.bin/tsx", "src/index.ts"]
