# Command Registry

## Envelope

```json
{
  "command_id": "uuid",
  "idempotency_key": "stable-client-key",
  "command_name": "accept_lead",
  "organization_id": "uuid",
  "actor_user_id": "ignored-and-replaced-by-edge",
  "target_type": "lead",
  "target_id": "uuid",
  "expected_version": 3,
  "source": "ignored-and-derived-by-edge",
  "occurred_at": "2026-08-05T12:00:00Z",
  "payload": {}
}
```

CRM 的 actor/source 从已验证 JWT 覆盖；n8n 从内部 Secret 和 `SYSTEM_ACTOR_USER_ID` 覆盖；飞书从验签事件和 verified identity mapping 得到。客户端字段不能提升权限。

`request_organization_deletion` 与 `cancel_organization_deletion` 只能来自 CRM JWT。Edge 在 Supabase Auth 验证同一 JWT 后覆盖 `payload.verified_aal`；数据库只接受 active Owner、`aal2` 和精确 organization name，n8n/飞书不能伪造 step-up。

## v1 命令

| 领域 | 命令 |
| --- | --- |
| Lead | `accept_lead`, `acknowledge_lead`, `assign_lead`, `reassign_lead`, `mark_contacted`, `record_outcome`, `mark_lead_invalid` |
| Task | `schedule_follow_up`, `snooze_follow_up` |
| Draft / Message | `create_message_draft`, `update_message_draft`, `regenerate_message_draft`, `approve_message_draft`, `reject_message_draft`, `mark_manual_message_sent` |
| Opportunity | `convert_lead`, `change_opportunity_stage`, `mark_opportunity_won` |
| Settings | `update_assignment_settings`, `create_scoring_profile_version`, `transfer_organization_owner` |
| Member administration | `provision_organization_member`, `update_organization_member`, `deactivate_organization_member`, `reactivate_organization_member` |
| Feishu identity | `verify_member_channel_identity`, `remove_member_channel_identity` |
| Operations | `retry_outbox_event` |
| Internal automation | `record_lead_score` |
| Deletion | `request_organization_deletion`, `cancel_organization_deletion` |

`record_lead_score` 的输入是 `extracted_evidence`、confidence、模型/token/latency 元数据，不接受 AI 计算结果。Postgres 使用活动 organization scoring profile 和固定 `standard_v1` 规则生成 `dimension_scores`、known weight、coverage 与 normalized score；AI 夹带的 `dimension_scores`/`score_reasons` 会被丢弃。

飞书快捷卡只允许接受、确认、简单结果、安排/延后、审批、人工发送确认、成交和无效；报价、重分配、复杂阶段和配置跳 CRM 深链。

## 成功与失败

成功包含 `ok=true`、request/command/execution ID、result、`latest_version`、Activity/Audit ID 和 Outbox IDs。数据库异常由 Edge 映射为稳定码，返回脱敏 message 与 retryable；内部 SQL、Secret 和 Provider body 不回传。

稳定码：`UNAUTHENTICATED`、`FORBIDDEN`、`VALIDATION_ERROR`、`NOT_FOUND`、`ORGANIZATION_INACTIVE`、`VERSION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`PROVIDER_DISABLED`、`PROVIDER_NOT_IMPLEMENTED`、`CONNECTION_INVALID`、`SIGNATURE_INVALID`、`RATE_LIMITED`、`TRANSIENT_PROVIDER_ERROR`、`MANUAL_ACTION_REQUIRED`、`REPLACEMENT_REQUIRED`。

`provision_organization_member` 只由 `member-admin` Edge Function 在 Auth 邀请/复用用户成功后调用；`verify_member_channel_identity` 只由 `channel-validate` 在飞书 Contact API 验证成功后调用。两者不在浏览器可直接路由的命令白名单中。

相同 `(organization_id,idempotency_key)` + 相同 envelope 返回已存结果；同 key 不同内容返回冲突。`expected_version` 在持有行锁时检查。函数异常会让 CommandExecution、业务更新、Activity、Audit 与 Outbox 全部回滚。
