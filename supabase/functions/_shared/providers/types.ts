export interface ProviderConnection {
  id: string;
  organization_id: string;
  provider:
    | "manual"
    | "feishu_internal"
    | "wecom_internal"
    | "wecom_customer_contact"
    | "wechat_customer_service"
    | "email"
    | "whatsapp_business";
  status: "draft" | "validating" | "active" | "invalid" | "disabled";
  secret_ref: string | null;
  public_config: Record<string, unknown>;
}

export interface ProviderContext {
  connection: ProviderConnection;
  secret: string | null;
}

export interface ProviderCapabilities {
  internal_notification: boolean;
  approved_customer_message: boolean;
  inbound_webhook: boolean;
  delivery_events: boolean;
  automatic_customer_send: false;
}

export interface ProviderResult {
  ok: boolean;
  provider: ProviderConnection["provider"];
  external_id?: string;
  status: string;
  details?: Record<string, unknown>;
}

export interface ChannelProvider {
  validateConnection(context: ProviderContext): Promise<ProviderResult>;
  sendInternalNotification(
    context: ProviderContext,
    payload: Record<string, unknown>,
  ): Promise<ProviderResult>;
  sendApprovedCustomerMessage(
    context: ProviderContext,
    payload: Record<string, unknown>,
  ): Promise<ProviderResult>;
  receiveWebhook(
    context: ProviderContext,
    request: Request,
    rawBody: Uint8Array,
  ): Promise<Record<string, unknown>>;
  verifyWebhookSignature(
    context: ProviderContext,
    request: Request,
    rawBody: Uint8Array,
  ): Promise<void>;
  normalizeInboundMessage(
    payload: Record<string, unknown>,
  ): Record<string, unknown>;
  normalizeDeliveryEvent(
    payload: Record<string, unknown>,
  ): Record<string, unknown>;
  getCapabilities(): ProviderCapabilities;
}
