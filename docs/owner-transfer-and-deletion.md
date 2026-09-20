# Owner 转移与组织删除协议

## Owner 转移

当前 active Owner 执行 `transfer_organization_owner`，目标必须是同组织 active member。事务先把旧 Owner 降为 Admin，再把目标升为 Owner；部分唯一索引保证不会出现两个 active Owner。完成后重新验证两人的管理权限与 MFA。

## 删除申请

只有 active Owner，且 JWT 已完成 AAL2/MFA step-up、重新输入精确 organization name，才能执行 `request_organization_deletion`。

申请后：

- organization → `pending_deletion`，默认清除时间 +30 天。
- Command、Intake、Outbox claim 停写/停派发。
- Owner/Admin 仅可只读和导出；Manager/Sales 不再进入业务。
- 只有 Owner 再次完成 AAL2/MFA step-up 并输入精确 organization name 才能取消；取消后回到 active，scheduled purge job 标记 cancelled。

## 分阶段 Purge

CN-09 每小时调用受控 Edge worker；每次最多一批，可重试/断点：Storage → Inbound → Messages → CRM 辅助记录 → Tasks/Activities → Channels 与核心 CRM → Automation → Members → Settings。

外键要求核心父记录在 Tasks/Channel 子记录清除后最终删除；这不改变对外显示的阶段顺序，purge report 会记录全部阶段。完成后只保留 organization/name/audit/report hash 与时间的 tombstone，不含业务内容。Auth user ID 由 purge report 返回给 Edge/客户管理员，用 Supabase Admin API 另行删除；禁止在 SQL 中误删仍属于其他组织的用户。

默认保留：原始 inbound/delivery payload 90 天后脱敏；command/audit 365 天后分批删除。
