# 角色权限与 RLS

| 能力 | Owner | Admin | Manager | Sales |
| --- | --- | --- | --- | --- |
| 查看组织全部销售业务 | 是 | 是 | 是 | 仅自己负责 |
| 分配 / 重分配 | 是 | 是 | 是 | 否 |
| 查看连接元数据 | 是 | 是 | 否 | 否 |
| 创建/轮换 Secret | 是 | 是 | 否 | 否 |
| 配置分配和评分上下文 | 是 | 是 | 否 | 否 |
| 邀请/调整成员 | 是 | 是（不能管理 Owner/Admin 或授予 Admin） | 否 | 否 |
| 停用成员并迁移未结工作 | 是 | 是（不能管理 Owner/Admin） | 否 | 否 |
| 验证其他成员飞书映射 | 是 | 是（不能管理 Owner/Admin） | 否 | 否 |
| 查看自动化错误/重试 dead-letter | 是 | 是 | 否 | 否 |
| 审批全组织草稿 | 是 | 是 | 是 | 仅自己的草稿且组织允许自审 |
| 转换商机 / 标记成交 | 是 | 是 | 是 | 自己负责记录 |
| 转移 Owner | 是 | 否 | 否 | 否 |
| 请求删除组织 | 是 + AAL2 | 否 | 否 | 否 |
| 取消删除 | 是 + AAL2 | 否 | 否 | 否 |

RLS helper：`is_active_org_member`、`organization_role`、`can_administer_organization`、`can_manage_sales`、`can_access_assigned_record`、`is_active_organization`，以及 Contact/Lead/Opportunity/Account 关系 helper。

所有 30 张 public table 均启用 RLS，并分别存在 SELECT/INSERT/UPDATE/DELETE policy。核心表没有给 authenticated 写权限；即使绕过前端，也会先被 table privilege 拒绝，再由 RLS 作为第二道边界。service role 仅存在 Edge/n8n 服务端。

开发测试身份固定为 Owner A、Admin A、Manager A、Sales A1、Sales A2、Sales B1。`supabase/tests/002_rls_isolation.sql` 验证跨组织与跨销售隔离。
