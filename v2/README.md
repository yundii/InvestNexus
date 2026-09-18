# InvestNexus v2 — local workflow MVP

原版保留在 `api/` 和 `client/`。v2 是独立、零依赖、可持久化的本地业务原型，验证 mini investment-management platform 的交易闭环，不是生产金融系统。

## 启动

需要 Node.js 22 或以上：

```sh
cd v2
npm start
# http://localhost:4100
```

```sh
npm test
```

## 五分钟演示

1. Investment：创建 BUY 100 MSFT market order，Approve。
2. 将 fill quantity 改为 60，Execute fill；再成交剩余 40。观察 PARTIALLY_FILLED → FILLED。
3. Operations：Advance business date，逐笔 Settle。结算前持仓不变；结算后写入现金/证券及费用账本，生成报告快照。
4. Reconciliation：MSFT 的 broker shares 输入 98。显示 internal 100 / broker 98，输入调查说明并 Resolve。处理记录不修改真实持仓。
5. Client portal：查看持仓、配置、快照价值曲线、交易历史，Export report 下载 JSON。
6. 创建 BUY 1000 MSFT，审批并成交，推进日期并结算，展示 Insufficient cash。失败不会写账本，可重试。

## 已实现

- 分离 Order、Trade、Settlement；审批、限价条件、分批成交、重复结算保护。
- 单一 USD 账户；金额以整数 cents 保存；整数股；每次成交 $5 费用。
- T+1 工作日模拟时钟（跳过周末，不含交易所假期）。
- 追加式现金/证券交易账本；持仓和加权成本由账本重放，卖出计算 realized P&L；费用单列。
- 对账差异、处理说明、操作者和事件时间线。
- 结算快照、初始资本收益、持仓配置、JSON 客户报告。
- 服务端本地 JSON 持久化，写入临时文件后原子替换；提交前复制状态，失败不会提交部分变更。
- SSE 推送刷新其他打开的浏览器；响应式三个 persona workspace。

## 设计与边界

`domain/platform.js` 实现业务命令及账本投影；`server.js` 是 HTTP/持久化适配器；`public/` 是浏览器界面。事件是同一事务内保存的审计事件，SSE 仅通知客户端刷新，**没有**声称使用 RabbitMQ、Redis 或独立后台 worker。服务仅监听 localhost。

固定行情是演示数据，不代表当前市场；券商成交是手动模拟。Persona 是工作流选择，API 的 actor 可由请求指定，**不是身份认证或安全权限**。不要暴露到公网或使用真实客户信息。本地文件只支持单进程，账本是应用层追加式记录，不是双分录会计，也没有数据库级不可篡改保证。曲线是每次结算的快照，不是日行情收益；没有基准对比、现金流调整、TWR/IRR。未迁移原版用户或 MySQL 数据。

## 下一迭代

1. 保持业务测试，迁移到 TypeScript 和 PostgreSQL 事务，加入外键、唯一成交入账约束与数据库迁移。
2. 接入原版登录，服务端可信 session、RBAC、账户隔离及幂等请求键。
3. 同事务写 transactional outbox，RabbitMQ worker 消费结算/报告任务，采用幂等消费者和失败重试。
4. MarketDataProvider 隔离真实行情，PostgreSQL 存历史、Redis 缓存；缓存不作为金融真相。
5. React/Next.js 接入已有 API 合约、正式日收益和基准比较、Docker Compose 集成验证。

为先验证完整流程，这个 MVP 没有提前引入部署和基础设施复杂性。
