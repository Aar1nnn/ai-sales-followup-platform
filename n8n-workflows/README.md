# 中国标准产品模板 v1 · n8n 自动化

本目录包含 10 个默认 `active=false` 的中国版 workflow。n8n 只读取业务上下文、消费可靠 Outbox、调用 `execute-command`/Provider Edge Function 或受控 `crm` automation RPC；不得直接 INSERT/UPDATE/DELETE 核心 CRM 表。

## 本机部署

本机验收使用固定版本 `n8n 2.30.5`、独立 PostgreSQL 和两个持久化 volume，只监听 `127.0.0.1:5678`：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-local-n8n.ps1 `
  -SupabaseUrl "https://PROJECT_REF.supabase.co" `
  -SystemActorUserId "ACTIVE_OWNER_OR_ADMIN_USER_UUID"

docker compose --env-file deploy/.env.n8n.local `
  -f deploy/docker-compose.n8n-local.yml up -d
```

打开 `http://127.0.0.1:5678` 完成 n8n Owner 初始化。`deploy/.env.n8n.local` 被 Git 忽略；重复运行准备脚本不会覆盖已有加密密钥。正式部署必须改用 `deploy/docker-compose.yml`、公网 HTTPS 和客户域名。

## 导入顺序

1. `CN-10-Global-Error-Handler.json`
2. `CN-02-Lead-AI-Extraction-Scoring.json`
3. `CN-03-Lead-Assignment.json`
4. `CN-04-Customer-Draft-Generation.json`
5. `CN-05-Feishu-Internal-Notification.json`
6. `CN-06-Follow-Up-Reminder.json`
7. `CN-07-Daily-Sales-Report.json`
8. `CN-08-Retention-Cleanup.json`
9. `CN-09-Organization-Purge-Orchestrator.json`
10. `CN-01-Outbox-Dispatcher.json`

导入后保持 inactive，完成 Credential、Variable 和连接测试后再逐个启用。先启用 Error Handler，再启用子 workflow，最后启用 Dispatcher 与定时任务。

## n8n Credentials

- `Supabase Service Role (n8n only)`：HTTP Custom Auth，保存在 n8n Credentials；同时注入 `apikey` 与 `Authorization: Bearer ...`，仅用于受控读取和 `crm` automation RPC。Supabase REST 实测单 Header 会降级为匿名权限或返回 401，禁止改回单 Header Credential。
- `N8N Internal Edge Secret`：HTTP Header Auth，header 为 `x-internal-secret`；值与 Edge 的 `N8N_INTERNAL_SECRET` 一致。
- `OpenAI-compatible AI Provider`：HTTP Header Auth，保存客户自己的阿里云百炼、DeepSeek 或其他 OpenAI-compatible key。

必须持久化强随机 `N8N_ENCRYPTION_KEY`。Credential 明文不得进入 workflow JSON、环境示例、日志或截图。

## n8n Variables / Environment

| 名称 | 所有者 | 用途 |
| --- | --- | --- |
| `SUPABASE_URL` | 部署方 | 客户 Supabase URL |
| `CRM_APP_URL` | 部署方 | CRM 公网 HTTPS 地址，用于飞书卡片深链 |
| `SYSTEM_ACTOR_USER_ID` | 客户管理员 | 组织内 active Owner/Admin 系统执行身份 |
| `AI_BASE_URL` | 客户管理员 | OpenAI-compatible `/v1` base URL |
| `AI_PROVIDER` | 客户管理员 | 默认 `aliyun_bailian` |
| `AI_EXTRACTION_MODEL` | 客户管理员 | 候选 `qwen3.7-plus`，启用前必须实测模型 ID |
| `AI_DRAFT_MODEL` | 客户管理员 | 可与提取模型不同 |
| `WF_AI_SCORE_ID` | 实施方 | CN-02 workflow ID |
| `WF_ASSIGNMENT_ID` | 实施方 | CN-03 workflow ID |
| `WF_DRAFT_ID` | 实施方 | CN-04 workflow ID |
| `WF_FEISHU_NOTIFY_ID` | 实施方 | CN-05 workflow ID |
| `WF_PURGE_ID` | 实施方 | CN-09 workflow ID |
| `FEISHU_CONNECTION_ID` | 客户管理员 | 已验证的飞书 channel connection |
| `FEISHU_REPORT_CHAT_ID` | 客户管理员 | 日报群 chat ID |
| `PRIMARY_ORGANIZATION_ID` | 客户管理员 | 唯一 primary organization |

AI fallback 默认关闭。只有客户主动提供第二套 Credential、确认数据地域与计费后，才允许新增 fallback 分支。

DeepSeek V4 默认开启思考模式。CN-02 与 CN-04 会在 `AI_PROVIDER=deepseek` 时向请求体加入 `thinking: { type: 'disabled' }`，避免结构化提取和短草稿的输出额度被思考内容占用；其他 Provider 不发送该字段。启用前仍须用客户账户验证实际模型 ID 和 JSON 输出。

CN-05 在负责人、已验证飞书成员身份或 active 飞书连接缺失时会以稳定错误码停止，不会把缺失配置当作发送成功。只有客户自建应用连接验证通过、目标 Sales 成员完成 `open_id` 映射，并用测试群/测试成员完成一次人工验收后，才能进入启用步骤。

## 可靠性语义

- Dispatcher 通过 `claim_outbox_events` 的 `FOR UPDATE SKIP LOCKED` 获取事件。
- 成功后调用 `complete_outbox_event`；失败由 n8n Error Workflow 记录，15 分钟后 stale lock 会被自动恢复并指数退避重试。
- 超过 `max_attempts` 进入 `dead_letter`，不得静默丢弃。
- command 使用事件 ID 派生幂等键；重复执行不会重复改变业务状态。
- `task.reminder.due` 使用 task + due_at deduplication key；Snooze 后 due_at 改变才产生新提醒。

## 公开模板边界

本目录只包含当前中国版 workflow。旧 WhatsApp、OpenRouter、Gmail 等历史导出不属于 v1，也不会进入公开模板，因为历史导出可能包含部署级 Credential ID、账户名称或客户现场字段映射。
