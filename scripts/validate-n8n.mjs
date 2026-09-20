import { readFile, readdir } from "node:fs/promises";
import process from "node:process";

const root = new URL("../n8n-workflows/", import.meta.url);
const entries = await readdir(root, { withFileTypes: true });
const currentFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name.startsWith("CN-")).map((entry) => entry.name).sort();
const failures = [];
if (currentFiles.length !== 10) failures.push(`Expected 10 China workflows, found ${currentFiles.length}.`);

function validateGraph(file, workflow) {
  const names = new Set((workflow.nodes || []).map((node) => node.name));
  for (const [source, outputs] of Object.entries(workflow.connections || {})) {
    if (!names.has(source)) failures.push(`${file}: connection source ${source} does not exist.`);
    for (const branch of outputs.main || []) for (const edge of branch || []) if (!names.has(edge.node)) failures.push(`${file}: connection target ${edge.node} does not exist.`);
  }
}

for (const file of currentFiles) {
  const text = await readFile(new URL(file, root), "utf8");
  let workflow;
  try { workflow = JSON.parse(text); } catch (error) { failures.push(`${file}: invalid JSON (${error.message}).`); continue; }
  if (workflow.active !== false) failures.push(`${file}: must be inactive by default.`);
  if (text.toLowerCase().includes("whatsapp")) failures.push(`${file}: WhatsApp is not allowed in current workflows.`);
  if (text.includes("$json[0]")) failures.push(`${file}: current n8n items are objects; $json[0] is forbidden.`);
  if (/\b(sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})\b/.test(text)) failures.push(`${file}: possible embedded secret.`);
  for (const node of workflow.nodes || []) {
    if (node.type !== "n8n-nodes-base.httpRequest") continue;
    const method = String(node.parameters?.method || "GET").toUpperCase();
    const url = String(node.parameters?.url || "");
    const usesSupabaseCredential = Object.values(node.credentials || {}).some(
      (credential) => credential?.name === "Supabase Service Role (n8n only)",
    );
    const usesAiCredential = Object.values(node.credentials || {}).some(
      (credential) => credential?.name === "OpenAI-compatible AI Provider",
    );
    if (usesSupabaseCredential && (
      node.parameters?.genericAuthType !== "httpCustomAuth" ||
      node.credentials?.httpCustomAuth?.name !== "Supabase Service Role (n8n only)"
    )) failures.push(`${file}/${node.name}: Supabase server access must use encrypted Custom Auth with apikey and Authorization headers.`);
    if (usesAiCredential) {
      const body = String(node.parameters?.body || "");
      if (!body.includes("$env.AI_PROVIDER") || !body.includes("thinking:") || !body.includes("type: 'disabled'")) {
        failures.push(`${file}/${node.name}: AI requests must disable thinking mode only when AI_PROVIDER is deepseek.`);
      }
      if (body.includes("$json[0]")) failures.push(`${file}/${node.name}: AI request must read the current n8n item as an object, not $json[0].`);
      if (body.includes("response_format") && body.includes("json_object") && !body.includes("valid JSON object")) {
        failures.push(`${file}/${node.name}: JSON mode prompt must explicitly request a valid JSON object.`);
      }
    }
    if (node.name === "Read Active Scoring Profile" && url.includes("$json[0]")) failures.push(`${file}/${node.name}: profile lookup must read the current n8n item as an object.`);
    if (node.name === "Build Deterministic Score Command") {
      const code = String(node.parameters?.jsCode || "");
      if (!code.includes("extraction_confidence") || !code.includes("excluded_signal == null")) {
        failures.push(`${file}/${node.name}: score command must normalize DeepSeek confidence and nullable exclusion evidence.`);
      }
    }
    if (node.name === "Generate Draft") {
      const body = String(node.parameters?.body || "");
      if (!body.includes("using only the provided facts") || !body.includes("Do not use bracketed placeholders")) {
        failures.push(`${file}/${node.name}: customer draft prompt must prevent unsupported claims and unresolved placeholders.`);
      }
    }
    if (node.name === "Build Draft Command" && !String(node.parameters?.jsCode || "").includes("customer-draft-2")) {
      failures.push(`${file}/${node.name}: draft prompt version must match the hardened customer-draft-2 prompt.`);
    }
    if (method !== "GET" && /\/rest\/v1\/(leads|contacts|accounts|opportunities|follow_up_tasks|activities|message_drafts|messages)(\?|['"}])/.test(url)) failures.push(`${file}/${node.name}: direct core-table mutation is forbidden.`);
  }
  if (file === "CN-05-Feishu-Internal-Notification.json") {
    const nodes = new Map((workflow.nodes || []).map((node) => [node.name, node]));
    for (const name of ["Read Lead and Owner", "Read Verified Feishu Identity", "Read Active Feishu Connection"]) {
      if (nodes.get(name)?.alwaysOutputData !== true) failures.push(`${file}/${name}: empty reads must reach an explicit guard.`);
    }
    const requiredGuards = {
      "Ensure Assigned Lead": ["LEAD_NOT_FOUND", "LEAD_OWNER_REQUIRED"],
      "Ensure Verified Feishu Identity": ["FEISHU_IDENTITY_NOT_VERIFIED"],
      "Ensure Active Feishu Connection": ["FEISHU_CONNECTION_NOT_CONFIGURED"],
    };
    for (const [name, codes] of Object.entries(requiredGuards)) {
      const code = String(nodes.get(name)?.parameters?.jsCode || "");
      if (!nodes.has(name) || codes.some((errorCode) => !code.includes(errorCode))) {
        failures.push(`${file}/${name}: explicit pre-send guard is missing.`);
      }
    }
  }
  if (file === "CN-01-Outbox-Dispatcher.json") {
    const routeNode = (workflow.nodes || []).find((node) => node.name === "Route Events");
    const routeCode = String(routeNode?.parameters?.jsCode || "");
    if (!routeCode.includes("FEISHU_NOTIFICATIONS_ENABLED") || !routeCode.includes("feishuEnabled ? $vars.WF_FEISHU_NOTIFY_ID : null")) {
      failures.push(`${file}/Route Events: Feishu routes must stay behind the explicit disabled-by-default feature flag.`);
    }
  }
  validateGraph(file, workflow);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Validated ${currentFiles.length} inactive China workflows.`);
