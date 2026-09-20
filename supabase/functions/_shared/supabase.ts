import {
  createClient,
  type SupabaseClient,
  type User,
} from "npm:@supabase/supabase-js@2.57.4";
import { AppError } from "./errors.ts";

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new AppError(
      "CONNECTION_INVALID",
      "Server configuration is incomplete.",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { "x-client-info": "ai-sales-followup-platform-edge-v1" },
    },
  });
}

export async function authenticatedUser(
  request: Request,
  client = adminClient(),
): Promise<User> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AppError("UNAUTHENTICATED");
  const { data, error } = await client.auth.getUser(match[1]);
  if (error || !data.user) throw new AppError("UNAUTHENTICATED");
  return data.user;
}

export async function memberRole(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<{ id: string; role: "owner" | "admin" | "manager" | "sales" }> {
  const { data, error } = await client
    .from("organization_members")
    .select("id,role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data) throw new AppError("FORBIDDEN");
  return data as { id: string; role: "owner" | "admin" | "manager" | "sales" };
}

export async function vaultSecret(
  client: SupabaseClient,
  secretRef: string | null,
): Promise<string | null> {
  if (!secretRef) return null;
  const { data, error } = await client.schema("crm").rpc("read_vault_secret", {
    p_secret_ref: secretRef,
  });
  if (error || typeof data !== "string") {
    throw new AppError("CONNECTION_INVALID");
  }
  return data;
}
