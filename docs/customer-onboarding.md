# 客户开户手册

## 交付前客户准备

- Supabase Project：确认数据区域、Owner、计费、MFA、备份能力。
- 客户自有 SMTP：用于成员邀请、注册验证和密码找回；Supabase 内置邮件服务只用于低频演示验收。
- VPS：Docker Engine/Compose、最小开放端口、SSH 管理人、补丁策略。
- 两个域名：CRM 与 n8n；TLS 由客户现有反代或受控 Nginx 终止。
- 飞书自建应用：App ID/Secret、Verification Token、Encrypt Key、消息与事件权限。
- 阿里云百炼账户：API Key、可用模型清单、数据处理和预算确认。
- 首位 Owner 的邮箱与临时密码传递渠道。

## 实施顺序

1. 在客户 Supabase 顺序执行 `001`–`012` migration，不运行 `supabase/seed.sql`。
2. 创建 Edge Secrets：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`N8N_INTERNAL_SECRET`、`SYSTEM_ACTOR_USER_ID`、`ALLOWED_ORIGINS`、`PURGE_STORAGE_BUCKETS`、`MEMBER_INVITE_REDIRECT_URL`。
3. 创建 Owner Auth 用户后运行 `npm run bootstrap`；记录 organization ID 和 Owner member ID。
4. 配置 Supabase Auth 的正式 Site URL、允许的回调地址、邮箱确认和客户 SMTP；完成注册、邀请、密码找回三类邮件验收。
5. 用 Owner 登录，配置企业 ICP、分配策略和飞书连接；飞书 Secret 提交后只进 Vault。
6. 由 Owner/Admin 在成员页发起邀请；系统通过 Auth Admin API 发送邀请或复用已有 Auth 用户。逐一输入飞书 open ID，只有客户飞书应用实时查询到 active 用户后才会保存为 `verified`。
7. 配置 Tally/Generic Source：创建 connection、Vault Secret、mapping、速率与 payload 大小限制；发送唯一测试事件。
8. 部署 VPS Compose，持久化并离线备份 `N8N_ENCRYPTION_KEY`。
9. 导入 n8n，绑定三个 Credential 与 Variables；先测试 `qwen3.7-plus` 实际可用性。
10. 依 README 顺序启用 workflow；最后启用 Dispatcher/定时任务。
11. 执行验收清单并由客户签字；没有通过的 Provider 保持 inactive。

## 开户验收最小样本

- Tally/Generic 有效签名 `202 accepted`；同事件 `202 duplicate`；无效签名拒绝。
- 新 Lead 即使 AI/n8n 暂停也存在数据库。
- Sales A 看不到 Sales B 和其他组织记录。
- 飞书卡片重复点击只执行一次；旧 version 显示冲突。
- Manual 草稿复制后不会自动变 sent；只有完整表单确认才记录消息。
- VPS 重启后 n8n Credential 可解密、Postgres 与 workflow 状态仍在。
