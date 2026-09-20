# 环境变量与 Secret 所有权

| 值 | 放置位置 | 谁注册/持有 | 可进浏览器 |
| --- | --- | --- | --- |
| Supabase URL | 前端 build、Edge、n8n env | 客户 | 是 |
| Supabase Publishable Key | 前端 build | 客户 | 是 |
| Supabase service role | Edge Secret、n8n Credential | 客户 Owner | 否 |
| `CRM_APP_URL` | Edge Secret（非敏感配置）、n8n env | 客户/实施方 | 否（仅用于生成飞书 HTTPS 深链） |
| `MEMBER_INVITE_REDIRECT_URL` | Edge Secret（非敏感配置） | 客户/实施方 | 否（Auth 邀请接受后的 CRM HTTPS 地址） |
| 飞书 App Secret / Token / Encrypt Key | Supabase Vault | 客户飞书管理员 | 否 |
| Generic/Tally connection Secret | Supabase Vault | 客户来源系统管理员 | 否 |
| `N8N_INTERNAL_SECRET` | Edge Secret + n8n Credential | 实施方生成，客户保管 | 否 |
| `N8N_ENCRYPTION_KEY` | VPS secret/env + 离线备份 | 客户 IT | 否 |
| n8n PostgreSQL password | VPS secret/env | 客户 IT | 否 |
| 百炼 API Key | n8n Credential | 客户百炼管理员 | 否 |
| AI Base URL / 模型 ID | n8n env/Variables | 客户 | 否（无需浏览器） |

## 客户必须自行注册

1. Supabase Project 与计费账户。
2. 飞书企业内自建应用、权限与事件订阅。
3. 阿里云百炼 API Key；候选 `qwen3.7-plus` 必须运行 `npm run validate:ai` 验证，不能假定账户可用。
4. VPS、域名、TLS 证书、备份存储。

实施方生成 `N8N_INTERNAL_SECRET`、数据库密码和 `N8N_ENCRYPTION_KEY` 后交由客户密码库保管。不得把任何 Secret 发到普通聊天、工单截图或 Git。

Secret 轮换：新凭证先 validate；成功后覆盖 Vault/n8n Credential；执行一条受控测试；确认 Audit/Provider 正常；最后在供应商侧撤销旧凭证。UI 永不回显现有 Secret。
