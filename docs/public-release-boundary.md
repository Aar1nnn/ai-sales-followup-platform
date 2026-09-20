# 公开仓库边界

本仓库提供可复用的 AI 销售跟进产品架构，不是任何客户部署环境的备份或导出。

## 包含内容

- React CRM 前端与浏览器权限边界。
- Supabase migrations、RLS、事务 RPC、Edge Functions 与测试。
- 10 个默认 `active=false` 的中国版 n8n workflow 模板。
- Docker Compose、Nginx、环境变量示例和部署文档。
- 仅使用 `example.com`、`example.test`、确定性 UUID 和明显虚构名称的开发测试数据。

## 永不包含

- 客户联系人、电话号码、邮箱、消息内容或数据库导出。
- Supabase 项目引用、service role、AI Key、飞书 Secret、Webhook Secret 或 n8n Credential ID。
- `.env.local`、n8n 数据卷、PostgreSQL 数据目录、日志、截图、录屏材料或测试报告。
- 客户现场的 workflow 导出、Outbox ID、用户 ID、组织 ID、部署验收记录或密码重置工具。
- 已淘汰的 WhatsApp、OpenRouter、Gmail 历史 workflow。

## 自动门禁

`npm run test:secrets` 扫描常见 Secret 与 Git 历史；`npm run test:privacy` 检查个人标识、真实邮箱域名、Supabase 项目引用、n8n Credential ID 和禁止进入仓库的路径。两项检查都属于 `npm run check` 和 CI。

测试数据只能使用保留示例域名和明显虚构身份。真实部署配置必须由客户放入其密码库、Supabase Vault、Edge Secrets 或 n8n Credentials，禁止提交到 Git。
