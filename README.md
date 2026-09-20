# AI 销售跟进平台 · 中国标准产品模板 v1

面向中国企业独立部署的 AI 销售跟进模板。每个客户拥有自己的 Supabase、n8n、前端和飞书自建应用；生产部署只有一个 primary organization，但数据库、RLS 与测试始终保留完整 `organization_id` 隔离。

本仓库是可复用的产品架构模板，只包含源代码、数据库结构、自动化模板、测试与部署文档。它不包含任何客户数据库导出、真实联系人、个人账号、API Key、Credential ID、运行日志、截图或部署现场记录。发布边界详见 [公开仓库边界](docs/public-release-boundary.md)。

## 已实现闭环

- Contact → Lead → 人工确认 → Opportunity 的三层 CRM 生命周期。
- Supabase Publishable Key + RLS 读取；核心写统一走 `execute-command` Edge + `crm.execute_command()` 事务 RPC。
- 固定 `standard_v1` 六维评分：AI 只提取证据，Postgres 确定性计算已知分、覆盖率和归一化分。
- `round_robin`、`least_open_tasks`、`manager_manual` 三种事务分配策略。
- Manual 客户消息：编辑、复制、审批、实际渠道、标记已发送、结果、备注和下一次跟进。
- 飞书自建应用连接验证、成员映射、内部卡片、签名回调和 CRM 深链。
- Owner/Admin 成员邀请、角色与接单状态管理、停用时未结工作量事务迁移，以及经飞书 API 实时验证的成员 open ID 映射。
- Owner/Admin 运维页：查看 Outbox/Automation Run、dead-letter 错误并通过审计命令安全重试。
- 可靠 Outbox、10 个默认 inactive 的中国版 n8n workflow、30 天组织删除协议。
- Docker/Nginx 客户 VPS 基线、双新库 CI、pgTAP、Vitest、Playwright、n8n/Secret 扫描。

不属于 v1：企微官方发送、微信客服、Email 自动发送、新 WhatsApp 功能、多组织切换器、自定义角色/评分权重、AI 自动转商机。

## 前端操作方式

- `登录 / 注册`：登录页可切换现有账号登录和新账号注册；注册只创建登录身份，必须由 Owner/Admin 使用同一邮箱加入企业后才能访问 CRM，已收到邀请邮件的成员直接接受邀请并设置密码。
- `今日工作`：根据逾期、未分配、新线索和草稿状态给出当前最重要的下一项行动。
- `待处理`：统一收拢新线索、今日/逾期任务以及待审核、待发送的人工消息草稿。
- `新建线索`：Dashboard 和全部线索页均提供入口；登录成员可录入电话、微信、展会或转介绍客户，也可一键填入演示客户后自行提交。
- `客户`：检索稳定客户档案；具体需求和跟进过程进入对应线索工作台。
- `销售管道`：查看人工确认的商机，在详情页推进阶段或标记成交。
- `上线中心`：Owner/Admin 按组织、来源、Manual、n8n、AI 和飞书的真实记录检查部署就绪度。
- 线索工作台按当前状态突出一个主要动作；Manual 消息严格执行“审核内容 → 批准草稿 → 外部联系 → 记录结果 → 完成”五步流程。

浏览器不会直接写 CRM 表、持有连接 Secret、自动发送客户消息或伪造任务完成。手工录入会携带 Supabase JWT 调用受保护的 `internal_manual` Intake；Tally 和 Generic Webhook 等外部来源仍需由 Owner/Admin 在 `上线中心` 配置。

## 本地开发

```powershell
npm.cmd ci
npx.cmd supabase start
npm.cmd run dev
```

从 `npx supabase status` 取得本地 URL 与 Publishable Key，写入不提交的 `.env`：

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=local-publishable-key
```

如需启动与 Playwright 相同的本地验收环境，可在 Supabase 已启动后运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local-demo.ps1
```

验收地址为 `http://127.0.0.1:4173`，development seed 的 Owner 账号为 `owner.a@example.test`。

验证：

```powershell
npm.cmd run check
npm.cmd run test:e2e
npx.cmd supabase test db
```

## 目录

- `supabase/migrations/`：`001`–`017` 顺序 migration，覆盖 baseline、成员运维、手工 Intake、受控自动化和浏览器写权限收口。
- `supabase/functions/`：Command、Intake、Provider、飞书与 Purge Edge Functions。
- `supabase/tests/`：Schema、评分、RLS 和事务 pgTAP。
- `n8n-workflows/`：10 个默认关闭的中国版 workflow 模板。
- `deploy/`：客户 VPS Docker Compose 与 Nginx。
- `docs/`：架构、权限、接口、客户开户、部署与验收文档。

## 安全边界

- 浏览器只能持有 Publishable Key，不得持有 service role、AI、飞书或 webhook Secret。
- 连接级 Secret 存 Supabase Vault；部署级 Secret 存 Edge Secrets；AI/n8n Secret 存 n8n Credentials。
- `crm` 虽通过 PostgREST 提供给 service role，但已撤销 `anon`/`authenticated` schema 和 function 权限。
- 所有中国版 workflow 默认 inactive；没有客户凭证时只能生成和本地验证文件，不能声称远程部署成功。

从 [架构说明](docs/architecture.md) 和 [客户开户手册](docs/customer-onboarding.md) 开始交付。

## 使用许可

本仓库公开用于展示与审阅产品架构，但当前未授予开源许可；除非仓库所有者另行书面授权，否则保留全部权利。
