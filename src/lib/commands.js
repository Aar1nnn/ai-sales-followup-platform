import { supabase } from "./supabase";
import { functionFailureDetails, toUserMessage } from "./errors";

export class CommandError extends Error {
  constructor(code, message, retryable = false) {
    super(toUserMessage({ code, message }, "操作没有完成，请稍后再试。"));
    this.name = "CommandError";
    this.code = code;
    this.retryable = retryable;
    this.technicalMessage = message;
  }
}

export function createCommandEnvelope({ commandName, organizationId, actorUserId, targetType, targetId = null, expectedVersion = null, payload = {}, idempotencyKey = crypto.randomUUID() }) {
  return {
    command_id: crypto.randomUUID(),
    idempotency_key: idempotencyKey,
    command_name: commandName,
    organization_id: organizationId,
    actor_user_id: actorUserId,
    target_type: targetType,
    target_id: targetId,
    expected_version: expectedVersion,
    source: "crm",
    occurred_at: new Date().toISOString(),
    payload,
  };
}

export async function executeCommand(input) {
  const envelope = createCommandEnvelope(input);
  const { data, error } = await supabase.functions.invoke("execute-command", { body: envelope });
  if (error) {
    const details = await functionFailureDetails(error, {
      fallback: "操作没有完成，请稍后再试。",
    });
    throw new CommandError(details.code, details.message, details.retryable);
  }
  if (!data?.ok) throw new CommandError(data?.error?.code || "VALIDATION_ERROR", data?.error?.message || "命令执行失败。", Boolean(data?.error?.retryable));
  return data;
}
