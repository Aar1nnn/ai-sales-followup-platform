const fieldAliases = {
  lead: ["lead_request_id", "lead_id", "lead", "lead_name", "request_id"],
  customer: ["customer_name", "customer", "name"],
  phone: ["phone", "phone_number", "mobile"],
  assignee: ["assigned_to", "assigned_salesperson", "salesperson", "owner"],
  followUpDate: ["follow_up_date", "followup_date", "scheduled_for", "due_date", "next_follow_up", "date"],
  status: ["status", "result", "state"],
  notes: ["notes", "note", "description"],
  createdAt: ["created_at", "created_date"],
};

export function getFollowUpFieldName(followUp, field) {
  return fieldAliases[field]?.find((name) =>
    Object.prototype.hasOwnProperty.call(followUp, name),
  );
}

export function getFollowUpValue(followUp, field) {
  const name = getFollowUpFieldName(followUp, field);
  return name ? followUp[name] : "";
}

export function formatFollowUpValue(value, field) {
  if (value === null || value === undefined || value === "") return "—";

  if (field === "createdAt" || field === "followUpDate") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }

  return String(value);
}

export function toDateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
