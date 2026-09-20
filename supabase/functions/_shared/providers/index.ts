import { AppError } from "../errors.ts";
import { disabledProvider } from "./disabled.ts";
import { feishuProvider } from "./feishu.ts";
import { manualProvider } from "./manual.ts";
import type { ChannelProvider, ProviderConnection } from "./types.ts";

export function channelProvider(
  provider: ProviderConnection["provider"],
): ChannelProvider {
  if (provider === "manual") return manualProvider;
  if (provider === "feishu_internal") return feishuProvider;
  if (provider === "whatsapp_business") return disabledProvider(provider, true);
  if (
    [
      "wecom_internal",
      "wecom_customer_contact",
      "wechat_customer_service",
      "email",
    ].includes(provider)
  ) return disabledProvider(provider);
  throw new AppError("PROVIDER_NOT_IMPLEMENTED");
}
