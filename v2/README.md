# InvestNexus v2 — Milestone 2

在 PostgreSQL 事务、可信登录和账户权限之上，接入 Market Data → Valuation / P&L → 完整对账 → Daily Snapshot → Client Performance Report。

## 本地启动

Node.js 22.13+；所有命令在 `v2/` 目录执行。

```sh
npm ci
cp .env.example .env
npm run build
```

开一个终端运行数据库（二选一，不要同时占用 55432）：

```sh
docker compose up -d postgres
# 或不使用 Docker，运行真正的本地 PostgreSQL：
npm run db:local
```

数据库启动后：

```sh
npm run migrate
npm run demo:seed
npm start
```

另一个终端运行报告 worker：

```sh
npm run worker
```

再开一个终端运行行情 worker：

```sh
npm run market:worker
```

浏览器打开 http://localhost:4200。首次运行必须构建，`public/app.js`、`public/app.css`、`dist/` 是构建产物，不提交 Git。环境变量和本地数据库数据也不提交。

## 演示用户

`.env.example` 的 `DEMO_PASSWORD` 为 `LocalDemo-2026!`。修改该值后首次 seed 才会设置对应密码；重复 seed 不覆盖已有用户密码或账户数据。

| 用户 | 工作区 | 账户 |
| --- | --- | --- |
| pm@investnexus.local | Investment / Client | Horizon Growth |
| ops@investnexus.local | Operations / Client | Horizon Growth |
| client@investnexus.local | Client（只读） | Horizon Growth |
| other@investnexus.local | Investment / Client | Independent Growth |

注册创建自己的独立投资账户，初始模拟现金 $100,000，不会授予 Operations 权限。角色从 PostgreSQL membership 查询；请求中的 actor、persona 或 accountId 不能授予权限。

## Milestone 2 演示流程

1. PM 创建 BUY 100 MSFT，Approve，分 60 / 40 股执行。
2. Operations 推进业务日期，逐笔 Settle。账本得到 100 股、$58,990 现金；行情变化不会修改现金或持仓数量。
3. Operations 点击 Refresh market，等待任务 COMPLETE；行情 worker 获取四种证券的日期价格与历史。也可用 `npm run market:refresh -- 2026-09-21` 手动刷新。
4. 完整对账表单填写当天日期、账本现金以及 broker 持仓 JSON，例如 `[{"symbol":"MSFT","quantity":98}]`。现金和证券分别生成匹配项或差异；遗漏的持仓按 broker 数量 0 对账。
5. 差异必须调查后填写说明 Resolve。说明不会直接改账；正式报告标注 `RESOLVED_WITH_EXCEPTIONS`，保留原始差异与说明。
6. 行情 FRESH、刷新无错误、完整对账与当前账本版本一致后，点击 Close valuation & publish。每天仅能关闭一次；关闭后金融操作被锁定，须先推进日期。
7. 客户查看累计收益、相邻业务日日收益、VTI 价格基准和超额收益，worker 完成后 Export report 下载 JSON。再次推进日期、刷新、对账、日结，可看到跨日业绩曲线。

## 行情、估值与收益口径

默认 `MARKET_PROVIDER=mock`：固定锚点、可重复的模拟历史价格，支持演示日期推进，明确标记模拟来源。它不是实时行情。

使用自己的 Alpha Vantage key：

```dotenv
MARKET_PROVIDER=alpha-vantage
ALPHA_VANTAGE_API_KEY=your_own_key
MARKET_POLL_SECONDS=3600
```

重启 API 与行情 worker。适配器使用 `TIME_SERIES_DAILY` 的日收盘价，串行拉取 MSFT、AAPL、NVDA、VTI；依赖你的 API 配额。网络、配额、格式失败不会发布部分批次或切回模拟价格。未来业务日期不允许真实行情刷新。行情日期与业务日期不一致会显示 STALE，并阻止成交和日结；本 MVP 只按周末处理业务日，未接交易所节假日日历，因此节假日也会阻止日结。

每个价格保存来源、价格日期、获取时间及批次。历史查询仅使用截至业务日期的价格，不使用未来价格。估值缺少持仓价格时显示 INCOMPLETE 和空值，仍保留账本现金和持仓；结算不依赖行情服务。

成本为整数 cents 加权成本，部分卖出按比例四舍五入、最后一笔消耗剩余成本。已实现/未实现 P&L 为价格损益，手续费单独展示并计入组合总价值。累计收益为 `(总价值 / 初始资金 - 1)`；VTI 基准按账户成立日可用收盘价归一化；超额收益为两者百分点差。相邻业务日日结计算日收益，缺日只展示区间收益，日收益为空。暂不支持入金/出金后的 TWR、分红再投资、拆股或其他公司行动；真实适配器使用未调整的收盘价，基准是价格收益，不是总回报。一个业绩序列不能混用行情来源。

日结记录、价格批次、行情和报告均受数据库追加式保护。报告冻结当时的行情、持仓、对账、业绩序列和已结算交易；随后刷新价格不会改写历史报告。结算产生的旧快照仍保留，但客户正式导出使用 `/api/report?scope=daily`，需完成日结。

## 可选 Redis 行情缓存

```sh
docker compose --profile cache up -d redis
```

