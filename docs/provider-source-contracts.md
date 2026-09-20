# Provider 与 Source Adapter 契约

## Provider

统一接口：

- `validateConnection()`
- `sendInternalNotification()`
- `sendApprovedCustomerMessage()`
- `receiveWebhook()`
- `verifyWebhookSignature()`
- `normalizeInboundMessage()`
- `normalizeDeliveryEvent()`
- `getCapabilities()`

| Provider | v1 状态 | 真实能力 |
| --- | --- | --- |
| `feishu_internal` | enabled | 客户自建应用验证、个人卡片、群日报、验签/解密、卡片更新 |
| `manual` | enabled | 编辑/复制/审批/记录真实渠道与发送事实；自动发送永远 false |
| `whatsapp_business` | disabled archive | 只保留旧 JSON，不进入 UI/部署/验收 |
| `wecom_internal` | not implemented | 明确失败 |
| `wecom_customer_contact` | not implemented | 明确失败 |
| `wechat_customer_service` | not implemented | 明确失败 |
| `email` | not implemented | 明确失败 |

## LeadIntakeV1

固定顶层字段：`schema_version`、`organization_id`、`source`、`source_connection_id`、`source_event_id`、`received_at`、`contact`、`lead`、`tracking`、`consent`、`metadata`。

成功和重复请求都返回 HTTP `202`：

```json
{
  "request_id": "uuid",
  "inbound_event_id": "uuid",
  "lead_id": "uuid",
  "status": "accepted"
}
```

Adapter：

- Tally：原始 body HMAC-SHA256；`mapping` 以标准路径映射 Tally field key/label；`external_source_id` 锁定 form ID。
- Generic Webhook：`x-webhook-signature` HMAC 或 `x-webhook-token`；Payload 大小、每分钟速率、事件幂等均受控。
- Internal Manual：独立 connection token；不能复用 n8n/Edge Secret。
- Builtin Form：只有 `ENABLE_BUILTIN_TEST_FORM=true` 才可用于受控测试，不是公开获客页。

只有 connection 的 `verified_identity_fields` 声明为可靠的 phone/email 才可自动匹配 Contact；否则新 Contact 标为 `identity_pending`。姓名绝不参与自动合并。
