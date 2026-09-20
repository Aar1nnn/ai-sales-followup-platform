import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";

const patterns = [
  ["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g],
  ["JWT", /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
];

function findings(label, text) {
  return patterns.flatMap(([kind, pattern]) => {
    pattern.lastIndex = 0;
    return pattern.test(text) ? [`${label}: ${kind}`] : [];
  });
}

const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const failures = [];
for (const file of listed) {
  if (/\.(png|jpg|jpeg|gif|zip|woff2?)$/i.test(file) || file === "package-lock.json") continue;
  try { failures.push(...findings(file, await readFile(file, "utf8"))); } catch { /* binary or concurrently removed */ }
}
let history = "";
try {
  history = execFileSync("git", ["log", "-p", "--all", "--", ".", ":(exclude)package-lock.json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch {
  // A brand-new public repository has no history until its first clean commit.
}
failures.push(...findings("git-history", history));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Secret scan passed for ${listed.length} working-tree files and Git history.`);
