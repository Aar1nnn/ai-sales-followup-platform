# 遗留字段兼容矩阵

本矩阵约束新 baseline 对现有 React、历史字段依赖和遗留 n8n 导出的兼容处理。兼容层只用于迁移和只读展示；新代码使用标准字段。

| 遗留对象/字段 | 标准对象/字段 | 分类 | 兼容策略 |
| --- | --- | --- | --- |
| `salespeople` | `organization_members` + `profiles` | `rename_with_compatibility` | 提供只读 `public.salespeople_compat` 视图 |
| `follow_ups` | `activities` | `rename_with_compatibility` | 提供 `security_invoker` 只读 `public.follow_ups` 视图；未来待办统一读 `follow_up_tasks` |
| `assigned_to` / `assigned_salesperson` / `salesperson` / `owner` | `owner_member_id` / `assignee_member_id` | `rename_with_compatibility` | 新 API 只返回 member UUID 和展示名；兼容视图输出旧 alias |
| `next_follow_up` / `next_follow_up_at` / `next_followup` | 当前开放 `follow_up_tasks.due_at` | `rename_with_compatibility` | 兼容 Lead 查询视图派生，不在 `leads` 保存第二真源 |
| `pipeline_stage` / `status` / `stage` / `pipeline_stage_id` | `leads.status` 与 `opportunities.pipeline_stage_id` | `rename_with_compatibility` | 明确分离 Lead 状态和 Opportunity Stage，不自动将旧 won 值写回 Lead |
| `name` / `customer_name` / `full_name` / `customer` | `contacts.full_name` | `rename_with_compatibility` | Lead 列表兼容视图联结 Contact |
| `phone` / `phone_number` / `mobile` | `contacts.phone` | `rename_with_compatibility` | 仅 verified identity 可自动合并 |
| `email` | `contacts.email` | `keep` | 从 Contact 展示 |
| `company` | `accounts.name` | `rename_with_compatibility` | Contact 的 Account 可空 |
| `request_id` / `requestId` | `leads.public_id` | `rename_with_compatibility` | Intake 幂等另用 `inbound_events.source_event_id` |
| `priority` | `lead_scores.priority_level` | `rename_with_compatibility` | 取最新分数；缺失时为 null |
| `notes` / `note` | `leads.notes` 或 `activities.notes` | `keep` | 根据事实/当前需求归属保存 |
| `whatsapp_phone` | channel identity | `deprecated` | 只在归档 adapter 中读取，核心 CRM 表不保存 |
| `reminder_logs` | `automation_runs` + `delivery_events` | `deprecated` | 不创建第二套日志表 |
| `daily_report_logs` / `workflow_logs` | `automation_runs` | `rename_with_compatibility` | workflow 状态统一记录 |
| 旧 WhatsApp 自动发送 | 无 | `deprecated` | 归档、默认关闭，不进入中国版验收 |
| Tally 硬编码 option UUID | `lead_source_connections.mapping` | `remove` | 映射按 organization + form 配置 |
| OpenRouter 固定模型 | OpenAI-compatible credential/config | `remove` | 默认阿里云百炼候选模型，启用前验证 |
| 未识别的旧字段 | `inbound_events.normalized_payload.metadata` | `unknown` | 原始 payload 按保留期保存，不污染核心表 |
