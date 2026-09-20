import { AppError } from "../errors.ts";
import type { ChannelProvider } from "./types.ts";

export const manualProvider: ChannelProvider = {
  async validateConnection(context) {
    if (context.connection.status === "disabled") {
      throw new AppError("PROVIDER_DISABLED");
    }
    return { ok: true, provider: "manual", status: "valid" };
  },
  async sendInternalNotification() {
    throw new AppError("PROVIDER_NOT_IMPLEMENTED");
  },
  async sendApprovedCustomerMessage() {
    throw new AppError(
      "MANUAL_ACTION_REQUIRED",
      "Copy the approved draft, send it in the selected channel, then mark it as sent.",
    );
  },
  async receiveWebhook() {
    throw new AppError("PROVIDER_NOT_IMPLEMENTED");
  },
  async verifyWebhookSignature() {
    throw new AppError("PROVIDER_NOT_IMPLEMENTED");
  },
  normalizeInboundMessage(payload) {
    return payload;
  },
  normalizeDeliveryEvent(payload) {
    return payload;
  },
  getCapabilities() {
    return {
      internal_notification: false,
      approved_customer_message: true,
      inbound_webhook: false,
      delivery_events: false,
      automatic_customer_send: false,
    };
  },
};
