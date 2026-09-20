const statusLabels = {
  invited: "待加入",
  new: "新线索",
  working: "跟进中",
  qualified: "已确认意向",
  disqualified: "暂不适合",
  converted: "已转商机",
  archived: "已归档",
  open: "待处理",
  snoozed: "已延后",
  completed: "已完成",
  cancelled: "已取消",
  draft: "待确认内容",
  pending_approval: "待审批",
  approved: "待发送",
  rejected: "需修改",
  sent: "已发送",
  won: "已成交",
  lost: "已流失",
  active: "正常",
  inactive: "已停用",
  provisional: "待核实",
  merged: "已合并",
  validating: "正在验证",
  recorded: "已记录",
  delivered: "已送达",
  failed: "未成功",
  accepted: "已接收",
  duplicate: "重复请求",
  processing: "处理中",
  processed: "已处理",
  expired: "已过期",
  succeeded: "已成功",
  pending: "等待处理",
  dead_letter: "需要人工处理",
  running: "运行中",
  complete: "信息完整",
  incomplete: "信息待补充",
  invalid: "无效",
  disabled: "未启用",
  no_reply: "暂未回复",
  replied: "已经回复",
  interested: "明确有兴趣",
  not_interested: "暂时没有兴趣",
};

const sourceLabels = {
  internal_manual: "系统手工录入",
  manual: "人工录入",
  tally: "在线表单",
  generic_webhook: "网站接口",
  builtin_form: "系统表单",
  referral: "客户转介绍",
  import: "批量导入",
};

const urgencyLabels = {
  immediate: "立即处理（7 天内）",
  high: "高（30 天内）",
  medium: "中（90 天内）",
  low: "低（90 天以上）",
};

const priorityLabels = {
  high: "高优先级",
  medium_high: "较高优先级",
  medium: "中优先级",
  low: "低优先级",
};

const activityLabels = {
  accept_lead: "接受线索",
  acknowledge_lead: "确认收到线索",
  assign_lead: "分配负责人",
  reassign_lead: "更换负责人",
  mark_contacted: "记录客户联系",
  record_outcome: "记录联系结果",
  schedule_follow_up: "安排下一次跟进",
  snooze_follow_up: "延后跟进",
  create_message_draft: "创建消息草稿",
  update_message_draft: "修改消息草稿",
  regenerate_message_draft: "重新生成消息草稿",
  approve_message_draft: "批准消息草稿",
  reject_message_draft: "退回消息草稿",
  mark_manual_message_sent: "记录人工发送",
  convert_lead: "转为商机",
  change_opportunity_stage: "变更商机阶段",
  mark_opportunity_won: "标记成交",
  mark_lead_invalid: "标记无效线索",
};

const aiProviderLabels = {
  aliyun_bailian: "阿里云百炼",
  dashscope: "阿里云百炼",
  deepseek: "深度求索（DeepSeek）",
  openai: "智能模型服务",
  openai_compatible: "兼容智能模型服务",
};

function containsChinese(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ""));
}

export function statusLabel(status) {
  if (statusLabels[status]) return statusLabels[status];
  if (containsChinese(status)) return status;
  return "状态待确认";
}

export function sourceLabel(source) {
  if (sourceLabels[source]) return sourceLabels[source];
  if (containsChinese(source)) return source;
  return source ? "其他来源" : "来源待确认";
}

export function urgencyLabel(urgency) {
  if (urgencyLabels[urgency]) return urgencyLabels[urgency];
  if (containsChinese(urgency)) return urgency;
  return urgency ? "时间要求待确认" : "尚未提供";
}

export function priorityLabel(priority) {
  return priorityLabels[priority] || "优先级待确认";
}

export function activityLabel(activityType, storedTitle) {
  if (activityLabels[activityType]) return activityLabels[activityType];
  if (containsChinese(storedTitle)) return storedTitle;
  return "系统操作记录";
}

export function aiProviderLabel(provider) {
  return aiProviderLabels[provider] || (provider ? "已配置的智能模型服务" : "尚未记录模型服务");
}

export function aiModelLabel(model) {
  const normalized = String(model || "").toLowerCase();
  if (normalized.includes("qwen")) return "通义千问模型";
  if (normalized.includes("deepseek")) return "深度求索模型";
  if (normalized.includes("glm")) return "智谱模型";
  if (normalized.includes("doubao")) return "豆包模型";
  return model ? "已配置模型" : "尚未记录模型";
}

export function formatBudget(amount, currency) {
  if (amount === null || amount === undefined || amount === "") return "尚未提供";
  const value = Number(amount);
  if (!Number.isFinite(value)) return "尚未提供";
  const formatted = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
  const units = { CNY: "人民币", USD: "美元", EUR: "欧元", HKD: "港币" };
  return units[currency] ? `${units[currency]} ${formatted}` : `${formatted}（币种待确认）`;
}

