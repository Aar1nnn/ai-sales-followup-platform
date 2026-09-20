export const followUpRequiredOutcomes = new Set(["no_reply", "replied", "interested"]);
export const terminalOutcomes = new Set(["not_interested", "converted", "invalid"]);

export function manualDraftStep(status, externalContactConfirmed = false) {
  if (status === "sent") return 5;
  if (status === "approved") return externalContactConfirmed ? 4 : 3;
  if (status === "pending_approval") return 2;
  return 1;
}

export function validateManualSend(values) {
  const errors = {};
  if (!values.content?.trim()) errors.content = "必须保存实际发送内容快照。";
  if (!values.actual_channel) errors.actual_channel = "请选择实际发送渠道。";
  if (!values.outcome) errors.outcome = "请选择本次结果。";
  if (followUpRequiredOutcomes.has(values.outcome) && !values.next_follow_up_at) errors.next_follow_up_at = "该结果必须创建下一次跟进。";
  return errors;
}
