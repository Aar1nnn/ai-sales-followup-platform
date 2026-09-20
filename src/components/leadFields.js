const fieldAliases = {
  requestId: ["request_id", "requestId"],
  customerName: ["customer_name", "name", "full_name", "customer"],
  phone: ["phone", "phone_number", "mobile"],
  industry: ["industry"],
  priority: ["priority"],
  assignedTo: ["assigned_to", "assigned_salesperson", "salesperson", "owner"],
  pipelineStage: ["pipeline_stage", "stage", "status"],
  nextFollowUp: ["next_follow_up", "next_follow_up_at", "next_followup"],
  notes: ["notes", "note"],
  createdAt: ["created_at", "created_date"],
};

const labels = {
  requestId: "Request ID",
  customerName: "Customer Name",
  phone: "Phone",
  industry: "Industry",
  priority: "Priority",
  assignedTo: "Assigned To",
  pipelineStage: "Pipeline Stage",
  nextFollowUp: "Next Follow Up",
  notes: "Notes",
  createdAt: "Created Date",
};

const editableFields = new Set([
  "assignedTo",
  "priority",
  "pipelineStage",
  "nextFollowUp",
  "notes",
]);

export function getLeadFieldName(lead, field) {
  return fieldAliases[field]?.find((name) =>
    Object.prototype.hasOwnProperty.call(lead, name),
  );
}

export function getLeadValue(lead, field) {
  const fieldName = getLeadFieldName(lead, field);
  return fieldName ? lead[fieldName] : "";
}

export function getLeadLabel(field) {
  return labels[field] || field;
}

export function isEditableLeadField(field) {
  return editableFields.has(field);
}

export function toDateInputValue(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
}

export function formatLeadValue(value, field) {
  if (value === null || value === undefined || value === "") return "—";

  if (field === "createdAt" || field === "nextFollowUp") {
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
