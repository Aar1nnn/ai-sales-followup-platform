import { AppError } from "../errors.ts";
import type { ChannelProvider, ProviderConnection } from "./types.ts";

export function disabledProvider(
  provider: ProviderConnection["provider"],
  implemented = false,
): ChannelProvider {
  const fail = async (): Promise<never> => {
    throw new AppError(
      implemented ? "PROVIDER_DISABLED" : "PROVIDER_NOT_IMPLEMENTED",
      `${provider} is disabled in China Standard Template v1.`,
    );
  };
  return {
    validateConnection: fail,
    sendInternalNotification: fail,
    sendApprovedCustomerMessage: fail,
    receiveWebhook: fail,
    verifyWebhookSignature: fail,
    normalizeInboundMessage() {
      throw new AppError("PROVIDER_DISABLED");
    },
    normalizeDeliveryEvent() {
      throw new AppError("PROVIDER_DISABLED");
    },
    getCapabilities() {
      return {
        internal_notification: false,
        approved_customer_message: false,
        inbound_webhook: false,
        delivery_events: false,
        automatic_customer_send: false,
      };
    },
  };
}
