# InvestNexus v2 — PostgreSQL / TypeScript milestone

本轮把本地 JSON 原型升级为 PostgreSQL 事务后端，并加入可信登录、账户权限、共享 React 工作区和异步报告。

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

## 五分钟流程

1. PM 创建 BUY 100 MSFT，Approve，然后分 60 / 40 股执行。
2. 切换 Operations 用户，Advance business date，逐笔 Settle。
3. 核对 100 股持仓、$58,990 现金、$99,990 总价值（两笔成交各 $5 费用）。
4. 对账输入 broker shares 98，生成 2 股差异，输入说明后 Resolve。处理说明不会直接改持仓。
5. Client 查看持仓、配置、快照曲线；worker 完成报告后 Export report。
6. PM 创建 BUY 1000 MSFT 并成交，Ops 推进日期后结算，展示 FAILED / Insufficient cash，无账本写入。
7. 独立用户登录后看到自己的账户；直接请求别的 accountId 得到 403。

## 已实现的保证

- 金额整数 cents、整数股；订单和成交分离；市场/限价订单；分批成交。
- 账户行锁串行化金融写入，防止并发超额成交/结算。
- 一笔 PostgreSQL 事务内更新订单/成交/结算、追加账本和审计、生成快照及 outbox。
- 幂等键按账户保存；同键同用户同内容返回原结果，换内容或用户返回 409。
- 成交入账唯一约束；延迟约束要求已结算成交具有完整、金额/证券/数量匹配的两条入账。
- 数据库触发器保护追加式账本、审计、快照和报告；持仓由账本重放。
- HttpOnly / SameSite=Strict 会话 cookie；服务端保存 token 的哈希；8 小时过期；注销立即撤销。
- 密码 scrypt；可兼容原版 bcrypt 哈希。注册密码 12–128 字符。
- CSRF token 和 Origin 检查；读/写/SSE/report 全部验证账户成员关系。
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