在 `.env` 设置 `REDIS_URL=redis://127.0.0.1:56379`，重启 API。`GET /api/market?accountId=...` 缓存行情，键包含不可变价格 ID，TTL 300 秒。缓存不可用则读取 PostgreSQL；现金、数量、账本和日结从不以 Redis 为依据。Operations 可调用带 CSRF 的 `POST /api/market/cache?accountId=...` 清除本应用行情缓存，不会清空整个 Redis。

## 已实现的保证

- 金额整数 cents、整数股；订单和成交分离；市场/限价订单；分批成交。
- 账户行锁串行化金融写入，防止并发超额成交/结算。
- 一笔 PostgreSQL 事务内更新订单/成交/结算、追加账本和审计、生成快照及 outbox。
- 幂等键按账户保存；同键同用户同内容返回原结果，换内容或用户返回 409。
- 成交入账唯一约束；延迟约束要求已结算成交具有完整、金额/证券/数量匹配的两条入账。
- 数据库触发器保护追加式账本、审计、快照和报告；持仓由账本重放。
- HttpOnly / SameSite=Strict 会话 cookie；服务端保存 token 的哈希；8 小时过期；注销立即撤销。
- 密码 scrypt；可兼容原版 bcrypt 哈希。注册密码 12–128 字符。
- CSRF token 和 Origin 检查；读/写/SSE/report/market 全部验证账户成员关系。
- 审计记录真实用户邮箱及外键 ID；SSE 按账户推送，PostgreSQL NOTIFY 支持多个 API 进程。

## 报告与 RabbitMQ

不配置 broker 时，`npm run worker` 直接消费 PostgreSQL outbox；结算仍是同步数据库事务，报告独立后台生成。

```sh
docker compose --profile messaging up -d
```

在 `.env` 加入：

```dotenv
RABBITMQ_URL=amqp://investnexus:investnexus_local@127.0.0.1:5672
```

重启 worker。RabbitMQ 模式使用 durable queue、persistent message、publisher confirm。先写数据库 outbox，再发布；消费者按 snapshot 唯一键幂等写报告，提交后 ack。失败采用最多 5 次处理尝试、退避和死信队列。连接中断时 worker 退出，重启后继续；部署时应由进程管理器重启。

默认队列 `investnexus.reports`，死信 `investnexus.reports.dead`。`RABBITMQ_QUEUE` 可以指定隔离的部署队列。失败任务排查修复后：

```sh
npm run worker:retry
```

该命令把耗尽重试的未完成任务重新排队。报告挂起时导出返回 409，客户端显示后台处理状态；已入账的资产数据仍可查询。

## 接入原版 React

```sh
cd ../client
npm ci
npm start
```

访问 http://localhost:3000/platform。共享组件位于 `client/src/platform/`，开发代理连接 v2 4200 API（`.env.example` 配置了 `TRUSTED_ORIGINS=http://localhost:3000`）；原版页面仍连接旧 8000 API，互不自动迁移。生产整合需要同源反向代理 `/api` 到 v2 服务。

## 迁移原版用户

提供显式导入，保留原有 bcrypt 密码，不读取或生成明文密码。原 MySQL 服务可用且配置了 `api/.env` 后：

```sh
cd ../api
npm ci
node scripts/export-users.js /private/tmp/investnexus-legacy-users.json
cd ../v2
npm run legacy:import -- /private/tmp/investnexus-legacy-users.json
```

导出文件包含身份和凭据哈希，必须私密保存；脚本以 0600 创建并拒绝覆盖已有文件。完成后由你妥善移除。导入是一笔事务、按旧用户 ID 幂等；遇到 v2 已存在同邮箱会整体拒绝，避免误绑定身份。导入用户获得新的独立模拟账户及 Investment/Client 权限。旧 purchasedStock 没有完整订单/结算来源，因此不伪造历史账本，也不自动迁移旧持仓。旧 JSON 原型的本地文件同样保留，不自动导入。

## 测试

```sh
npm run build
npm test
npm run test:integration
```

集成测试使用独立随机命名数据库，结束后清理，不使用演示账户的数据。测试数据库用户需要 CREATEDB；生产应用不应授予这个权限。配置 `RABBITMQ_URL` 会额外执行真实 broker 的发布/消费/重复投递测试；无 broker 时该项明确跳过。

本机验证了 TypeScript / 共享 React 构建、原版 React 构建、领域测试、真实 PostgreSQL 集成测试。GitHub Actions 配置 PostgreSQL + RabbitMQ，覆盖 broker 集成；本机没有 Docker/RabbitMQ，未在本机验证该模式。

## 实现边界

固定模拟行情和券商；T+1 工作日不处理交易所节假日；每成交 $5。收益基于初始资本和结算快照；无日行情收益、基准对比、TWR/IRR。realized P&L 为买卖价差，手续费单独展示。

本轮未加入 Redis 或真实行情。数据库模型使用独立关系表、外键和约束，部分领域详情保存在 JSONB payload。账本不是双分录会计，数据库 owner 可以修改触发器；没有声称防篡改审计。

服务仍只监听 localhost。正式部署需要 HTTPS（`COOKIE_SECURE=true`）、私密数据库/队列凭据、最小权限数据库角色、备份恢复、共享限流及监控。当前登录限流保存在单 API 进程内，不能替代分布式限流。
