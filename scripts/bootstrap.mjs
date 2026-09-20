import { createClient } from "@supabase/supabase-js";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BOOTSTRAP_OWNER_EMAIL", "BOOTSTRAP_OWNER_PASSWORD", "PRIMARY_ORGANIZATION_NAME", "PRIMARY_ORGANIZATION_SLUG"];
for (const key of required) if (!process.env[key]) throw new Error(`Missing ${key}`);

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let owner = null;
for (let page = 1; page <= 20 && !owner; page += 1) {
  const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw error;
  owner = data.users.find((user) => user.email?.toLowerCase() === process.env.BOOTSTRAP_OWNER_EMAIL.toLowerCase()) ?? null;
  if (data.users.length < 100) break;
}
if (!owner) {
  const { data, error } = await client.auth.admin.createUser({ email: process.env.BOOTSTRAP_OWNER_EMAIL, password: process.env.BOOTSTRAP_OWNER_PASSWORD, email_confirm: true, user_metadata: { display_name: process.env.BOOTSTRAP_OWNER_DISPLAY_NAME || "Owner" } });
  if (error || !data.user) throw error || new Error("Owner creation failed");
  owner = data.user;
}
const { data, error } = await client.schema("crm").rpc("bootstrap_organization", {
  p_organization_name: process.env.PRIMARY_ORGANIZATION_NAME,
  p_organization_slug: process.env.PRIMARY_ORGANIZATION_SLUG,
  p_owner_user_id: owner.id,
  p_owner_display_name: process.env.BOOTSTRAP_OWNER_DISPLAY_NAME || owner.email,
});
if (error) throw error;
const { error: manualSourceError } = await client.schema("crm").rpc("ensure_authenticated_manual_source", {
  p_organization_id: data.organization_id,
});
if (manualSourceError) throw manualSourceError;
console.log(JSON.stringify({ ok: true, organization_id: data.organization_id, owner_user_id: owner.id }));
