# 部署、回滚与健康检查

## 前置原则

本仓库不会自动连接远程 Supabase。取得客户明确授权和全新项目凭证后才执行远程 migration/Edge deploy。生产 migration 禁止夹带 seed。

## VPS 部署

1. 复制 `deploy/.env.example` 为 VPS 上权限 `0600` 的 `.env`，填客户值并固定已验收的 `N8N_IMAGE`。
2. `docker compose --env-file .env -f deploy/docker-compose.yml config --quiet`。
3. `docker compose --env-file .env -f deploy/docker-compose.yml build frontend-nginx`。
4. `docker compose --env-file .env -f deploy/docker-compose.yml up -d`。
5. 检查 `frontend-nginx`、`n8n`、`n8n-postgres` health；反代只公开 TLS 域名，不公开 Postgres。
6. 验证 `/healthz`、`/login`、`/leads/<id>` 刷新；`/assets/not-found.js` 和 `/functions/...` 必须 404，不能回退 index。

## Supabase

- `crm` 加入 exposed schema 是为了 service role RPC；`anon`/`authenticated` 已撤销 schema/function 权限。
- Edge deploy 后逐一 smoke test `execute-command`、Intake、channel validate/send、Feishu callback、purge worker。
- `ALLOWED_ORIGINS` 只填 CRM HTTPS origin；不要用 `*`。
- `MEMBER_INVITE_REDIRECT_URL` 填 CRM 的 HTTPS 登录地址，并加入 Supabase Auth Redirect URLs；未配置时回退到 `CRM_APP_URL/login`。

## 回滚

- 前端：保留上一个镜像 digest，切回并重新健康检查。
- n8n：导出当前 workflow/credentials 元数据，回退到上一个已测试镜像；必须使用同一 `N8N_ENCRYPTION_KEY`。
- Database：migration 只前进；禁止自动 destructive down migration。若新 migration 未改数据，使用事先审核的补偿 migration；若已改数据，从 PITR/备份恢复到隔离项目并演练切换。
- Edge：保留上一个 bundle/tag；回滚函数不回滚已提交业务命令。

## 未满足即停止上线

- 缺少客户 Supabase/service role、N8N encryption key 备份、TLS、Owner MFA、AI 模型连接验证或飞书验签测试。
- Secret 出现在前端 bundle、Git、日志或 n8n JSON。
- 双组织 RLS、幂等、Manual 真实发送或备份恢复未通过。
