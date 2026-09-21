# 資料庫維護工具:套用 migration、寫入預設分類、建立/重設帳號。
#
# 為什麼要獨立一個映像:新機器只裝 Docker 就要能把系統建起來,而
# `drizzle-kit migrate` 與 `tsx` 都是 packages/db 的 devDependency ——
# 沒有這個容器,新機器還得先裝 Node 與 pnpm 才能套 migration。
#
# 它是**一次性工具**,不是常駐服務:compose 裡掛 profile,平常不會啟動。
#   docker compose run --rm tools pnpm db:migrate

FROM node:22-alpine
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/
# 要 drizzle-kit 與 tsx(都在 devDependencies),所以不能用 --prod
RUN pnpm install --frozen-lockfile --filter @expense-receipts/db...

COPY packages ./packages

# root 的 scripts 用 dotenv 注入 .env;容器裡環境變數由 compose 給,
# 所以直接呼叫 package 自己的 script,不經 root
WORKDIR /repo/packages/db
CMD ["pnpm", "migrate"]
