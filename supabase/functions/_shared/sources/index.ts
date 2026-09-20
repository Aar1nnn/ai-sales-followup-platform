import { AppError } from "../errors.ts";
import {
  builtinFormAdapter,
  genericWebhookAdapter,
  internalManualAdapter,
} from "./generic.ts";
import { tallyAdapter } from "./tally.ts";
import type { SourceAdapter, SourceConnection } from "./types.ts";

export function sourceAdapter(
  provider: SourceConnection["provider"],
): SourceAdapter {
  if (provider === "tally") return tallyAdapter;
  if (provider === "generic_webhook") return genericWebhookAdapter;
  if (provider === "internal_manual") return internalManualAdapter;
  if (provider === "builtin_form") return builtinFormAdapter;
  throw new AppError("PROVIDER_NOT_IMPLEMENTED");
}
