import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";

const listed = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).split("\0").filter(Boolean);

const failures = [];
const forbiddenPaths = [
  /^\.env(?!\.example$)(?:\.|$)/,
  /(^|\/)\.env\.local$/,
  /(^|\/)picture\//,
  /(^|\/)docs\/demo\//,
  /(^|\/)n8n-workflows\/archive\//,
  /(^|\/)(?:dist|coverage|test-results|playwright-report|node_modules)\//,
];
const emailPattern = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/giu;
const allowedEmailDomains = new Set(["example.com", "example.test"]);

for (const file of listed) {
  const normalized = file.replaceAll("\\", "/");
  if (forbiddenPaths.some((pattern) => pattern.test(normalized))) {
    failures.push(`${normalized}: forbidden public-repository path`);
    continue;
  }
  if (/\.(?:png|jpe?g|gif|woff2?|ico)$/iu.test(normalized) || normalized === "package-lock.json") continue;

  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    continue;
  }

  for (const match of text.matchAll(emailPattern)) {
    const domain = match[1].toLowerCase();
    if (!allowedEmailDomains.has(domain) && !domain.endsWith(".example")) {
      failures.push(`${normalized}: non-example email domain (${domain})`);
    }
  }
  if (/https:\/\/[a-z0-9]{20}\.supabase\.co/iu.test(text)) {
    failures.push(`${normalized}: concrete Supabase project reference`);
  }

  if (normalized.startsWith("n8n-workflows/") && normalized.endsWith(".json")) {
    try {
      const workflow = JSON.parse(text);
      for (const node of workflow.nodes || []) {
        for (const credential of Object.values(node.credentials || {})) {
          if (String(credential?.id || "").trim()) {
            failures.push(`${normalized}: embedded n8n Credential ID`);
          }
        }
      }
    } catch {
      // JSON validity is checked by validate-n8n.mjs.
    }
  }
}

if (failures.length) {
  console.error([...new Set(failures)].join("\n"));
  process.exit(1);
}
console.log(`Public-data scan passed for ${listed.length} repository files.`);
