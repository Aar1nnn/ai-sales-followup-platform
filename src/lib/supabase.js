import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
const supportedAuthFlows = new Set(["invite", "recovery"]);

function authFlowFromLocation() {
  if (typeof window === "undefined") return null;
  const type = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("type");
  return supportedAuthFlows.has(type) ? type : null;
}

export const initialAuthFlow = authFlowFromLocation();

export const configurationError = !supabaseUrl || !supabaseKey
  ? "缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_PUBLISHABLE_KEY，当前不能连接 CRM。"
  : null;

export const supabase = createClient(
  supabaseUrl || "http://127.0.0.1:54321",
  supabaseKey || "local-build-placeholder-key",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
