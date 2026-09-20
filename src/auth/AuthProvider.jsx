import { useCallback, useEffect, useMemo, useState } from "react";
import { configurationError, initialAuthFlow, supabase } from "../lib/supabase";
import { toUserMessage } from "../lib/errors";
import { AuthContext } from "./context";

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [membership, setMembership] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(configurationError);
  const [authFlow, setAuthFlow] = useState(initialAuthFlow);

  const loadMembership = useCallback(async (nextSession) => {
    if (!nextSession) {
      setMembership(null); setOrganization(null); setLoading(false); return;
    }
    const { data, error: queryError } = await supabase.from("organization_members")
      .select("id,organization_id,role,status,profiles(display_name),organizations(id,name,status,version)")
      .eq("user_id", nextSession.user.id).eq("status", "active").limit(1).maybeSingle();
    if (queryError) {
      setError(toUserMessage(queryError, "无法读取企业账号信息，请刷新页面或重新登录。")); setMembership(null); setOrganization(null);
    } else {
      setMembership(data); setOrganization(data?.organizations ?? null); setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      return loadMembership(data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") setAuthFlow("recovery");
      setSession(nextSession); setLoading(true); void loadMembership(nextSession);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [loadMembership]);

  const requiresPasswordSetup = authFlow === "invite" || authFlow === "recovery" || session?.user?.user_metadata?.requires_password_setup === true;
  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    membership,
    organization,
    loading,
    error,
    requiresPasswordSetup,
    completePasswordSetup: () => setAuthFlow(null),
    refreshMembership: () => loadMembership(session),
  }), [session, membership, organization, loading, error, requiresPasswordSetup, loadMembership]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
