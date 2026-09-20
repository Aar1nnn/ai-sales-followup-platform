create or replace function public.set_updated_at_and_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'profiles', 'organization_members', 'accounts', 'contacts', 'leads',
    'pipeline_stages', 'opportunities', 'activities', 'follow_up_tasks',
    'organization_scoring_profiles', 'lead_scores', 'channel_connections',
    'contact_channel_identities', 'organization_member_channel_identities',
    'message_drafts', 'messages', 'organization_assignment_settings', 'lead_source_connections',
    'inbound_events', 'command_executions', 'outbox_events', 'organization_purge_jobs'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at_version before update on public.%I for each row execute function public.set_updated_at_and_version()',
      table_name,
      table_name
    );
  end loop;
end
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'score_history', 'delivery_events', 'assignment_history', 'automation_runs',
    'audit_logs', 'organization_tombstones'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end
$$;

create or replace function crm.require_service_role()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
end;
$$;

create or replace function crm.assert_expected_version(
  p_organization_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_version bigint
)
returns bigint
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
    raise exception using errcode = '40001', message = 'VERSION_CONFLICT';
  end if;
  return v_version;
end;
$$;

create or replace function crm.select_assignment_candidate(p_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.organization_assignment_settings%rowtype;
  v_member_id uuid;
begin
  perform crm.require_service_role();
  select * into v_settings
  from public.organization_assignment_settings
  where organization_id = p_organization_id
  for update;

  if not found or not v_settings.auto_assignment_enabled or v_settings.strategy = 'manager_manual' then
    return null;
  end if;

  select candidate.id into v_member_id
  from (
    select
      m.id,
      m.last_assigned_at,
      count(t.id) filter (where t.status in ('open', 'snoozed')) as open_tasks,
      (
        select count(*)
        from public.assignment_history h
        where h.organization_id = p_organization_id
          and h.to_member_id = m.id
          and h.created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'
      ) as assigned_today,
      coalesce(m.daily_lead_limit, v_settings.default_daily_limit) as effective_limit
    from public.organization_members m
    left join public.follow_up_tasks t
      on t.organization_id = m.organization_id and t.assignee_member_id = m.id
    where m.organization_id = p_organization_id
      and m.role = 'sales'
      and m.status = 'active'
      and m.accepts_assignments
      and not m.is_away
    group by m.id, m.last_assigned_at, m.daily_lead_limit
  ) candidate
  where not v_settings.daily_limit_enabled
     or candidate.effective_limit is null
     or candidate.assigned_today < candidate.effective_limit
  order by
    case when v_settings.strategy = 'least_open_tasks' then candidate.open_tasks end asc,
    candidate.last_assigned_at asc nulls first,
    candidate.id
  limit 1;

  if v_member_id is not null then
    perform 1 from public.organization_members
    where organization_id = p_organization_id and id = v_member_id
    for update;
  end if;

  return v_member_id;
end;
$$;

create or replace function crm.intake_lead(
  p_connection_id uuid,
  p_source_event_id text,
  p_received_at timestamptz,
  p_raw_payload jsonb,
  p_normalized_payload jsonb,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.lead_source_connections%rowtype;
  v_existing public.inbound_events%rowtype;
  v_event_id uuid;
  v_request_id uuid;
  v_contact_id uuid;
  v_account_id uuid;
  v_lead_id uuid;
  v_outbox_id uuid;
  v_phone text := nullif(btrim(p_normalized_payload #>> '{contact,phone}'), '');
  v_email text := nullif(lower(btrim(p_normalized_payload #>> '{contact,email}')), '');
  v_company text := nullif(btrim(p_normalized_payload #>> '{contact,company}'), '');
  v_need text := nullif(btrim(p_normalized_payload #>> '{lead,need}'), '');
  v_phone_verified boolean;
  v_email_verified boolean;
  v_window integer;
begin
  perform crm.require_service_role();
  if p_source_event_id is null or btrim(p_source_event_id) = ''
    or jsonb_typeof(p_raw_payload) <> 'object'
    or jsonb_typeof(p_normalized_payload) <> 'object'
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  select * into v_connection
  from public.lead_source_connections
  where id = p_connection_id and status = 'active'
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'CONNECTION_INVALID'; end if;
  if not exists (
    select 1 from public.organizations where id = v_connection.organization_id and status = 'active'
  ) then raise exception using errcode = '55000', message = 'ORGANIZATION_INACTIVE'; end if;

  select * into v_existing from public.inbound_events
  where organization_id = v_connection.organization_id
    and provider = v_connection.provider and source_event_id = p_source_event_id;
  if found then
    if v_existing.payload_sha256 <> p_payload_sha256 then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'request_id', v_existing.request_id,
      'inbound_event_id', v_existing.id,
      'lead_id', v_existing.lead_id,
      'status', 'duplicate'
    );
  end if;

  insert into public.inbound_events (
    organization_id, source_connection_id, provider, source_event_id, schema_version, status,
    raw_payload, normalized_payload, payload_sha256, received_at
  ) values (
    v_connection.organization_id, v_connection.id, v_connection.provider, p_source_event_id,
    coalesce(nullif(p_normalized_payload ->> 'schema_version', ''), '1.0'), 'accepted',
    p_raw_payload, p_normalized_payload, p_payload_sha256, coalesce(p_received_at, now())
  ) returning id, request_id into v_event_id, v_request_id;

  v_phone_verified := coalesce(v_connection.settings -> 'verified_identity_fields' ? 'phone', false);
  v_email_verified := coalesce(v_connection.settings -> 'verified_identity_fields' ? 'email', false);

  if v_phone_verified and v_phone is not null then
    select id into v_contact_id from public.contacts
    where organization_id = v_connection.organization_id and phone_verified_at is not null
      and lower(btrim(phone)) = lower(v_phone) and status <> 'merged'
    limit 1 for update;
  end if;
  if v_contact_id is null and v_email_verified and v_email is not null then
    select id into v_contact_id from public.contacts
    where organization_id = v_connection.organization_id and email_verified_at is not null
      and lower(btrim(email)) = v_email and status <> 'merged'
    limit 1 for update;
  end if;

  if v_company is not null then
    select id into v_account_id from public.accounts
    where organization_id = v_connection.organization_id and lower(btrim(name)) = lower(v_company)
    order by created_at limit 1;
    if v_account_id is null then
      insert into public.accounts (organization_id, name)
      values (v_connection.organization_id, v_company) returning id into v_account_id;
    end if;
  end if;

  if v_contact_id is null then
    insert into public.contacts (
      organization_id, account_id, full_name, phone, phone_verified_at, email, email_verified_at,
      wechat, identity_pending, status
    ) values (
      v_connection.organization_id, v_account_id, p_normalized_payload #>> '{contact,name}', v_phone,
      case when v_phone_verified then now() else null end, v_email,
      case when v_email_verified then now() else null end, nullif(p_normalized_payload #>> '{contact,wechat}', ''),
      not v_phone_verified and not v_email_verified, 'provisional'
    ) returning id into v_contact_id;
  elsif v_account_id is not null then
    update public.contacts set account_id = coalesce(account_id, v_account_id)
    where organization_id = v_connection.organization_id and id = v_contact_id;
  end if;

  select lead_deduplication_window_days into v_window
  from public.organization_assignment_settings where organization_id = v_connection.organization_id;
  v_window := coalesce(v_window, 30);
  select id into v_lead_id from public.leads
  where organization_id = v_connection.organization_id
    and contact_id = v_contact_id
    and source = v_connection.provider
    and coalesce(need, '') = coalesce(v_need, '')
    and status not in ('disqualified', 'converted', 'archived')
    and created_at >= now() - make_interval(days => v_window)
  order by created_at desc limit 1 for update;

  if v_lead_id is null then
    insert into public.leads (
      organization_id, contact_id, account_id, source, source_connection_id, need,
      budget_amount, urgency, notes, consent, tracking, metadata
    ) values (
      v_connection.organization_id, v_contact_id, v_account_id, v_connection.provider, v_connection.id, v_need,
      nullif(p_normalized_payload #>> '{lead,budget}', '')::numeric,
      nullif(p_normalized_payload #>> '{lead,urgency}', ''), nullif(p_normalized_payload #>> '{lead,notes}', ''),
      coalesce(p_normalized_payload -> 'consent', '{}'::jsonb),
      coalesce(p_normalized_payload -> 'tracking', '{}'::jsonb),
      coalesce(p_normalized_payload -> 'metadata', '{}'::jsonb)
    ) returning id into v_lead_id;
  else
    update public.leads set
      notes = concat_ws(E'\n', notes, nullif(p_normalized_payload #>> '{lead,notes}', '')),
      metadata = metadata || coalesce(p_normalized_payload -> 'metadata', '{}'::jsonb)
    where organization_id = v_connection.organization_id and id = v_lead_id;
  end if;

  update public.inbound_events set status = 'processed', lead_id = v_lead_id, processed_at = now()
  where id = v_event_id;
  insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload)
  values (
    v_connection.organization_id, 'lead', v_lead_id, 'lead.intake.accepted',
    jsonb_build_object('lead_id', v_lead_id, 'inbound_event_id', v_event_id, 'source', v_connection.provider)
  ) returning id into v_outbox_id;

  return jsonb_build_object(
    'request_id', v_request_id, 'inbound_event_id', v_event_id, 'lead_id', v_lead_id,
    'status', 'accepted', 'outbox_event_ids', jsonb_build_array(v_outbox_id)
  );
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
end;
$$;

-- Functions created after the first privilege block must also stay server-only.
revoke all on all functions in schema crm from public, anon, authenticated;
grant execute on all functions in schema crm to service_role;

create or replace function crm.claim_outbox_events(p_worker_id text, p_limit integer default 20)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform crm.require_service_role();
  if nullif(btrim(p_worker_id), '') is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  update public.outbox_events set
    status = case when attempts >= max_attempts then 'dead_letter'::public.outbox_status else 'pending'::public.outbox_status end,
    available_at = now() + interval '1 minute', locked_at = null, locked_by = null,
    last_error_code = 'STALE_WORKER_LOCK', last_error_message = 'Recovered after worker lock timeout.'
  where status = 'processing' and locked_at < now() - interval '15 minutes';
  return query
  with claimable as (
    select e.id
    from public.outbox_events e
    join public.organizations o on o.id = e.organization_id and o.status = 'active'
    where e.status = 'pending' and e.available_at <= now()
    order by e.available_at, e.created_at
    limit p_limit
    for update of e skip locked
  )
  update public.outbox_events e
  set status = 'processing', locked_at = now(), locked_by = p_worker_id, attempts = e.attempts + 1
  from claimable c
  where e.id = c.id
  returning e.*;
end;
$$;

create or replace function crm.complete_outbox_event(p_event_id uuid, p_worker_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_event public.outbox_events%rowtype;
begin
  perform crm.require_service_role();
  update public.outbox_events set status = 'completed', completed_at = now(), locked_at = null, locked_by = null
  where id = p_event_id and status = 'processing' and locked_by = p_worker_id returning * into v_event;
  if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  return jsonb_build_object('event_id', v_event.id, 'status', v_event.status);
end;
$$;

create or replace function crm.fail_outbox_event(
  p_event_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_event public.outbox_events%rowtype;
begin
  perform crm.require_service_role();
  update public.outbox_events set
    status = case when attempts >= max_attempts then 'dead_letter'::public.outbox_status else 'pending'::public.outbox_status end,
    available_at = case when attempts >= max_attempts then available_at
      else now() + make_interval(secs => least(3600, power(2, greatest(attempts, 1))::integer)) end,
    locked_at = null, locked_by = null, last_error_code = left(p_error_code, 120),
    last_error_message = left(p_error_message, 1000)
  where id = p_event_id and status = 'processing' and locked_by = p_worker_id returning * into v_event;
  if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  return jsonb_build_object('event_id', v_event.id, 'status', v_event.status, 'attempts', v_event.attempts);
end;
$$;

create or replace function crm.bootstrap_organization(
  p_organization_name text,
  p_organization_slug text,
  p_owner_user_id uuid,
  p_owner_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_owner_member_id uuid;
begin
  perform crm.require_service_role();
  if nullif(btrim(p_organization_name), '') is null
    or nullif(btrim(p_owner_display_name), '') is null
    or p_organization_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'
    or not exists (select 1 from auth.users where id = p_owner_user_id)
  then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;

  select id into v_organization_id from public.organizations where slug = p_organization_slug for update;
  if v_organization_id is null then
    insert into public.organizations (name, slug, is_primary)
    values (p_organization_name, p_organization_slug, true) returning id into v_organization_id;
  end if;

  insert into public.profiles (id, display_name)
  values (p_owner_user_id, p_owner_display_name)
  on conflict (id) do update set display_name = excluded.display_name;

  select id into v_owner_member_id from public.organization_members
  where organization_id = v_organization_id and user_id = p_owner_user_id;
  if v_owner_member_id is null then
    if exists (
      select 1 from public.organization_members where organization_id = v_organization_id and role = 'owner' and status = 'active'
    ) then raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT'; end if;
    insert into public.organization_members (organization_id, user_id, role, status, activated_at)
    values (v_organization_id, p_owner_user_id, 'owner', 'active', now()) returning id into v_owner_member_id;
  end if;

  insert into public.pipeline_stages (organization_id, name, stage_key, position, is_default, is_closed, is_won)
  values
    (v_organization_id, '需求确认', 'discovery', 10, true, false, false),
    (v_organization_id, '方案沟通', 'proposal', 20, false, false, false),
    (v_organization_id, '商务谈判', 'negotiation', 30, false, false, false),
    (v_organization_id, '已成交', 'won', 40, false, true, true),
    (v_organization_id, '已流失', 'lost', 50, false, true, false)
  on conflict (organization_id, stage_key) do nothing;

  insert into public.organization_assignment_settings (organization_id, updated_by_member_id)
  values (v_organization_id, v_owner_member_id)
  on conflict (organization_id) do nothing;

  if not exists (
    select 1 from public.organization_scoring_profiles where organization_id = v_organization_id and status = 'active'
  ) then
    insert into public.organization_scoring_profiles (
      organization_id, name, profile_version, status, currency, created_by_member_id
    ) values (v_organization_id, 'Standard v1', 1, 'active', 'CNY', v_owner_member_id);
  end if;

  insert into public.channel_connections (organization_id, provider, name, status, public_config, capabilities, created_by_member_id)
  values (
    v_organization_id, 'manual', '人工发送', 'active', '{}'::jsonb,
    '{"send_approved_customer_message":"manual_action_required","customer_auto_send":false}'::jsonb,
    v_owner_member_id
  ) on conflict (organization_id, provider, name) do nothing;

  return jsonb_build_object(
    'organization_id', v_organization_id,
    'owner_member_id', v_owner_member_id,
    'status', 'ready'
  );
end;
$$;

create or replace function crm.purge_organization_step(
  p_organization_id uuid,
  p_storage_cleared boolean default false,
  p_batch_size integer default 500,
  p_auth_users_cleared boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations%rowtype;
  v_job public.organization_purge_jobs%rowtype;
  v_affected integer := 0;
  v_count integer := 0;
  v_user_ids uuid[];
  v_org_hash text;
  v_name_hash text;
  v_audit_hash text;
  v_report jsonb;
begin
  perform crm.require_service_role();
  if p_batch_size not between 1 and 5000 then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
  select * into v_org from public.organizations where id = p_organization_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  if v_org.status not in ('pending_deletion', 'purging', 'purge_failed') or v_org.deletion_scheduled_at > now() then
    raise exception using errcode = '55000', message = 'ORGANIZATION_INACTIVE';
  end if;
  select * into v_job from public.organization_purge_jobs
  where organization_id = p_organization_id and status in ('scheduled', 'running', 'failed')
  order by created_at desc limit 1 for update;
  if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  update public.organizations set status = 'purging' where id = p_organization_id;
  update public.organization_purge_jobs set status = 'running', started_at = coalesce(started_at, now()), attempts = attempts + 1
  where id = v_job.id;

  if v_job.current_phase = 'storage' then
    if not p_storage_cleared then raise exception using errcode = '55000', message = 'VALIDATION_ERROR'; end if;
    update public.organization_purge_jobs set current_phase = 'inbound', cursor = '{"storage":"cleared"}'::jsonb where id = v_job.id;
    return jsonb_build_object('status', 'running', 'completed_phase', 'storage', 'next_phase', 'inbound');
  elsif v_job.current_phase = 'inbound' then
    delete from public.delivery_events where id in (
      select id from public.delivery_events where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_affected = row_count;
    delete from public.inbound_events where id in (
      select id from public.inbound_events where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_count = row_count; v_affected := v_affected + v_count;
    if not exists (select 1 from public.delivery_events where organization_id = p_organization_id)
      and not exists (select 1 from public.inbound_events where organization_id = p_organization_id) then
      update public.organization_purge_jobs set current_phase = 'messages' where id = v_job.id;
    end if;
  elsif v_job.current_phase = 'messages' then
    delete from public.messages where id in (
      select id from public.messages where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_affected = row_count;
    delete from public.message_drafts where id in (
      select id from public.message_drafts where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_count = row_count; v_affected := v_affected + v_count;
    if not exists (select 1 from public.messages where organization_id = p_organization_id)
      and not exists (select 1 from public.message_drafts where organization_id = p_organization_id) then
      update public.organization_purge_jobs set current_phase = 'crm' where id = v_job.id;
    end if;
  elsif v_job.current_phase = 'crm' then
    delete from public.score_history where id in (
      select id from public.score_history where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_affected = row_count;
    delete from public.lead_scores where id in (
      select id from public.lead_scores where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_count = row_count; v_affected := v_affected + v_count;
    delete from public.assignment_history where id in (
      select id from public.assignment_history where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_count = row_count; v_affected := v_affected + v_count;
    if not exists (select 1 from public.score_history where organization_id = p_organization_id)
      and not exists (select 1 from public.lead_scores where organization_id = p_organization_id)
      and not exists (select 1 from public.assignment_history where organization_id = p_organization_id) then
      update public.organization_purge_jobs set current_phase = 'tasks' where id = v_job.id;
    end if;
  elsif v_job.current_phase = 'tasks' then
    delete from public.activities where id in (
      select id from public.activities where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_affected = row_count;
    delete from public.follow_up_tasks where id in (
      select id from public.follow_up_tasks where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_count = row_count; v_affected := v_affected + v_count;
    if not exists (select 1 from public.activities where organization_id = p_organization_id)
      and not exists (select 1 from public.follow_up_tasks where organization_id = p_organization_id) then
      update public.organization_purge_jobs set current_phase = 'channels' where id = v_job.id;
    end if;
  elsif v_job.current_phase = 'channels' then
    delete from public.contact_channel_identities where id in (
      select id from public.contact_channel_identities where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_affected = row_count;
    delete from public.organization_member_channel_identities where id in (
      select id from public.organization_member_channel_identities where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_count = row_count; v_affected := v_affected + v_count;
    delete from public.channel_connections where id in (
      select id from public.channel_connections where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_count = row_count; v_affected := v_affected + v_count;
    delete from public.lead_source_connections where id in (
      select id from public.lead_source_connections where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_count = row_count; v_affected := v_affected + v_count;
    if not exists (select 1 from public.contact_channel_identities where organization_id = p_organization_id)
      and not exists (select 1 from public.organization_member_channel_identities where organization_id = p_organization_id)
      and not exists (select 1 from public.channel_connections where organization_id = p_organization_id)
      and not exists (select 1 from public.lead_source_connections where organization_id = p_organization_id) then
      delete from public.opportunities where organization_id = p_organization_id;
      delete from public.leads where organization_id = p_organization_id;
      delete from public.contacts where organization_id = p_organization_id;
      delete from public.accounts where organization_id = p_organization_id;
      update public.organization_purge_jobs set current_phase = 'automation' where id = v_job.id;
    end if;
  elsif v_job.current_phase = 'automation' then
    delete from public.automation_runs where id in (
      select id from public.automation_runs where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_affected = row_count;
    delete from public.audit_logs where id in (
      select id from public.audit_logs where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_count = row_count; v_affected := v_affected + v_count;
    delete from public.command_executions where id in (
      select id from public.command_executions where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_count = row_count; v_affected := v_affected + v_count;
    delete from public.outbox_events where id in (
      select id from public.outbox_events where organization_id = p_organization_id limit p_batch_size
    ); get diagnostics v_count = row_count; v_affected := v_affected + v_count;
    if not exists (select 1 from public.automation_runs where organization_id = p_organization_id)
      and not exists (select 1 from public.audit_logs where organization_id = p_organization_id)
      and not exists (select 1 from public.command_executions where organization_id = p_organization_id)
      and not exists (select 1 from public.outbox_events where organization_id = p_organization_id) then
      update public.organization_purge_jobs set current_phase = 'members' where id = v_job.id;
    end if;
  elsif v_job.current_phase = 'members' then
    select array_agg(target.user_id) into v_user_ids
    from public.organization_members target
    where target.organization_id = p_organization_id
      and not exists (
        select 1
        from public.organization_members other
        where other.user_id = target.user_id
          and other.organization_id <> p_organization_id
      );
    delete from public.organization_members where organization_id = p_organization_id;
    delete from public.profiles p where p.id = any(coalesce(v_user_ids, '{}'::uuid[]))
      and not exists (select 1 from public.organization_members m where m.user_id = p.id);
    update public.organization_purge_jobs set current_phase = 'settings', cursor = jsonb_build_object('auth_user_ids', coalesce(to_jsonb(v_user_ids), '[]'::jsonb))
    where id = v_job.id;
  elsif v_job.current_phase = 'settings' then
    if not p_auth_users_cleared then
      return jsonb_build_object(
        'status', 'waiting_auth_cleanup',
        'phase', 'settings',
        'auth_user_ids', coalesce(v_job.cursor -> 'auth_user_ids', '[]'::jsonb)
      );
    end if;
    delete from public.organization_scoring_profiles where organization_id = p_organization_id;
    delete from public.organization_assignment_settings where organization_id = p_organization_id;
    delete from public.pipeline_stages where organization_id = p_organization_id;
    v_org_hash := encode(extensions.digest(convert_to(v_org.id::text, 'UTF8'), 'sha256'), 'hex');
    v_name_hash := encode(extensions.digest(convert_to(v_org.name, 'UTF8'), 'sha256'), 'hex');
    v_audit_hash := encode(extensions.digest(convert_to(v_job.id::text, 'UTF8'), 'sha256'), 'hex');
    v_report := jsonb_build_object('purge_job_id', v_job.id, 'completed_at', now(), 'phases',
      jsonb_build_array('storage', 'inbound', 'messages', 'crm', 'tasks', 'channels', 'automation', 'members', 'settings'));
    insert into public.organization_tombstones (
      organization_id_hash, organization_name_hash, requested_at, purged_at, status, audit_reference_hash, purge_report_hash
    ) values (
      v_org_hash, v_name_hash, v_org.deletion_requested_at, now(), 'deleted', v_audit_hash,
      encode(extensions.digest(convert_to(v_report::text, 'UTF8'), 'sha256'), 'hex')
    );
    delete from public.organization_purge_jobs where id = v_job.id;
    delete from public.organizations where id = p_organization_id;
    return jsonb_build_object('status', 'completed', 'organization_id_hash', v_org_hash, 'purge_report', v_report);
  end if;

  select * into v_job from public.organization_purge_jobs where id = v_job.id;
  return jsonb_build_object('status', 'running', 'phase', v_job.current_phase, 'affected_rows', v_affected);
end;
$$;

create or replace view public.follow_ups
with (security_invoker = true)
as
select
  a.id,
  a.organization_id,
  a.lead_id,
  l.public_id as lead_request_id,
  l.public_id as request_id,
  c.full_name as customer_name,
  c.phone,
  p.display_name as assigned_to,
  a.occurred_at as follow_up_date,
  a.activity_type as status,
  a.notes,
  a.created_at
from public.activities a
left join public.leads l on l.organization_id = a.organization_id and l.id = a.lead_id
left join public.contacts c on c.organization_id = a.organization_id and c.id = coalesce(a.contact_id, l.contact_id)
left join public.organization_members m on m.organization_id = a.organization_id and m.id = a.owner_member_id
left join public.profiles p on p.id = m.user_id
where a.activity_type in ('mark_contacted', 'record_outcome', 'mark_manual_message_sent');

create or replace view public.salespeople_compat
with (security_invoker = true)
as
select
  m.id,
  m.organization_id,
  m.user_id,
  p.display_name as name,
  p.phone,
  m.status = 'active' as is_active,
  m.accepts_assignments,
  m.is_away,
  m.last_assigned_at,
  m.created_at,
  m.updated_at
from public.organization_members m
join public.profiles p on p.id = m.user_id
where m.role = 'sales';

create or replace view public.leads_compat
with (security_invoker = true)
as
select
  l.id,
  l.organization_id,
  l.public_id as request_id,
  c.full_name as customer_name,
  c.phone,
  c.email,
  a.name as company,
  a.industry,
  ls.priority_level as priority,
  p.display_name as assigned_to,
  l.status::text as status,
  l.status::text as pipeline_stage,
  next_task.due_at as next_follow_up_at,
  l.notes,
  l.created_at,
  l.updated_at,
  l.version
from public.leads l
join public.contacts c on c.organization_id = l.organization_id and c.id = l.contact_id
left join public.accounts a on a.organization_id = l.organization_id and a.id = l.account_id
left join public.organization_members m on m.organization_id = l.organization_id and m.id = l.owner_member_id
left join public.profiles p on p.id = m.user_id
left join lateral (
  select s.priority_level from public.lead_scores s
  where s.organization_id = l.organization_id and s.lead_id = l.id order by s.scored_at desc limit 1
) ls on true
left join lateral (
  select t.due_at from public.follow_up_tasks t
  where t.organization_id = l.organization_id and t.lead_id = l.id and t.status in ('open', 'snoozed')
  order by t.due_at limit 1
) next_task on true;

revoke all on schema crm from public, anon, authenticated;
grant usage on schema crm to service_role;
grant usage on schema public to authenticated, service_role;
grant usage on type
  public.organization_status, public.organization_role, public.member_status,
  public.contact_status, public.lead_status, public.opportunity_status, public.task_status,
  public.assignment_strategy, public.assignment_reason, public.provider_code,
  public.connection_status, public.message_direction, public.message_draft_status,
  public.message_status, public.manual_channel, public.message_outcome,
  public.inbound_event_status, public.command_status, public.outbox_status,
  public.automation_run_status, public.score_status, public.priority_level,
  public.purge_job_status
to authenticated, service_role;
grant all on all tables in schema public to service_role;
grant select on public.follow_ups, public.salespeople_compat, public.leads_compat to authenticated;
revoke all on all functions in schema crm from public, anon, authenticated;
grant execute on all functions in schema crm to service_role;



create or replace function crm.calculate_standard_v1_score(p_dimensions jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_weight numeric;
  v_score numeric;
  v_status text;
  v_raw numeric := 0;
  v_known numeric := 0;
  v_normalized numeric;
  v_priority text;
  v_weights constant jsonb := '{"need_clarity":20,"budget_fit":20,"decision_authority":15,"urgency":15,"customer_fit":15,"engagement":15}'::jsonb;
begin
  if jsonb_typeof(p_dimensions) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  for v_key, v_weight in select key, value::text::numeric from jsonb_each(v_weights)
  loop
    if not (p_dimensions ? v_key) then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    v_status := p_dimensions #>> array[v_key, 'status'];
    if v_status not in ('known', 'unknown') then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    if v_status = 'known' then
      v_score := (p_dimensions #>> array[v_key, 'score'])::numeric;
      if v_score is null or v_score < 0 or v_score > v_weight then
        raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
      end if;
      v_raw := v_raw + v_score;
      v_known := v_known + v_weight;
    elsif (p_dimensions #>> array[v_key, 'score']) is not null then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
  end loop;

  v_normalized := case when v_known = 0 then null else round(v_raw / v_known * 100, 2) end;
  v_priority := case
    when v_normalized is null then null
    when v_normalized >= 80 then 'high'
    when v_normalized >= 60 then 'medium_high'
    when v_normalized >= 40 then 'medium'
    else 'low'
  end;

  return jsonb_build_object(
    'raw_known_score', v_raw,
    'known_weight', v_known,
    'normalized_score', v_normalized,
    'total_score', v_normalized,
    'coverage', round(v_known / 100, 4),
    'priority_level', v_priority
  );
end;
$$;

create or replace function crm.derive_standard_v1_dimensions(
  p_evidence jsonb,
  p_lead_id uuid,
  p_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_account public.accounts%rowtype;
  v_profile public.organization_scoring_profiles%rowtype;
  v_dimension jsonb;
  v_dimensions jsonb := '{}'::jsonb;
  v_status text;
  v_level text;
  v_candidate text;
  v_budget numeric;
  v_timeframe_days numeric;
  v_score numeric;
  v_fit_checks integer := 0;
  v_fit_matches integer := 0;
  v_disqualified boolean := false;
begin
  if jsonb_typeof(p_evidence) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  select * into v_profile from public.organization_scoring_profiles
  where id = p_profile_id and organization_id = v_lead.organization_id and status = 'active';
  if not found then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
  if v_lead.account_id is not null then
    select * into v_account from public.accounts
    where id = v_lead.account_id and organization_id = v_lead.organization_id;
  end if;

  -- Need clarity is derived from an extracted category. AI-provided numeric scores are ignored.
  v_dimension := coalesce(p_evidence -> 'need_clarity', '{"status":"unknown"}'::jsonb);
  v_status := coalesce(v_dimension ->> 'status', 'unknown');
  v_level := lower(nullif(btrim(v_dimension ->> 'level'), ''));
  if jsonb_typeof(v_dimension) <> 'object' or v_status not in ('known', 'unknown') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if v_status = 'known' and v_level in ('detailed', 'defined', 'vague') then
    v_score := case v_level when 'detailed' then 20 when 'defined' then 14 else 7 end;
    v_dimensions := v_dimensions || jsonb_build_object('need_clarity', jsonb_build_object(
      'status', 'known', 'score', v_score, 'evidence', v_dimension -> 'evidence',
      'facts', jsonb_build_object('level', v_level), 'rule', 'need_clarity_level_v1'
    ));
  else
    v_dimensions := v_dimensions || jsonb_build_object('need_clarity', jsonb_build_object(
      'status', 'unknown', 'score', null, 'evidence', v_dimension -> 'evidence', 'rule', 'unknown_not_scored'
    ));
  end if;

  -- Budget fit uses the structured lead amount when present and the active organization profile.
  v_dimension := coalesce(p_evidence -> 'budget_fit', '{"status":"unknown"}'::jsonb);
  v_status := coalesce(v_dimension ->> 'status', 'unknown');
  if jsonb_typeof(v_dimension) <> 'object' or v_status not in ('known', 'unknown') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  v_budget := v_lead.budget_amount;
  if jsonb_typeof(v_dimension -> 'amount') = 'number' then
    v_budget := (v_dimension ->> 'amount')::numeric;
  end if;
  if v_budget is not null and v_budget >= 0 then
    v_score := case
      when v_profile.minimum_viable_budget is not null and v_budget < v_profile.minimum_viable_budget then 0
      when (v_profile.target_budget_min is null or v_budget >= v_profile.target_budget_min)
       and (v_profile.target_budget_max is null or v_budget <= v_profile.target_budget_max)
       and (v_profile.target_budget_min is not null or v_profile.target_budget_max is not null) then 20
      when v_profile.minimum_viable_budget is not null
        or v_profile.target_budget_min is not null
        or v_profile.target_budget_max is not null then 12
      else 10
    end;
    v_dimensions := v_dimensions || jsonb_build_object('budget_fit', jsonb_build_object(
      'status', 'known', 'score', v_score, 'evidence', v_dimension -> 'evidence',
      'facts', jsonb_build_object('amount', v_budget, 'currency', v_profile.currency),
      'rule', 'organization_budget_profile_v1'
    ));
  else
    v_dimensions := v_dimensions || jsonb_build_object('budget_fit', jsonb_build_object(
      'status', 'unknown', 'score', null, 'evidence', v_dimension -> 'evidence', 'rule', 'unknown_not_scored'
    ));
  end if;

  v_dimension := coalesce(p_evidence -> 'decision_authority', '{"status":"unknown"}'::jsonb);
  v_status := coalesce(v_dimension ->> 'status', 'unknown');
  v_level := lower(nullif(btrim(v_dimension ->> 'level'), ''));
  if jsonb_typeof(v_dimension) <> 'object' or v_status not in ('known', 'unknown') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if v_status = 'known' and v_level in ('decision_maker', 'recommender', 'influencer', 'other') then
    v_score := case v_level when 'decision_maker' then 15 when 'recommender' then 10 when 'influencer' then 6 else 3 end;
    v_dimensions := v_dimensions || jsonb_build_object('decision_authority', jsonb_build_object(
      'status', 'known', 'score', v_score, 'evidence', v_dimension -> 'evidence',
      'facts', jsonb_strip_nulls(jsonb_build_object('level', v_level, 'role', nullif(v_dimension ->> 'role', ''))),
      'rule', 'decision_authority_level_v1'
    ));
  else
    v_dimensions := v_dimensions || jsonb_build_object('decision_authority', jsonb_build_object(
      'status', 'unknown', 'score', null, 'evidence', v_dimension -> 'evidence', 'rule', 'unknown_not_scored'
    ));
  end if;

  v_dimension := coalesce(p_evidence -> 'urgency', '{"status":"unknown"}'::jsonb);
  v_status := coalesce(v_dimension ->> 'status', 'unknown');
  v_level := lower(coalesce(nullif(btrim(v_dimension ->> 'level'), ''), nullif(btrim(v_lead.urgency), '')));
  if jsonb_typeof(v_dimension) <> 'object' or v_status not in ('known', 'unknown') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  v_timeframe_days := null;
  if jsonb_typeof(v_dimension -> 'timeframe_days') = 'number' then
    v_timeframe_days := (v_dimension ->> 'timeframe_days')::numeric;
  end if;
  if v_timeframe_days is not null and v_timeframe_days >= 0 then
    v_score := case when v_timeframe_days <= 7 then 15 when v_timeframe_days <= 30 then 12 when v_timeframe_days <= 90 then 8 else 4 end;
    v_status := 'known';
  elsif v_status = 'known' and v_level in ('immediate', 'high', 'medium', 'low') then
    v_score := case v_level when 'immediate' then 15 when 'high' then 12 when 'medium' then 8 else 4 end;
  else
    v_status := 'unknown';
  end if;
  if v_status = 'known' then
    v_dimensions := v_dimensions || jsonb_build_object('urgency', jsonb_build_object(
      'status', 'known', 'score', v_score, 'evidence', v_dimension -> 'evidence',
      'facts', jsonb_strip_nulls(jsonb_build_object('timeframe_days', v_timeframe_days, 'level', v_level)),
      'rule', 'urgency_timeframe_v1'
    ));
  else
    v_dimensions := v_dimensions || jsonb_build_object('urgency', jsonb_build_object(
      'status', 'unknown', 'score', null, 'evidence', v_dimension -> 'evidence', 'rule', 'unknown_not_scored'
    ));
  end if;

  -- Customer fit compares extracted/CRM facts with the versioned organization ICP profile.
  v_dimension := coalesce(p_evidence -> 'customer_fit', '{"status":"unknown"}'::jsonb);
  v_status := coalesce(v_dimension ->> 'status', 'unknown');
  if jsonb_typeof(v_dimension) <> 'object' or v_status not in ('known', 'unknown')
    or (v_dimension ? 'signals' and jsonb_typeof(v_dimension -> 'signals') <> 'array')
    or (v_dimension ? 'excluded_signal' and jsonb_typeof(v_dimension -> 'excluded_signal') <> 'boolean')
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  v_disqualified := coalesce((v_dimension ->> 'excluded_signal')::boolean, false);
  if not v_disqualified and cardinality(v_profile.disqualifying_signals) > 0 and v_dimension ? 'signals' then
    select exists (
      select 1
      from jsonb_array_elements_text(v_dimension -> 'signals') extracted(signal)
      join unnest(v_profile.disqualifying_signals) blocked(signal)
        on lower(btrim(extracted.signal)) = lower(btrim(blocked.signal))
    ) into v_disqualified;
  end if;

  v_candidate := coalesce(nullif(v_dimension ->> 'industry', ''), v_account.industry);
  if cardinality(v_profile.target_industries) > 0 and v_candidate is not null then
    v_fit_checks := v_fit_checks + 1;
    if exists (select 1 from unnest(v_profile.target_industries) value where lower(btrim(value)) = lower(btrim(v_candidate))) then v_fit_matches := v_fit_matches + 1; end if;
  end if;
  v_candidate := coalesce(nullif(v_dimension ->> 'company_size', ''), v_account.company_size);
  if cardinality(v_profile.target_company_sizes) > 0 and v_candidate is not null then
    v_fit_checks := v_fit_checks + 1;
    if exists (select 1 from unnest(v_profile.target_company_sizes) value where lower(btrim(value)) = lower(btrim(v_candidate))) then v_fit_matches := v_fit_matches + 1; end if;
  end if;
  v_candidate := coalesce(nullif(v_dimension ->> 'region', ''), v_account.region);
  if cardinality(v_profile.target_regions) > 0 and v_candidate is not null then
    v_fit_checks := v_fit_checks + 1;
    if exists (select 1 from unnest(v_profile.target_regions) value where lower(btrim(value)) = lower(btrim(v_candidate))) then v_fit_matches := v_fit_matches + 1; end if;
  end if;
  v_candidate := nullif(v_dimension ->> 'use_case', '');
  if cardinality(v_profile.target_use_cases) > 0 and v_candidate is not null then
    v_fit_checks := v_fit_checks + 1;
    if exists (select 1 from unnest(v_profile.target_use_cases) value where lower(btrim(value)) = lower(btrim(v_candidate))) then v_fit_matches := v_fit_matches + 1; end if;
  end if;
  v_candidate := nullif(v_dimension ->> 'buyer_role', '');
  if cardinality(v_profile.target_buyer_roles) > 0 and v_candidate is not null then
    v_fit_checks := v_fit_checks + 1;
    if exists (select 1 from unnest(v_profile.target_buyer_roles) value where lower(btrim(value)) = lower(btrim(v_candidate))) then v_fit_matches := v_fit_matches + 1; end if;
  end if;

  if v_disqualified then
    v_status := 'known';
    v_score := 0;
  elsif v_fit_checks > 0 then
    v_status := 'known';
    v_score := round(15::numeric * v_fit_matches / v_fit_checks, 2);
  elsif v_status = 'known' and coalesce(
    nullif(v_dimension ->> 'industry', ''), nullif(v_dimension ->> 'company_size', ''),
    nullif(v_dimension ->> 'region', ''), nullif(v_dimension ->> 'use_case', ''),
    nullif(v_dimension ->> 'buyer_role', ''), v_account.industry, v_account.company_size, v_account.region
  ) is not null then
    v_score := 8;
  else
    v_status := 'unknown';
  end if;
  if v_status = 'known' then
    v_dimensions := v_dimensions || jsonb_build_object('customer_fit', jsonb_build_object(
      'status', 'known', 'score', v_score, 'evidence', v_dimension -> 'evidence',
      'facts', jsonb_strip_nulls(jsonb_build_object(
        'industry', coalesce(nullif(v_dimension ->> 'industry', ''), v_account.industry),
        'company_size', coalesce(nullif(v_dimension ->> 'company_size', ''), v_account.company_size),
        'region', coalesce(nullif(v_dimension ->> 'region', ''), v_account.region),
        'use_case', nullif(v_dimension ->> 'use_case', ''), 'buyer_role', nullif(v_dimension ->> 'buyer_role', ''),
        'excluded_signal', v_disqualified
      )), 'rule', 'organization_icp_profile_v1'
    ));
  else
    v_dimensions := v_dimensions || jsonb_build_object('customer_fit', jsonb_build_object(
      'status', 'unknown', 'score', null, 'evidence', v_dimension -> 'evidence', 'rule', 'unknown_not_scored'
    ));
  end if;

  v_dimension := coalesce(p_evidence -> 'engagement', '{"status":"unknown"}'::jsonb);
  v_status := coalesce(v_dimension ->> 'status', 'unknown');
  v_level := lower(nullif(btrim(v_dimension ->> 'level'), ''));
  if jsonb_typeof(v_dimension) <> 'object' or v_status not in ('known', 'unknown') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if v_status = 'known' and v_level in ('high', 'medium', 'low') then
    v_score := case v_level when 'high' then 15 when 'medium' then 10 else 5 end;
    v_dimensions := v_dimensions || jsonb_build_object('engagement', jsonb_build_object(
      'status', 'known', 'score', v_score, 'evidence', v_dimension -> 'evidence',
      'facts', jsonb_build_object('level', v_level), 'rule', 'engagement_level_v1'
    ));
  else
    v_dimensions := v_dimensions || jsonb_build_object('engagement', jsonb_build_object(
      'status', 'unknown', 'score', null, 'evidence', v_dimension -> 'evidence', 'rule', 'unknown_not_scored'
    ));
  end if;

  return v_dimensions;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
end;
$$;

create or replace function crm.execute_command(p_envelope jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command_id uuid;
  v_idempotency_key text;
  v_command_name text;
  v_organization_id uuid;
  v_actor_user_id uuid;
  v_target_type text;
  v_target_id uuid;
  v_expected_version bigint;
  v_source text;
  v_occurred_at timestamptz;
  v_payload jsonb;
  v_hash text;
  v_existing public.command_executions%rowtype;
  v_execution_id uuid;
  v_actor public.organization_members%rowtype;
  v_org public.organizations%rowtype;
  v_result jsonb := '{}'::jsonb;
  v_result_version bigint;
  v_outbox_id uuid;
  v_activity_id uuid;
  v_audit_id uuid;
  v_contact_id uuid;
  v_lead_id uuid;
  v_opportunity_id uuid;
  v_owner_member_id uuid;
  v_candidate_id uuid;
  v_from_member_id uuid;
  v_task_id uuid;
  v_message_id uuid;
  v_draft_id uuid;
  v_profile_id uuid;
  v_stage_id uuid;
  v_settings public.organization_assignment_settings%rowtype;
  v_draft public.message_drafts%rowtype;
  v_score jsonb;
  v_dimensions jsonb;
  v_outcome public.message_outcome;
  v_next_due_at timestamptz;
begin
  perform crm.require_service_role();

  begin
    v_command_id := (p_envelope ->> 'command_id')::uuid;
    v_idempotency_key := nullif(btrim(p_envelope ->> 'idempotency_key'), '');
    v_command_name := nullif(btrim(p_envelope ->> 'command_name'), '');
    v_organization_id := (p_envelope ->> 'organization_id')::uuid;
    v_actor_user_id := (p_envelope ->> 'actor_user_id')::uuid;
    v_target_type := nullif(btrim(p_envelope ->> 'target_type'), '');
    v_target_id := nullif(p_envelope ->> 'target_id', '')::uuid;
    v_expected_version := nullif(p_envelope ->> 'expected_version', '')::bigint;
    v_source := nullif(btrim(p_envelope ->> 'source'), '');
    v_occurred_at := coalesce(nullif(p_envelope ->> 'occurred_at', '')::timestamptz, now());
    v_payload := coalesce(p_envelope -> 'payload', '{}'::jsonb);
  exception when others then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end;

  if v_command_id is null or v_idempotency_key is null or v_command_name is null
    or v_organization_id is null or v_actor_user_id is null or v_target_type is null
    or v_source not in ('crm', 'feishu', 'n8n', 'system')
    or jsonb_typeof(v_payload) <> 'object'
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  if v_command_name <> all (array[
    'accept_lead', 'acknowledge_lead', 'assign_lead', 'reassign_lead', 'mark_contacted',
    'record_outcome', 'schedule_follow_up', 'snooze_follow_up', 'create_message_draft', 'update_message_draft',
    'regenerate_message_draft', 'approve_message_draft', 'reject_message_draft',
    'mark_manual_message_sent', 'convert_lead', 'change_opportunity_stage',
    'mark_opportunity_won', 'mark_lead_invalid', 'update_assignment_settings',
    'create_scoring_profile_version', 'record_lead_score', 'transfer_organization_owner',
    'request_organization_deletion', 'cancel_organization_deletion'
  ]) then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  select * into v_org from public.organizations where id = v_organization_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  if v_org.status <> 'active' and v_command_name <> 'cancel_organization_deletion' then
    raise exception using errcode = '55000', message = 'ORGANIZATION_INACTIVE';
  end if;

  select * into v_actor
  from public.organization_members
  where organization_id = v_organization_id and user_id = v_actor_user_id and status = 'active'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  v_hash := encode(extensions.digest(convert_to(p_envelope::text, 'UTF8'), 'sha256'), 'hex');
  select * into v_existing
  from public.command_executions
  where organization_id = v_organization_id and idempotency_key = v_idempotency_key
  for update;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    if v_existing.status = 'succeeded' then
      return v_existing.response;
    end if;
    raise exception using errcode = '55000', message = 'IDEMPOTENCY_CONFLICT';
  end if;

  insert into public.command_executions (
    command_id, organization_id, idempotency_key, command_name, actor_user_id,
    actor_member_id, target_type, target_id, expected_version, source, occurred_at,
    request_hash, request_payload
  ) values (
    v_command_id, v_organization_id, v_idempotency_key, v_command_name, v_actor_user_id,
    v_actor.id, v_target_type, v_target_id, v_expected_version, v_source, v_occurred_at,
    v_hash, p_envelope
  ) returning id into v_execution_id;

  perform crm.assert_expected_version(v_organization_id, v_target_type, v_target_id, v_expected_version);

  if v_command_name in ('accept_lead', 'acknowledge_lead') then
    select l.contact_id, l.owner_member_id into v_contact_id, v_owner_member_id
    from public.leads l where l.organization_id = v_organization_id and l.id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_actor.role = 'sales' and v_owner_member_id is not null and v_owner_member_id <> v_actor.id then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    update public.leads
    set owner_member_id = coalesce(owner_member_id, v_actor.id),
        status = case when status = 'new' then 'working' else status end,
        acknowledged_at = case when v_command_name = 'acknowledge_lead' then now() else acknowledged_at end,
        accepted_at = case when v_command_name = 'accept_lead' then now() else accepted_at end
    where organization_id = v_organization_id and id = v_target_id
    returning version, owner_member_id into v_result_version, v_owner_member_id;
    v_lead_id := v_target_id;
    v_result := jsonb_build_object('lead_id', v_target_id, 'owner_member_id', v_owner_member_id, 'version', v_result_version);

  elsif v_command_name in ('assign_lead', 'reassign_lead') then
    if v_actor.role not in ('owner', 'admin', 'manager') then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    select l.contact_id, l.owner_member_id into v_contact_id, v_from_member_id
    from public.leads l where l.organization_id = v_organization_id and l.id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    v_candidate_id := nullif(v_payload ->> 'member_id', '')::uuid;
    if v_candidate_id is null and v_command_name = 'assign_lead' then
      v_candidate_id := crm.select_assignment_candidate(v_organization_id);
    end if;
    if v_candidate_id is not null and not exists (
      select 1 from public.organization_members m
      where m.organization_id = v_organization_id and m.id = v_candidate_id
        and m.role = 'sales' and m.status = 'active'
    ) then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    update public.leads set owner_member_id = v_candidate_id, status = case when v_candidate_id is null then status else 'working' end
    where organization_id = v_organization_id and id = v_target_id
    returning version into v_result_version;
    insert into public.assignment_history (
      organization_id, lead_id, from_member_id, to_member_id, reason, reason_notes, assigned_by_member_id
    ) values (
      v_organization_id, v_target_id, v_from_member_id, v_candidate_id,
      case when v_command_name = 'reassign_lead' then 'reassignment'::public.assignment_reason
           when v_candidate_id is null then 'fallback'::public.assignment_reason
           else 'automatic'::public.assignment_reason end,
      nullif(v_payload ->> 'reason', ''), v_actor.id
    );
    if v_candidate_id is not null then
      update public.organization_members set last_assigned_at = now()
      where organization_id = v_organization_id and id = v_candidate_id;
      select * into v_settings from public.organization_assignment_settings where organization_id = v_organization_id;
      insert into public.follow_up_tasks (
        organization_id, contact_id, lead_id, assignee_member_id, created_by_member_id, title, due_at
      ) values (
        v_organization_id, v_contact_id, v_target_id, v_candidate_id, v_actor.id,
        '首次联系客户', now() + make_interval(mins => coalesce(v_settings.first_response_sla_minutes, 60))
      ) returning id into v_task_id;
    end if;
    v_lead_id := v_target_id;
    v_owner_member_id := v_candidate_id;
    v_result := jsonb_build_object(
      'lead_id', v_target_id, 'owner_member_id', v_candidate_id, 'task_id', v_task_id,
      'assignment_status', case when v_candidate_id is null then 'unassigned' else 'assigned' end,
      'version', v_result_version
    );

  elsif v_command_name = 'mark_contacted' then
    select l.contact_id, l.owner_member_id into v_contact_id, v_owner_member_id
    from public.leads l where l.organization_id = v_organization_id and l.id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_actor.role = 'sales' and v_owner_member_id <> v_actor.id then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    update public.leads set last_contacted_at = coalesce(nullif(v_payload ->> 'contacted_at', '')::timestamptz, now()), status = 'working'
    where organization_id = v_organization_id and id = v_target_id returning version into v_result_version;
    v_lead_id := v_target_id;
    v_result := jsonb_build_object('lead_id', v_target_id, 'version', v_result_version);

  elsif v_command_name = 'record_outcome' then
    v_outcome := (v_payload ->> 'outcome')::public.message_outcome;
    select l.contact_id, l.owner_member_id into v_contact_id, v_owner_member_id
    from public.leads l where l.organization_id = v_organization_id and l.id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_actor.role = 'sales' and v_owner_member_id <> v_actor.id then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    if v_outcome in ('no_reply', 'replied', 'interested') and nullif(v_payload ->> 'next_follow_up_at', '') is null then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    if v_outcome in ('not_interested', 'converted', 'invalid') then
      update public.follow_up_tasks set status = 'cancelled', cancelled_at = now(), outcome = v_outcome
      where organization_id = v_organization_id and lead_id = v_target_id and status in ('open', 'snoozed');
    else
      v_next_due_at := (v_payload ->> 'next_follow_up_at')::timestamptz;
      insert into public.follow_up_tasks (
        organization_id, contact_id, lead_id, assignee_member_id, created_by_member_id, title, notes, due_at
      ) values (
        v_organization_id, v_contact_id, v_target_id, v_owner_member_id, v_actor.id,
        '客户跟进', nullif(v_payload ->> 'notes', ''), v_next_due_at
      ) returning id into v_task_id;
    end if;
    update public.leads set
      status = case when v_outcome = 'not_interested' then 'disqualified'::public.lead_status
                    when v_outcome = 'invalid' then 'archived'::public.lead_status else status end,
      invalid_reason = case when v_outcome = 'invalid' then coalesce(nullif(v_payload ->> 'notes', ''), 'manual_outcome') else invalid_reason end
    where organization_id = v_organization_id and id = v_target_id returning version into v_result_version;
    v_lead_id := v_target_id;
    v_result := jsonb_build_object('lead_id', v_target_id, 'outcome', v_outcome, 'next_task_id', v_task_id, 'version', v_result_version);

  elsif v_command_name = 'schedule_follow_up' then
    select l.contact_id, l.owner_member_id into v_contact_id, v_owner_member_id
    from public.leads l where l.organization_id = v_organization_id and l.id = v_target_id;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_actor.role = 'sales' and v_owner_member_id <> v_actor.id then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    v_next_due_at := (v_payload ->> 'due_at')::timestamptz;
    if v_next_due_at is null or v_next_due_at <= now() then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
    insert into public.follow_up_tasks (
      organization_id, contact_id, lead_id, assignee_member_id, created_by_member_id, title, notes, due_at
    ) values (
      v_organization_id, v_contact_id, v_target_id, coalesce(nullif(v_payload ->> 'assignee_member_id', '')::uuid, v_owner_member_id),
      v_actor.id, coalesce(nullif(v_payload ->> 'title', ''), '客户跟进'), nullif(v_payload ->> 'notes', ''), v_next_due_at
    ) returning id, version into v_task_id, v_result_version;
    v_lead_id := v_target_id;
    v_result := jsonb_build_object('task_id', v_task_id, 'version', v_result_version);

  elsif v_command_name = 'snooze_follow_up' then
    select t.contact_id, t.lead_id, t.opportunity_id, t.assignee_member_id
      into v_contact_id, v_lead_id, v_opportunity_id, v_owner_member_id
    from public.follow_up_tasks t where t.organization_id = v_organization_id and t.id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_actor.role = 'sales' and v_owner_member_id <> v_actor.id then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    v_next_due_at := (v_payload ->> 'snoozed_until')::timestamptz;
    if v_next_due_at is null or v_next_due_at <= now() then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
    update public.follow_up_tasks set status = 'snoozed', snoozed_until = v_next_due_at, due_at = v_next_due_at
    where organization_id = v_organization_id and id = v_target_id returning version into v_result_version;
    v_result := jsonb_build_object('task_id', v_target_id, 'version', v_result_version);

  elsif v_command_name = 'create_message_draft' then
    select l.contact_id, l.owner_member_id into v_contact_id, v_owner_member_id
    from public.leads l where l.organization_id = v_organization_id and l.id = v_target_id;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_actor.role = 'sales' and v_owner_member_id <> v_actor.id then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    if nullif(btrim(v_payload ->> 'content'), '') is null then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
    insert into public.message_drafts (
      organization_id, contact_id, lead_id, owner_member_id, created_by_member_id, provider, status, content,
      ai_provider, ai_model, prompt_version, input_tokens, output_tokens, latency_ms
    ) values (
      v_organization_id, v_contact_id, v_target_id, v_owner_member_id, v_actor.id, 'manual',
      case when coalesce((v_payload ->> 'requires_approval')::boolean, false) then 'pending_approval'::public.message_draft_status else 'draft'::public.message_draft_status end,
      v_payload ->> 'content', nullif(v_payload ->> 'ai_provider', ''), nullif(v_payload ->> 'ai_model', ''),
      nullif(v_payload ->> 'prompt_version', ''), nullif(v_payload ->> 'input_tokens', '')::integer,
      nullif(v_payload ->> 'output_tokens', '')::integer, nullif(v_payload ->> 'latency_ms', '')::integer
    ) returning id, version into v_draft_id, v_result_version;
    v_lead_id := (p_envelope ->> 'target_id')::uuid;
    v_result := jsonb_build_object('message_draft_id', v_draft_id, 'version', v_result_version);

  elsif v_command_name = 'update_message_draft' then
    select * into v_draft from public.message_drafts where organization_id = v_organization_id and id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_actor.role = 'sales' and v_draft.owner_member_id <> v_actor.id then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    if v_draft.status in ('sent', 'cancelled') or nullif(btrim(v_payload ->> 'content'), '') is null then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
    update public.message_drafts set content = v_payload ->> 'content',
      status = case when coalesce((v_payload ->> 'requires_approval')::boolean, false)
        then 'pending_approval'::public.message_draft_status else 'draft'::public.message_draft_status end,
      approved_by_member_id = null,
      approved_at = null, rejected_at = null, rejection_reason = null, ai_provider = nullif(v_payload ->> 'ai_provider', ''),
      ai_model = nullif(v_payload ->> 'ai_model', ''), prompt_version = nullif(v_payload ->> 'prompt_version', ''),
      input_tokens = nullif(v_payload ->> 'input_tokens', '')::integer, output_tokens = nullif(v_payload ->> 'output_tokens', '')::integer,
      latency_ms = nullif(v_payload ->> 'latency_ms', '')::integer
    where organization_id = v_organization_id and id = v_target_id returning version into v_result_version;
    v_contact_id := v_draft.contact_id; v_lead_id := v_draft.lead_id; v_opportunity_id := v_draft.opportunity_id; v_owner_member_id := v_draft.owner_member_id;
    v_result := jsonb_build_object('message_draft_id', v_target_id, 'lead_id', v_lead_id, 'version', v_result_version);

  elsif v_command_name = 'regenerate_message_draft' then
    select * into v_draft from public.message_drafts where organization_id = v_organization_id and id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_actor.role = 'sales' and v_draft.owner_member_id <> v_actor.id then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    if v_draft.status in ('sent', 'cancelled') then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
    update public.message_drafts set status = 'draft', approved_by_member_id = null,
      approved_at = null, rejected_at = null, rejection_reason = null
    where organization_id = v_organization_id and id = v_target_id returning version into v_result_version;
    v_contact_id := v_draft.contact_id; v_lead_id := v_draft.lead_id; v_opportunity_id := v_draft.opportunity_id; v_owner_member_id := v_draft.owner_member_id;
    v_result := jsonb_build_object('message_draft_id', v_target_id, 'lead_id', v_lead_id, 'version', v_result_version);

  elsif v_command_name in ('approve_message_draft', 'reject_message_draft') then
    select * into v_draft from public.message_drafts where organization_id = v_organization_id and id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    select * into v_settings from public.organization_assignment_settings where organization_id = v_organization_id;
    if v_actor.role = 'sales' and (v_draft.owner_member_id <> v_actor.id or not coalesce(v_settings.sales_self_approval_enabled, true)) then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    if v_command_name = 'reject_message_draft' and nullif(btrim(v_payload ->> 'reason'), '') is null then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    update public.message_drafts set
      status = case when v_command_name = 'approve_message_draft' then 'approved'::public.message_draft_status else 'rejected'::public.message_draft_status end,
      approved_by_member_id = case when v_command_name = 'approve_message_draft' then v_actor.id else null end,
      approved_at = case when v_command_name = 'approve_message_draft' then now() else null end,
      rejected_at = case when v_command_name = 'reject_message_draft' then now() else null end,
      rejection_reason = case when v_command_name = 'reject_message_draft' then v_payload ->> 'reason' else null end
    where organization_id = v_organization_id and id = v_target_id returning version into v_result_version;
    v_contact_id := v_draft.contact_id; v_lead_id := v_draft.lead_id; v_opportunity_id := v_draft.opportunity_id; v_owner_member_id := v_draft.owner_member_id;
    v_result := jsonb_build_object('message_draft_id', v_target_id, 'version', v_result_version);

  elsif v_command_name = 'mark_manual_message_sent' then
    select * into v_draft from public.message_drafts where organization_id = v_organization_id and id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_actor.role = 'sales' and v_draft.owner_member_id <> v_actor.id then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    select * into v_settings from public.organization_assignment_settings where organization_id = v_organization_id;
    if coalesce(v_settings.draft_approval_required, false) and v_draft.status <> 'approved' then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    if v_draft.status in ('sent', 'cancelled', 'rejected') then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
    v_outcome := (v_payload ->> 'outcome')::public.message_outcome;
    if nullif(v_payload ->> 'actual_channel', '') is null or nullif(btrim(coalesce(v_payload ->> 'content', v_draft.content)), '') is null then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    if v_outcome in ('no_reply', 'replied', 'interested') and nullif(v_payload ->> 'next_follow_up_at', '') is null then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    insert into public.messages (
      organization_id, contact_id, lead_id, opportunity_id, message_draft_id, owner_member_id, sent_by_member_id,
      provider, actual_channel, direction, status, content, outcome, notes, sent_at
    ) values (
      v_organization_id, v_draft.contact_id, v_draft.lead_id, v_draft.opportunity_id, v_draft.id,
      v_draft.owner_member_id, v_actor.id, 'manual', (v_payload ->> 'actual_channel')::public.manual_channel,
      'outbound', 'sent', coalesce(nullif(v_payload ->> 'content', ''), v_draft.content), v_outcome,
      nullif(v_payload ->> 'notes', ''), coalesce(nullif(v_payload ->> 'sent_at', '')::timestamptz, now())
    ) returning id into v_message_id;
    update public.message_drafts set status = 'sent' where organization_id = v_organization_id and id = v_draft.id
      returning version into v_result_version;
    v_task_id := nullif(v_payload ->> 'task_id', '')::uuid;
    if v_task_id is not null then
      update public.follow_up_tasks set status = 'completed', completed_at = now(), outcome = v_outcome
      where organization_id = v_organization_id and id = v_task_id
        and (v_actor.role <> 'sales' or assignee_member_id = v_actor.id);
      if not found then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    end if;
    if v_outcome in ('not_interested', 'converted', 'invalid') then
      update public.follow_up_tasks set status = 'cancelled', cancelled_at = now(), outcome = v_outcome
      where organization_id = v_organization_id and lead_id = v_draft.lead_id and status in ('open', 'snoozed');
    else
      v_next_due_at := (v_payload ->> 'next_follow_up_at')::timestamptz;
      insert into public.follow_up_tasks (
        organization_id, contact_id, lead_id, opportunity_id, assignee_member_id, created_by_member_id, title, notes, due_at
      ) values (
        v_organization_id, v_draft.contact_id, v_draft.lead_id, v_draft.opportunity_id, v_draft.owner_member_id,
        v_actor.id, '客户消息后续跟进', nullif(v_payload ->> 'notes', ''), v_next_due_at
      ) returning id into v_task_id;
    end if;
    v_contact_id := v_draft.contact_id; v_lead_id := v_draft.lead_id; v_opportunity_id := v_draft.opportunity_id; v_owner_member_id := v_draft.owner_member_id;
    v_result := jsonb_build_object('message_id', v_message_id, 'message_draft_id', v_draft.id, 'next_task_id', v_task_id, 'version', v_result_version);

  elsif v_command_name = 'convert_lead' then
    select l.contact_id, l.account_id, l.owner_member_id into v_contact_id, v_profile_id, v_owner_member_id
    from public.leads l where l.organization_id = v_organization_id and l.id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_actor.role = 'sales' and v_owner_member_id <> v_actor.id then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    if exists (select 1 from public.opportunities o where o.organization_id = v_organization_id and o.lead_id = v_target_id and o.is_primary) then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    select id into v_stage_id from public.pipeline_stages where organization_id = v_organization_id and is_default limit 1;
    if v_stage_id is null then raise exception using errcode = '55000', message = 'VALIDATION_ERROR'; end if;
    insert into public.opportunities (
      organization_id, contact_id, account_id, lead_id, owner_member_id, pipeline_stage_id, title, amount, currency, expected_close_date
    ) values (
      v_organization_id, v_contact_id, v_profile_id, v_target_id, v_owner_member_id, v_stage_id,
      coalesce(nullif(v_payload ->> 'title', ''), '新商机'), nullif(v_payload ->> 'amount', '')::numeric,
      coalesce(nullif(v_payload ->> 'currency', ''), v_org.default_currency), nullif(v_payload ->> 'expected_close_date', '')::date
    ) returning id, version into v_opportunity_id, v_result_version;
    update public.leads set status = 'converted', converted_at = now() where organization_id = v_organization_id and id = v_target_id;
    v_lead_id := v_target_id;
    v_result := jsonb_build_object('opportunity_id', v_opportunity_id, 'lead_id', v_target_id, 'version', v_result_version);

  elsif v_command_name = 'change_opportunity_stage' then
    select o.contact_id, o.lead_id, o.owner_member_id into v_contact_id, v_lead_id, v_owner_member_id
    from public.opportunities o where o.organization_id = v_organization_id and o.id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_actor.role = 'sales' and v_owner_member_id <> v_actor.id then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    v_stage_id := (v_payload ->> 'pipeline_stage_id')::uuid;
    if not exists (select 1 from public.pipeline_stages where organization_id = v_organization_id and id = v_stage_id) then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    update public.opportunities set pipeline_stage_id = v_stage_id
    where organization_id = v_organization_id and id = v_target_id returning version into v_result_version;
    v_opportunity_id := v_target_id;
    v_result := jsonb_build_object('opportunity_id', v_target_id, 'pipeline_stage_id', v_stage_id, 'version', v_result_version);

  elsif v_command_name = 'mark_opportunity_won' then
    select o.contact_id, o.lead_id, o.owner_member_id into v_contact_id, v_lead_id, v_owner_member_id
    from public.opportunities o where o.organization_id = v_organization_id and o.id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_actor.role = 'sales' and v_owner_member_id <> v_actor.id then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    select id into v_stage_id from public.pipeline_stages where organization_id = v_organization_id and is_won limit 1;
    if v_stage_id is null then raise exception using errcode = '55000', message = 'VALIDATION_ERROR'; end if;
    update public.opportunities set status = 'won', won_at = now(), pipeline_stage_id = v_stage_id
    where organization_id = v_organization_id and id = v_target_id returning version into v_result_version;
    update public.follow_up_tasks set status = 'cancelled', cancelled_at = now()
    where organization_id = v_organization_id and opportunity_id = v_target_id and status in ('open', 'snoozed');
    v_opportunity_id := v_target_id;
    v_result := jsonb_build_object('opportunity_id', v_target_id, 'version', v_result_version);

  elsif v_command_name = 'mark_lead_invalid' then
    select l.contact_id, l.owner_member_id into v_contact_id, v_owner_member_id
    from public.leads l where l.organization_id = v_organization_id and l.id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_actor.role = 'sales' and v_owner_member_id <> v_actor.id then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    if nullif(btrim(v_payload ->> 'reason'), '') is null then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
    update public.leads set status = 'archived', invalid_reason = v_payload ->> 'reason'
    where organization_id = v_organization_id and id = v_target_id returning version into v_result_version;
    update public.follow_up_tasks set status = 'cancelled', cancelled_at = now(), outcome = 'invalid'
    where organization_id = v_organization_id and lead_id = v_target_id and status in ('open', 'snoozed');
    v_lead_id := v_target_id;
    v_result := jsonb_build_object('lead_id', v_target_id, 'version', v_result_version);

  elsif v_command_name = 'update_assignment_settings' then
    if v_actor.role not in ('owner', 'admin') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    update public.organization_assignment_settings set
      strategy = coalesce(nullif(v_payload ->> 'strategy', '')::public.assignment_strategy, strategy),
      auto_assignment_enabled = coalesce((v_payload ->> 'auto_assignment_enabled')::boolean, auto_assignment_enabled),
      daily_limit_enabled = coalesce((v_payload ->> 'daily_limit_enabled')::boolean, daily_limit_enabled),
      default_daily_limit = case when v_payload ? 'default_daily_limit' then nullif(v_payload ->> 'default_daily_limit', '')::integer else default_daily_limit end,
      first_response_sla_minutes = coalesce(nullif(v_payload ->> 'first_response_sla_minutes', '')::integer, first_response_sla_minutes),
      lead_deduplication_window_days = coalesce(nullif(v_payload ->> 'lead_deduplication_window_days', '')::integer, lead_deduplication_window_days),
      draft_approval_required = coalesce((v_payload ->> 'draft_approval_required')::boolean, draft_approval_required),
      sales_self_approval_enabled = coalesce((v_payload ->> 'sales_self_approval_enabled')::boolean, sales_self_approval_enabled),
      rule_version = rule_version + 1, updated_by_member_id = v_actor.id
    where organization_id = v_organization_id returning id, version into v_target_id, v_result_version;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    v_result := jsonb_build_object('assignment_settings_id', v_target_id, 'version', v_result_version);

  elsif v_command_name = 'create_scoring_profile_version' then
    if v_actor.role not in ('owner', 'admin') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    update public.organization_scoring_profiles set status = 'retired'
    where organization_id = v_organization_id and status = 'active';
    insert into public.organization_scoring_profiles (
      organization_id, name, profile_version, status, currency, pricing_model, minimum_viable_budget,
      target_budget_min, target_budget_max, target_industries, target_company_sizes, target_regions,
      target_use_cases, target_buyer_roles, positive_signals, disqualifying_signals, effective_from, created_by_member_id
    ) values (
      v_organization_id, coalesce(nullif(v_payload ->> 'name', ''), 'Standard v1'),
      coalesce((select max(profile_version) + 1 from public.organization_scoring_profiles where organization_id = v_organization_id), 1),
      'active', coalesce(nullif(v_payload ->> 'currency', ''), 'CNY'), nullif(v_payload ->> 'pricing_model', ''),
      nullif(v_payload ->> 'minimum_viable_budget', '')::numeric, nullif(v_payload ->> 'target_budget_min', '')::numeric,
      nullif(v_payload ->> 'target_budget_max', '')::numeric,
      coalesce(array(select jsonb_array_elements_text(v_payload -> 'target_industries')), '{}'),
      coalesce(array(select jsonb_array_elements_text(v_payload -> 'target_company_sizes')), '{}'),
      coalesce(array(select jsonb_array_elements_text(v_payload -> 'target_regions')), '{}'),
      coalesce(array(select jsonb_array_elements_text(v_payload -> 'target_use_cases')), '{}'),
      coalesce(array(select jsonb_array_elements_text(v_payload -> 'target_buyer_roles')), '{}'),
      coalesce(array(select jsonb_array_elements_text(v_payload -> 'positive_signals')), '{}'),
      coalesce(array(select jsonb_array_elements_text(v_payload -> 'disqualifying_signals')), '{}'),
      now(), v_actor.id
    ) returning id, version into v_profile_id, v_result_version;
    v_result := jsonb_build_object('scoring_profile_id', v_profile_id, 'version', v_result_version);

  elsif v_command_name = 'record_lead_score' then
    if v_source not in ('n8n', 'system') or v_actor.role not in ('owner', 'admin') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    select l.contact_id, l.owner_member_id into v_contact_id, v_owner_member_id
    from public.leads l where l.organization_id = v_organization_id and l.id = v_target_id;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    select id into v_profile_id from public.organization_scoring_profiles
    where organization_id = v_organization_id and status = 'active';
    if v_profile_id is null then raise exception using errcode = '55000', message = 'VALIDATION_ERROR'; end if;
    v_dimensions := crm.derive_standard_v1_dimensions(v_payload -> 'extracted_evidence', v_target_id, v_profile_id);
    v_score := crm.calculate_standard_v1_score(v_dimensions);
    if nullif(v_payload ->> 'prompt_version', '') is null
      or nullif(v_payload ->> 'ai_provider', '') is null
      or nullif(v_payload ->> 'ai_model', '') is null
      or nullif(v_payload ->> 'confidence', '')::numeric not between 0 and 1
    then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
    insert into public.lead_scores (
      organization_id, lead_id, scoring_profile_id, prompt_version, status, total_score, raw_known_score,
      known_weight, normalized_score, coverage, confidence, priority_level, dimension_scores, score_reasons,
      missing_information, recommended_next_action, ai_provider, ai_model, input_tokens, output_tokens, latency_ms
    ) values (
      v_organization_id, v_target_id, v_profile_id, v_payload ->> 'prompt_version',
      case when (v_score ->> 'coverage')::numeric >= 0.60 and coalesce((v_payload ->> 'confidence')::numeric, 0) >= 0.70 then 'complete'::public.score_status else 'incomplete'::public.score_status end,
      nullif(v_score ->> 'total_score', '')::numeric, (v_score ->> 'raw_known_score')::numeric,
      (v_score ->> 'known_weight')::numeric, nullif(v_score ->> 'normalized_score', '')::numeric,
      (v_score ->> 'coverage')::numeric, (v_payload ->> 'confidence')::numeric,
      nullif(v_score ->> 'priority_level', '')::public.priority_level, v_dimensions,
      jsonb_build_object('rule', 'standard_v1', 'source', 'deterministic_database_rules'),
      coalesce(v_payload -> 'missing_information', '[]'::jsonb),
      nullif(v_payload ->> 'recommended_next_action', ''), v_payload ->> 'ai_provider', v_payload ->> 'ai_model',
      nullif(v_payload ->> 'input_tokens', '')::integer, nullif(v_payload ->> 'output_tokens', '')::integer,
      nullif(v_payload ->> 'latency_ms', '')::integer
    ) returning id, version into v_profile_id, v_result_version;
    insert into public.score_history (organization_id, lead_id, lead_score_id, snapshot, reason)
    values (
      v_organization_id, v_target_id, v_profile_id,
      (v_payload - 'dimension_scores' - 'score_reasons') || jsonb_build_object(
        'dimension_scores', v_dimensions,
        'score_reasons', jsonb_build_object('rule', 'standard_v1', 'source', 'deterministic_database_rules')
      ) || v_score,
      coalesce(nullif(v_payload ->> 'reason', ''), 'automation_score')
    );
    v_lead_id := v_target_id;
    v_result := jsonb_build_object('lead_score_id', v_profile_id, 'version', v_result_version) || v_score;

  elsif v_command_name = 'transfer_organization_owner' then
    if v_actor.role <> 'owner' then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    v_candidate_id := (v_payload ->> 'new_owner_member_id')::uuid;
    if v_candidate_id = v_actor.id or not exists (
      select 1 from public.organization_members where organization_id = v_organization_id and id = v_candidate_id and status = 'active'
    ) then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
    update public.organization_members set role = 'admin' where id = v_actor.id and organization_id = v_organization_id;
    update public.organization_members set role = 'owner' where id = v_candidate_id and organization_id = v_organization_id returning version into v_result_version;
    v_result := jsonb_build_object('new_owner_member_id', v_candidate_id, 'version', v_result_version);

  elsif v_command_name = 'request_organization_deletion' then
    if v_source <> 'crm' or v_actor.role <> 'owner' or v_payload ->> 'verified_aal' <> 'aal2'
      or v_payload ->> 'organization_name' <> v_org.name
    then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    update public.organizations set status = 'pending_deletion', deletion_requested_at = now(),
      deletion_scheduled_at = now() + interval '30 days', deletion_cancelled_at = null, deletion_requested_by = v_actor_user_id
    where id = v_organization_id returning version into v_result_version;
    insert into public.organization_purge_jobs (organization_id, scheduled_at)
    values (v_organization_id, now() + interval '30 days');
    v_result := jsonb_build_object('organization_id', v_organization_id, 'status', 'pending_deletion', 'version', v_result_version);

  elsif v_command_name = 'cancel_organization_deletion' then
    if v_source <> 'crm' or v_org.status <> 'pending_deletion' or v_actor.role <> 'owner'
      or v_payload ->> 'verified_aal' <> 'aal2' or v_payload ->> 'organization_name' <> v_org.name
    then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    update public.organizations set status = 'active', deletion_cancelled_at = now(), deletion_scheduled_at = null
    where id = v_organization_id returning version into v_result_version;
    update public.organization_purge_jobs set status = 'cancelled'
    where organization_id = v_organization_id and status in ('scheduled', 'failed');
    v_result := jsonb_build_object('organization_id', v_organization_id, 'status', 'active', 'version', v_result_version);
  end if;

  if v_target_type = 'lead' and v_lead_id is null then
    v_lead_id := v_target_id;
    select contact_id, owner_member_id into v_contact_id, v_owner_member_id from public.leads where organization_id = v_organization_id and id = v_lead_id;
  elsif v_target_type = 'opportunity' and v_opportunity_id is null then
    v_opportunity_id := v_target_id;
    select contact_id, lead_id, owner_member_id into v_contact_id, v_lead_id, v_owner_member_id from public.opportunities where organization_id = v_organization_id and id = v_opportunity_id;
  end if;

  insert into public.activities (
    organization_id, contact_id, lead_id, opportunity_id, owner_member_id, actor_member_id,
    activity_type, title, notes, metadata, occurred_at
  ) values (
    v_organization_id, v_contact_id, v_lead_id, v_opportunity_id, v_owner_member_id, v_actor.id,
    v_command_name, replace(initcap(replace(v_command_name, '_', ' ')), 'Ai', 'AI'),
    nullif(v_payload ->> 'notes', ''), jsonb_build_object('command_id', v_command_id, 'source', v_source), v_occurred_at
  ) returning id into v_activity_id;

  insert into public.audit_logs (
    organization_id, actor_user_id, actor_member_id, action, target_type, target_id, source,
    command_execution_id, after_state, metadata
  ) values (
    v_organization_id, v_actor_user_id, v_actor.id, v_command_name, v_target_type, v_target_id,
    v_source, v_execution_id, v_result, jsonb_build_object('command_id', v_command_id)
  ) returning id into v_audit_id;

  insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload)
  values (
    v_organization_id, v_target_type, v_target_id, 'command.' || v_command_name || '.succeeded',
    jsonb_build_object('command_id', v_command_id, 'actor_member_id', v_actor.id, 'result', v_result)
  ) returning id into v_outbox_id;

  v_result := jsonb_build_object(
    'ok', true,
    'command_id', v_command_id,
    'command_execution_id', v_execution_id,
    'result', v_result,
    'latest_version', v_result_version,
    'activity_id', v_activity_id,
    'audit_id', v_audit_id,
    'outbox_event_ids', jsonb_build_array(v_outbox_id)
  );

  update public.command_executions set status = 'succeeded', response = v_result, completed_at = now()
  where id = v_execution_id;
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
end;
$$;

-- Final server-only privilege boundary (execute_command is intentionally not callable by browsers).
revoke all on all functions in schema crm from public, anon, authenticated;
grant execute on all functions in schema crm to service_role;

create or replace function crm.read_vault_secret(p_secret_ref text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_secret text;
begin
  perform crm.require_service_role();
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.id::text = p_secret_ref or s.name = p_secret_ref
  limit 1;
  if v_secret is null then raise exception using errcode = 'P0002', message = 'CONNECTION_INVALID'; end if;
  return v_secret;
end;
$$;

create or replace function crm.check_intake_rate_limit(p_connection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  perform crm.require_service_role();
  perform pg_advisory_xact_lock(hashtextextended(p_connection_id::text, 0));
  select rate_limit_per_minute into v_limit
  from public.lead_source_connections where id = p_connection_id and status = 'active';
  if v_limit is null then raise exception using errcode = 'P0002', message = 'CONNECTION_INVALID'; end if;
  select count(*) into v_count from public.inbound_events
  where source_connection_id = p_connection_id and received_at >= now() - interval '1 minute';
  return v_count < v_limit;
end;
$$;

create or replace function crm.configure_channel_connection(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_provider public.provider_code,
  p_name text,
  p_public_config jsonb,
  p_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.organization_members%rowtype;
  v_connection public.channel_connections%rowtype;
  v_secret_name text;
  v_secret_id uuid;
  v_command_id uuid := extensions.gen_random_uuid();
  v_execution_id uuid;
  v_outbox_id uuid;
begin
  perform crm.require_service_role();
  select * into v_member from public.organization_members
  where organization_id = p_organization_id and user_id = p_actor_user_id and status = 'active' for update;
  if not found or v_member.role not in ('owner', 'admin') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if not exists (select 1 from public.organizations where id = p_organization_id and status = 'active') then
    raise exception using errcode = '55000', message = 'ORGANIZATION_INACTIVE';
  end if;
  if p_provider not in ('manual', 'feishu_internal') or nullif(btrim(p_name), '') is null then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if p_provider = 'feishu_internal' and nullif(p_secret, '') is null then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  if p_connection_id is not null then
    select * into v_connection from public.channel_connections
    where organization_id = p_organization_id and id = p_connection_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  end if;

  v_secret_name := coalesce(v_connection.secret_ref, 'channel:' || p_organization_id::text || ':' || p_provider::text || ':' || extensions.gen_random_uuid()::text);
  if p_provider = 'feishu_internal' then
    select id into v_secret_id from vault.decrypted_secrets where name = v_secret_name;
    if v_secret_id is null then
      select vault.create_secret(p_secret, v_secret_name, 'AI Sales Dashboard channel credential') into v_secret_id;
    else
      perform vault.update_secret(v_secret_id, p_secret, v_secret_name, 'AI Sales Dashboard channel credential');
    end if;
  else
    v_secret_name := null;
  end if;

  if p_connection_id is null then
    insert into public.channel_connections (organization_id, provider, name, status, secret_ref, public_config, validated_at, created_by_member_id)
    values (p_organization_id, p_provider, p_name, 'active', v_secret_name, coalesce(p_public_config, '{}'::jsonb), now(), v_member.id)
    returning * into v_connection;
  else
    update public.channel_connections set name = p_name, status = 'active', secret_ref = v_secret_name,
      public_config = coalesce(p_public_config, '{}'::jsonb), validated_at = now(), last_error_code = null
    where id = p_connection_id returning * into v_connection;
  end if;

  insert into public.command_executions (
    command_id, organization_id, idempotency_key, command_name, actor_user_id, actor_member_id,
    target_type, target_id, source, occurred_at, request_hash, request_payload, status, completed_at
  ) values (
    v_command_id, p_organization_id, 'channel-config:' || v_command_id::text, 'configure_channel_connection',
    p_actor_user_id, v_member.id, 'channel_connection', v_connection.id, 'crm', now(),
    encode(extensions.digest(convert_to(coalesce(p_public_config, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex'),
    jsonb_build_object('provider', p_provider, 'name', p_name, 'secret_changed', p_secret is not null), 'succeeded', now()
  ) returning id into v_execution_id;
  insert into public.audit_logs (
    organization_id, actor_user_id, actor_member_id, action, target_type, target_id, source, command_execution_id, after_state
  ) values (
    p_organization_id, p_actor_user_id, v_member.id, 'configure_channel_connection', 'channel_connection',
    v_connection.id, 'crm', v_execution_id, jsonb_build_object('provider', p_provider, 'status', v_connection.status, 'secret_ref_changed', p_secret is not null)
  );
  insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload)
  values (p_organization_id, 'channel_connection', v_connection.id, 'channel.connection.configured', jsonb_build_object('provider', p_provider))
  returning id into v_outbox_id;
  return jsonb_build_object('connection_id', v_connection.id, 'public_id', v_connection.public_id, 'status', v_connection.status, 'version', v_connection.version, 'outbox_event_ids', jsonb_build_array(v_outbox_id));
end;
$$;

create or replace function crm.configure_source_connection(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_provider text,
  p_name text,
  p_external_source_id text,
  p_mapping jsonb,
  p_settings jsonb,
  p_rate_limit_per_minute integer,
  p_max_payload_bytes integer,
  p_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.organization_members%rowtype;
  v_connection public.lead_source_connections%rowtype;
  v_secret_name text;
  v_secret_id uuid;
  v_command_id uuid := extensions.gen_random_uuid();
  v_execution_id uuid;
  v_outbox_id uuid;
begin
  perform crm.require_service_role();
  select * into v_member from public.organization_members
  where organization_id = p_organization_id and user_id = p_actor_user_id and status = 'active' for update;
  if not found or v_member.role not in ('owner', 'admin') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if not exists (select 1 from public.organizations where id = p_organization_id and status = 'active') then
    raise exception using errcode = '55000', message = 'ORGANIZATION_INACTIVE';
  end if;
  if p_provider is null
    or p_provider not in ('tally', 'generic_webhook', 'internal_manual')
    or nullif(btrim(p_name), '') is null
    or jsonb_typeof(coalesce(p_mapping, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_settings, '{}'::jsonb)) <> 'object'
    or p_rate_limit_per_minute is null
    or p_rate_limit_per_minute not between 1 and 10000
    or p_max_payload_bytes is null
    or p_max_payload_bytes not between 1024 and 1048576
    or nullif(p_secret, '') is null
    or (p_provider = 'tally' and nullif(btrim(p_external_source_id), '') is null)
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  if p_connection_id is not null then
    select * into v_connection from public.lead_source_connections
    where organization_id = p_organization_id and id = p_connection_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_connection.provider <> p_provider then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
  end if;

  v_secret_name := coalesce(
    v_connection.secret_ref,
    'source:' || p_organization_id::text || ':' || p_provider || ':' || extensions.gen_random_uuid()::text
  );
  select id into v_secret_id from vault.decrypted_secrets where name = v_secret_name;
  if v_secret_id is null then
    select vault.create_secret(p_secret, v_secret_name, 'AI Sales Dashboard source credential') into v_secret_id;
  else
    perform vault.update_secret(v_secret_id, p_secret, v_secret_name, 'AI Sales Dashboard source credential');
  end if;

  if p_connection_id is null then
    insert into public.lead_source_connections (
      organization_id, provider, name, status, external_source_id, secret_ref, mapping, settings,
      rate_limit_per_minute, max_payload_bytes, created_by_member_id, validated_at
    ) values (
      p_organization_id, p_provider, p_name, 'active', nullif(btrim(p_external_source_id), ''), v_secret_name,
      coalesce(p_mapping, '{}'::jsonb), coalesce(p_settings, '{}'::jsonb), p_rate_limit_per_minute,
      p_max_payload_bytes, v_member.id, now()
    ) returning * into v_connection;
  else
    update public.lead_source_connections set
      name = p_name,
      status = 'active',
      external_source_id = nullif(btrim(p_external_source_id), ''),
      secret_ref = v_secret_name,
      mapping = coalesce(p_mapping, '{}'::jsonb),
      settings = coalesce(p_settings, '{}'::jsonb),
      rate_limit_per_minute = p_rate_limit_per_minute,
      max_payload_bytes = p_max_payload_bytes,
      validated_at = now()
    where id = p_connection_id returning * into v_connection;
  end if;

  insert into public.command_executions (
    command_id, organization_id, idempotency_key, command_name, actor_user_id, actor_member_id,
    target_type, target_id, source, occurred_at, request_hash, request_payload, status, completed_at
  ) values (
    v_command_id, p_organization_id, 'source-config:' || v_command_id::text, 'configure_source_connection',
    p_actor_user_id, v_member.id, 'source_connection', v_connection.id, 'crm', now(),
    encode(extensions.digest(convert_to(
      jsonb_build_object('provider', p_provider, 'mapping', coalesce(p_mapping, '{}'::jsonb), 'settings', coalesce(p_settings, '{}'::jsonb))::text,
      'UTF8'
    ), 'sha256'), 'hex'),
    jsonb_build_object(
      'provider', p_provider, 'name', p_name, 'external_source_id', nullif(btrim(p_external_source_id), ''),
      'mapping', coalesce(p_mapping, '{}'::jsonb), 'settings', coalesce(p_settings, '{}'::jsonb),
      'rate_limit_per_minute', p_rate_limit_per_minute, 'max_payload_bytes', p_max_payload_bytes,
      'secret_changed', true
    ),
    'succeeded', now()
  ) returning id into v_execution_id;
  insert into public.audit_logs (
    organization_id, actor_user_id, actor_member_id, action, target_type, target_id, source,
    command_execution_id, after_state
  ) values (
    p_organization_id, p_actor_user_id, v_member.id, 'configure_source_connection', 'source_connection',
    v_connection.id, 'crm', v_execution_id,
    jsonb_build_object('provider', p_provider, 'status', v_connection.status, 'secret_ref_changed', true)
  );
  insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload)
  values (
    p_organization_id, 'source_connection', v_connection.id, 'source.connection.configured',
    jsonb_build_object('provider', p_provider)
  ) returning id into v_outbox_id;
  return jsonb_build_object(
    'connection_id', v_connection.id,
    'public_id', v_connection.public_id,
    'status', v_connection.status,
    'version', v_connection.version,
    'outbox_event_ids', jsonb_build_array(v_outbox_id)
  );
end;
$$;

create or replace function crm.enqueue_due_automation_events(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  perform crm.require_service_role();
  if p_limit not between 1 and 1000 then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
  with due as (
    select t.* from public.follow_up_tasks t
    join public.organizations o on o.id = t.organization_id and o.status = 'active'
    where t.status in ('open', 'snoozed') and t.due_at <= now()
    order by t.due_at limit p_limit
    for update of t skip locked
  )
  insert into public.outbox_events (
    organization_id, aggregate_type, aggregate_id, event_type, deduplication_key, payload
  )
  select
    d.organization_id, 'task', d.id, 'task.reminder.due',
    'task-reminder:' || d.id::text || ':' || extract(epoch from d.due_at)::bigint::text,
    jsonb_build_object('task_id', d.id, 'lead_id', d.lead_id, 'assignee_member_id', d.assignee_member_id, 'due_at', d.due_at)
  from due d
  on conflict (organization_id, deduplication_key) where deduplication_key is not null do nothing;
  get diagnostics v_count = row_count;
  return jsonb_build_object('enqueued', v_count);
end;
$$;

create or replace function crm.run_retention_cleanup(p_batch_size integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inbound integer := 0;
  v_delivery integer := 0;
  v_audit integer := 0;
  v_commands integer := 0;
begin
  perform crm.require_service_role();
  if p_batch_size not between 1 and 5000 then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
  update public.inbound_events set raw_payload = '{}'::jsonb, normalized_payload = jsonb_build_object('expired', true), status = 'expired'
  where id in (select id from public.inbound_events where created_at < now() - interval '90 days' and status <> 'expired' limit p_batch_size);
  get diagnostics v_inbound = row_count;
  update public.delivery_events set payload = '{"expired":true}'::jsonb
  where id in (select id from public.delivery_events where created_at < now() - interval '90 days' and payload <> '{"expired":true}'::jsonb limit p_batch_size);
  get diagnostics v_delivery = row_count;
  delete from public.audit_logs where id in (
    select id from public.audit_logs where created_at < now() - interval '365 days' limit p_batch_size
  ); get diagnostics v_audit = row_count;
  delete from public.command_executions where id in (
    select id from public.command_executions where created_at < now() - interval '365 days' limit p_batch_size
  ); get diagnostics v_commands = row_count;
  return jsonb_build_object('inbound_payloads_expired', v_inbound, 'delivery_payloads_expired', v_delivery, 'audit_logs_deleted', v_audit, 'command_executions_deleted', v_commands);
end;
$$;

create or replace function crm.log_automation_failure(
  p_organization_id uuid,
  p_workflow_key text,
  p_external_execution_id text,
  p_outbox_event_id uuid,
  p_error_code text,
  p_error_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform crm.require_service_role();
  insert into public.automation_runs (
    organization_id, workflow_key, external_execution_id, outbox_event_id, status,
    completed_at, error_code, error_message
  ) values (
    p_organization_id, left(p_workflow_key, 160), nullif(p_external_execution_id, ''), p_outbox_event_id,
    'failed', now(), left(p_error_code, 120), left(p_error_message, 1000)
  ) on conflict (organization_id, workflow_key, external_execution_id)
    do update set status = 'failed', completed_at = now(), error_code = excluded.error_code, error_message = excluded.error_message
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on all functions in schema crm from public, anon, authenticated;
grant execute on all functions in schema crm to service_role;
