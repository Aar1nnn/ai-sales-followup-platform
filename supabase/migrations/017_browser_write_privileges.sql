-- Browser reads are protected by RLS, while core business writes must pass
-- through Edge Functions and service-role transaction RPCs. Supabase projects
-- may grant table writes to API roles by default, so revoke them explicitly.
revoke insert, update, delete, truncate, references, trigger
on all tables in schema public
from anon, authenticated;

-- A signed-in user may still maintain the profile row guarded by the
-- self-only RLS policies created in 010_rls_policies.sql.
grant insert, update on public.profiles to authenticated;

-- Keep future tables fail-closed until a migration grants a deliberate write.
alter default privileges in schema public
revoke insert, update, delete, truncate, references, trigger on tables
from anon, authenticated;
