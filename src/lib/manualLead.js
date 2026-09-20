import { supabase } from "./supabase";
import { functionFailureDetails } from "./errors";

export const emptyManualLead = {
  name: "",
  company: "",
  phone: "",
  email: "",
  wechat: "",
  need: "",
  budget: "",
  urgency: "",
  notes: "",
  contactPermission: false,
};

export const demoManualLead = {
  name: "示例联系人",
  company: "示例科技有限公司",
  phone: "",
  email: "lead@example.test",
  wechat: "example_contact",
  need: "公司有 18 名销售，线索来自官网、展会和转介绍，希望用 AI 统一整理客户需求、判断优先级、自动分配销售并生成跟进草稿。",
  budget: "120000",
  urgency: "high",
  notes: "计划 4 周内上线第一版。销售负责人和总经理会共同评估演示，重点关注首次响应速度、人工审核和后续任务是否可追踪。",
  contactPermission: true,
};

function normalized(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateManualLeadForm(values) {
  if (!normalized(values.name)) return "请填写客户姓名。";
  if (!normalized(values.need)) return "请填写客户的具体需求。";
  if (![values.phone, values.email, values.wechat].some((value) => normalized(value))) {
    return "电话、邮箱或微信至少填写一项。";
  }
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized(values.email))) {
    return "邮箱格式不正确。";
  }
  if (values.phone && !/^[0-9+()\-\s]{6,40}$/.test(normalized(values.phone))) {
    return "电话格式不正确。";
  }
  if (values.budget !== "" && (!Number.isFinite(Number(values.budget)) || Number(values.budget) < 0)) {
    return "预算必须是大于或等于 0 的数字。";
  }
  if (!values.contactPermission) return "请确认企业拥有联系该客户的合法依据。";
  return null;
}

export function buildManualLeadPayload(values, organizationId, sourceEventId) {
  const validationError = validateManualLeadForm(values);
  if (validationError) throw new Error(validationError);
  return {
    organization_id: organizationId,
    source_event_id: sourceEventId,
    contact: {
      name: normalized(values.name),
      company: normalized(values.company) || null,
      phone: normalized(values.phone) || null,
      email: normalized(values.email).toLowerCase() || null,
      wechat: normalized(values.wechat) || null,
    },
    lead: {
      need: normalized(values.need),
      budget: values.budget === "" ? null : Number(values.budget),
      urgency: normalized(values.urgency) || null,
      notes: normalized(values.notes) || null,
    },
    tracking: {
      utm_source: "crm_manual",
      utm_medium: "internal",
      utm_campaign: null,
      landing_page: "/leads/new",
      referrer: null,
    },
    consent: {
      contact_permission: true,
      captured_via: "crm_manual_entry",
    },
    metadata: { manual_created: true },
  };
}

export async function createManualLead(payload) {
  const { data, error } = await supabase.functions.invoke("lead-intake/manual", { body: payload });
  if (error) {
    const details = await functionFailureDetails(error, {
      fallback: "线索没有创建成功，请稍后再试。",
      codeMessages: {
        NOT_FOUND: "当前服务器还没有启用手工创建线索。请使用本地验收环境，或请管理员完成系统升级。",
        CONNECTION_INVALID: "手工录入入口尚未准备好，请联系管理员完成系统配置。",
      },
    });
    const failure = new Error(details.message);
    failure.code = details.code;
    throw failure;
  }
  if (!data?.lead_id || !["accepted", "duplicate"].includes(data.status)) {
    const failure = new Error("服务器没有返回有效的线索记录。");
    failure.code = "TRANSIENT_PROVIDER_ERROR";
    throw failure;
  }
  return data;
}
