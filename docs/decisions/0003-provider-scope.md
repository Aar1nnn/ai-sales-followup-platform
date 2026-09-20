# ADR-0003：v1 Provider 范围

状态：已接受
日期：2026-08-05

`feishu_internal` 和 `manual` 是 v1 唯一正式能力。`manual` 只记录用户真实完成的发送，不伪造外部渠道成功。`wecom_internal`、`wecom_customer_contact`、`wechat_customer_service`、`email` 和 `whatsapp_business` 均 fail closed。遗留 WhatsApp workflow 保留原始 JSON 归档和解析测试，但不进入部署、UI 或验收。