export function statusTone(status) {
  if (["completed", "sent", "won", "active", "converted", "succeeded"].includes(status)) return "success";
  if (["new", "pending_approval", "approved", "open"].includes(status)) return "info";
  if (["disqualified", "archived", "cancelled", "rejected", "lost", "invalid"].includes(status)) return "danger";
  return "neutral";
}

export function isSameLocalDay(left, right) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

export function dueLabel(value, now = new Date()) {
  if (!value) return "没有截止时间";
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return "时间未知";
  const deltaMinutes = Math.round((due.getTime() - now.getTime()) / 60000);
  if (deltaMinutes < -1440) return `已逾期 ${Math.abs(Math.round(deltaMinutes / 1440))} 天`;
  if (deltaMinutes < -60) return `已逾期 ${Math.abs(Math.round(deltaMinutes / 60))} 小时`;
  if (deltaMinutes < 0) return `已逾期 ${Math.max(1, Math.abs(deltaMinutes))} 分钟`;
  if (deltaMinutes < 60) return `${Math.max(1, deltaMinutes)} 分钟后到期`;
  if (isSameLocalDay(due, now)) return `今天 ${due.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  if (deltaMinutes < 2880) return `明天 ${due.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  return due.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function latestScore(lead) {
  return [...(lead.lead_scores || [])].sort((left, right) =>
    new Date(right.scored_at || 0).getTime() - new Date(left.scored_at || 0).getTime()
  )[0] || null;
}

export function buildWorkQueue({ leads = [], tasks = [], drafts = [], now = new Date() }) {
  const items = [];

  for (const task of tasks) {
    if (!["open", "snoozed"].includes(task.status)) continue;
    const due = new Date(task.due_at);
    const overdue = Number.isFinite(due.getTime()) && due < now;
    const dueToday = Number.isFinite(due.getTime()) && isSameLocalDay(due, now);
    if (!overdue && !dueToday) continue;
    items.push({
      id: `task:${task.id}`,
      kind: "task",
      priority: overdue ? 100 : 72,
      title: task.title || "客户跟进",
      customer: task.contacts?.full_name || "未命名客户",
      reason: overdue ? "跟进已超时，需要优先处理" : "今天需要完成的跟进",
      meta: dueLabel(task.due_at, now),
      href: task.lead_id ? `/leads/${task.lead_id}?from=task&task=${task.id}` : `/tasks/${task.id}`,
      actionLabel: "开始跟进",
      status: task.status,
      dueAt: task.due_at,
    });
  }

  for (const lead of leads) {
    if (!["new", "working", "qualified"].includes(lead.status)) continue;
    const score = latestScore(lead);
    const isUnassigned = !lead.owner_member_id;
    const isNew = lead.status === "new";
    if (!isUnassigned && !isNew) continue;
    items.push({
      id: `lead:${lead.id}`,
      kind: isUnassigned ? "unassigned" : "lead",
      priority: isUnassigned ? 94 : 88,
      title: lead.need || "等待确认客户需求",
      customer: lead.contacts?.full_name || "未命名客户",
      reason: isUnassigned ? "尚未分配负责人" : "新线索等待首次响应",
      meta: score?.normalized_score != null ? `AI 评分 ${Math.round(score.normalized_score)}` : "等待评分",
      href: `/leads/${lead.id}`,
      actionLabel: isUnassigned ? "分配并处理" : "确认并处理",
      status: lead.status,
      createdAt: lead.created_at,
    });
  }

  for (const draft of drafts) {
    if (!["draft", "pending_approval", "approved", "rejected"].includes(draft.status)) continue;
    const reasonByStatus = {
      draft: "草稿等待确认内容",
      pending_approval: "草稿等待审批",
      approved: "内容已批准，等待人工发送",
      rejected: "草稿被退回，需要修改",
    };
    items.push({
      id: `draft:${draft.id}`,
      kind: "draft",
      priority: draft.status === "pending_approval" ? 86 : draft.status === "approved" ? 82 : 66,
      title: (draft.content || "消息草稿").slice(0, 60),
      customer: draft.contacts?.full_name || "未命名客户",
      reason: reasonByStatus[draft.status],
      meta: statusLabel(draft.status),
      href: `/message-drafts/${draft.id}/review`,
      actionLabel: draft.status === "approved" ? "去发送" : "审核草稿",
      status: draft.status,
      updatedAt: draft.updated_at,
    });
  }

  return items.sort((left, right) => right.priority - left.priority ||
    new Date(left.dueAt || left.createdAt || left.updatedAt || 0).getTime() -
    new Date(right.dueAt || right.createdAt || right.updatedAt || 0).getTime());
}

export function filterWorkQueue(items, view) {
  if (!view || view === "all") return items;
  if (view === "leads") return items.filter((item) => ["lead", "unassigned"].includes(item.kind));
  if (view === "tasks") return items.filter((item) => item.kind === "task");
  if (view === "drafts") return items.filter((item) => item.kind === "draft");
  return items;
}
