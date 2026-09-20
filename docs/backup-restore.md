# 备份与恢复

## 必须备份

- Supabase：客户套餐支持的 PITR/每日数据库备份、Storage 对象、Auth 配置、Edge Secrets 清单（不把明文放报告）。
- VPS：`n8n-postgres-data` 的逻辑/物理备份、`n8n-data`、Compose 配置和加密保存的 `N8N_ENCRYPTION_KEY`。
- 配置：workflow export、Variable 清单、Credential 名称/所有者、飞书/来源连接 ID、域名/TLS 配置。

## 恢复演练

每季度在隔离环境：

1. 恢复 n8n Postgres 与 n8n volume。
2. 注入原 `N8N_ENCRYPTION_KEY`，确认 Credential 可解密但不在日志显示。
3. 将 Supabase 备份恢复到隔离 Project，重新部署同版本 Edge。
4. 替换测试域名/回调，禁止向真实客户发送。
5. 验证登录、RLS、Outbox、Manual 流程和一条测试飞书消息。
6. 记录 RPO/RTO、耗时、失败点和修复负责人。

仅“有备份文件”不算通过；必须有最近一次可复现的恢复演练记录。
