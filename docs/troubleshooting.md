# 故障处理

| 现象 | 检查 | 处理 |
| --- | --- | --- |
| Lead `202` 但没评分 | `inbound_events`、Outbox、CN-01/CN-02 execution | 不重发不同 event ID；恢复 n8n 后让 Outbox 重试 |
| Outbox 长期 processing | `locked_at`、worker、attempts | 15 分钟 stale recovery；反复失败查 CN-10，达到上限处理 dead letter |
| Sales 看不到记录 | owner member、member status、组织状态、RLS 测试 | 用 Manager 检查分配；禁止临时关 RLS |
| `VERSION_CONFLICT` | 页面 version 与数据库 version | 刷新记录，重新确认动作；不要去掉 expected version |
| 飞书 `SIGNATURE_INVALID` | 回调 URL、时间差、Encrypt Key、原始 body | 校时；重新 validate/轮换；不要记录原 body Secret |
| 飞书卡片无权限 | verified open ID mapping、member active/role | 重新绑定并验证；未验证 mapping 不能写命令 |
| Manual 无法标记发送 | draft status、审批策略、实际渠道/结果/下次时间 | 补齐真实信息；不能直接 UPDATE messages |
| AI 模型拒绝 | base URL、Key、模型 ID、账户权限/额度 | 运行 `npm run validate:ai`；保持 workflow inactive，禁止静默 fallback |
| n8n Credential 无法解密 | `N8N_ENCRYPTION_KEY` 是否与备份一致 | 从密码库恢复原 key；不要重新生成覆盖 |
| pending deletion 后写入失败 | 组织状态 | 这是预期；只有 Owner/Admin 可只读、导出和取消 |

日志只记录 request ID、稳定错误码、retryable、workflow/execution ID；禁止记录 Authorization、Cookie、Secret、完整客户消息或原始 webhook body。
