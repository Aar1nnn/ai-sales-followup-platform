# ADR-0001：Supabase 读取与事务命令架构

状态：已接受
日期：2026-08-05

## 决策

浏览器通过 Supabase Publishable Key 和 RLS 读取业务数据。核心写操作统一发送到 `execute-command` Edge Function；Edge Function 验证调用来源并以服务端身份调用 `crm` schema 中一个事务 RPC。n8n 只消费 Outbox 并调用 Edge，不直接修改核心业务表。

## 原因

- RLS 保留最小权限读取和双租户隔离。
- 单 RPC 能把业务状态、Activity、Audit、CommandExecution 和 Outbox 保持为同一事务。
- CRM、飞书和 n8n 使用同一命令语义，避免三套状态机。
- `idempotency_key` 与 `expected_version` 提供重试安全和并发冲突反馈。

## 安全约束

- 浏览器不持有 `service_role` 或连接级 Secret。
- `crm` schema 不暴露到浏览器 API。
- `SECURITY DEFINER` 函数固定空 `search_path`、使用全限定名并撤销 public execute。
- Edge 层的校验不能替代 RPC 对 actor、organization、role、state 和 version 的复核。
