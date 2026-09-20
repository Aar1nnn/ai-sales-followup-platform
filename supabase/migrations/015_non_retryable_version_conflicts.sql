-- VERSION_CONFLICT is an optimistic-concurrency business error, not a
-- PostgreSQL serialization failure. SQLSTATE 40001 may be retried by the API
-- infrastructure and can leave the caller waiting until the connection is
-- closed. Use the generic user-defined exception state instead; the stable
-- message is what the Edge Function maps to HTTP 409.

create or replace function crm.assert_expected_version(
  p_organization_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_version bigin
)
returns bigin
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_version bigint;
begin
  if p_expected_version is null or p_target_id is null then
    return null;
  end if;

  v_table := case p_target_type
    when 'organization' then 'organizations'
    when 'lead' then 'leads'
    when 'contact' then 'contacts'
    when 'opportunity' then 'opportunities'
    when 'task' then 'follow_up_tasks'
    when 'message_draft' then 'message_drafts'
    when 'assignment_settings' then 'organization_assignment_settings'
    else null
  end;

  if v_table is null then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  if v_table = 'organizations' then
    execute format('select version from public.%I where id = $1 for update', v_table)
      into v_version using p_target_id;
  else
    execute format('select version from public.%I where organization_id = $1 and id = $2 for update', v_table)
      into v_version using p_organization_id, p_target_id;
  end if;

  if v_version is null then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  if v_version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'VERSION_CONFLICT';
  end if;
  return v_version;
end;
$$;

-- execute_admin_command predates the shared assertion helper and contains four
-- inline concurrency checks. Patch its stored definition in place so existing
-- deployments are fixed without duplicating the entire function body here.
do $migration$
declare
  v_definition text;
  v_patched_definition text;
  v_old_fragment constant text := 'errcode = ''40001'', message = ''VERSION_CONFLICT''';
  v_new_fragment constant text := 'errcode = ''P0001'', message = ''VERSION_CONFLICT''';
  v_occurrences integer;
begin
  select pg_get_functiondef('crm.execute_admin_command(jsonb)'::regprocedure)
    into v_definition;

  v_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old_fragment, ''))
  ) / length(v_old_fragment);

  if v_occurrences <> 4 then
    raise exception 'Expected four retryable VERSION_CONFLICT states, found %', v_occurrences;
  end if;

  v_patched_definition := replace(v_definition, v_old_fragment, v_new_fragment);
  execute v_patched_definition;
end;
$migration$;
