create table public.organization_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 320),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  job_title text,
  role public.organization_role not null check (role <> 'owner'),
  accepts_assignments boolean not null default true,
  status text not null default 'processing' check (status in ('processing', 'provisioned', 'failed', 'cancelled')),
  auth_user_id uuid references auth.users(id) on delete set null,
  invited_by_member_id uuid,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 8 and 200),
  expires_at timestamptz not null default (now() + interval '7 days'),
  provisioned_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  foreign key (organization_id, invited_by_member_id)
    references public.organization_members(organization_id, id) on delete set null,
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  check ((status = 'provisioned' and auth_user_id is not null and provisioned_at is not null) or status <> 'provisioned')
);

create unique index organization_invitations_open_email_uidx
  on public.organization_invitations (organization_id, email)
  where status = 'processing';
create index organization_invitations_org_status_idx
  on public.organization_invitations (organization_id, status, created_at desc);

create unique index member_feishu_verified_open_id_uidx
  on public.organization_member_channel_identities (organization_id, provider, feishu_open_id)
  where provider = 'feishu_internal' and status = 'verified';

create trigger organization_invitations_set_updated_at_version
  before update on public.organization_invitations
  for each row execute function public.set_updated_at_and_version();

alter table public.organization_invitations enable row level security;

create policy organization_invitations_select on public.organization_invitations
  for select to authenticated
  using (public.can_administer_organization(organization_id));
create policy organization_invitations_insert on public.organization_invitations
  for insert to authenticated with check (false);
create policy organization_invitations_update on public.organization_invitations
  for update to authenticated using (false) with check (false);
create policy organization_invitations_delete on public.organization_invitations
  for delete to authenticated using (false);

grant select on public.organization_invitations to authenticated;
grant all on public.organization_invitations to service_role;

-- Member provider identifiers are organization administration data. A member may
-- read their own mapping, while only Owner/Admin can read mappings for others.
drop policy member_channel_identities_select on public.organization_member_channel_identities;
create policy member_channel_identities_select on public.organization_member_channel_identities
  for select to authenticated
  using (
    public.can_administer_organization(organization_id)
    or member_id = public.current_organization_member_id(organization_id)
  );

create or replace function crm.prepare_member_invitation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_email text,
  p_display_name text,
  p_job_title text,
  p_role text,
  p_accepts_assignments boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.organization_members%rowtype;
  v_invitation public.organization_invitations%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_role public.organization_role;
  v_auth_user_id uuid;
begin
  perform crm.require_service_role();

  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(v_email) > 320
    or length(v_name) not between 1 and 120
    or length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  begin
    v_role := p_role::public.organization_role;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end;

  if v_role = 'owner' then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  select m.* into v_actor
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.organization_id = p_organization_id
    and m.user_id = p_actor_user_id
    and m.status = 'active'
    and m.role in ('owner', 'admin')
    and o.status = 'active'
  for update of m;
  if not found then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if v_actor.role = 'admin' and v_role = 'admin' then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select u.id into v_auth_user_id
  from auth.users u
  where lower(u.email) = v_email
  order by u.created_at
  limit 1;

  select * into v_invitation
  from public.organization_invitations
  where organization_id = p_organization_id
    and idempotency_key = btrim(p_idempotency_key)
  for update;

  if found then
    if v_invitation.email <> v_email
      or v_invitation.display_name <> v_name
      or coalesce(v_invitation.job_title, '') <> coalesce(nullif(btrim(p_job_title), ''), '')
      or v_invitation.role <> v_role
      or v_invitation.accepts_assignments <> coalesce(p_accepts_assignments, true)
    then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    if v_invitation.status = 'failed' then
      update public.organization_invitations
      set status = 'processing', auth_user_id = coalesce(auth_user_id, v_auth_user_id),
          last_error_code = null, last_error_message = null, expires_at = now() + interval '7 days'
      where id = v_invitation.id
      returning * into v_invitation;
    end if;
  else
    if v_auth_user_id is not null and exists (
      select 1 from public.organization_members m
      where m.organization_id = p_organization_id
        and m.user_id = v_auth_user_id
        and m.status in ('active', 'invited')
    ) then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    if exists (
      select 1 from public.organization_invitations
      where organization_id = p_organization_id and email = v_email and status = 'processing'
    ) then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    insert into public.organization_invitations (
      organization_id, email, display_name, job_title, role, accepts_assignments,
      auth_user_id, invited_by_member_id, idempotency_key
    ) values (
      p_organization_id, v_email, v_name, nullif(btrim(p_job_title), ''), v_role,
      coalesce(p_accepts_assignments, true), v_auth_user_id, v_actor.id, btrim(p_idempotency_key)
    ) returning * into v_invitation;
  end if;

  return jsonb_build_object(
    'invitation_id', v_invitation.id,
    'organization_id', v_invitation.organization_id,
    'email', v_invitation.email,
    'display_name', v_invitation.display_name,
    'job_title', v_invitation.job_title,
    'role', v_invitation.role,
    'accepts_assignments', v_invitation.accepts_assignments,
    'status', v_invitation.status,
    'auth_user_id', coalesce(v_invitation.auth_user_id, v_auth_user_id),
    'created_at', v_invitation.created_at,
    'version', v_invitation.version
  );
end;
$$;

create or replace function crm.fail_member_invitation(
  p_invitation_id uuid,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.organization_invitations%rowtype;
begin
  perform crm.require_service_role();
  update public.organization_invitations
  set status = 'failed', last_error_code = left(nullif(btrim(p_error_code), ''), 80),
      last_error_message = left(nullif(btrim(p_error_message), ''), 500)
  where id = p_invitation_id and status = 'processing'
  returning * into v_invitation;
  if found then
    insert into public.audit_logs (
      organization_id, actor_member_id, action, target_type, target_id, source, after_state
    ) values (
      v_invitation.organization_id, v_invitation.invited_by_member_id,
      'member_invitation_failed', 'organization_invitation', v_invitation.id, 'system',
      jsonb_build_object('status', 'failed', 'error_code', v_invitation.last_error_code)
    );
  end if;
end;
$$;

create or replace function crm.execute_admin_command(p_envelope jsonb)
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
  v_target public.organization_members%rowtype;
  v_replacement public.organization_members%rowtype;
  v_invitation public.organization_invitations%rowtype;
  v_identity public.organization_member_channel_identities%rowtype;
  v_event public.outbox_events%rowtype;
  v_desired_role public.organization_role;
  v_has_workload boolean := false;
  v_counts jsonb := '{}'::jsonb;
  v_count integer;
  v_result jsonb := '{}'::jsonb;
  v_result_version bigint;
  v_activity_id uuid;
  v_audit_id uuid;
  v_outbox_id uuid;
  v_owner_member_id uuid;
begin
  perform crm.require_service_role();

  begin
    v_command_id := (p_envelope ->> 'command_id')::uuid;
    v_idempotency_key := btrim(p_envelope ->> 'idempotency_key');
    v_command_name := btrim(p_envelope ->> 'command_name');
    v_organization_id := (p_envelope ->> 'organization_id')::uuid;
    v_actor_user_id := (p_envelope ->> 'actor_user_id')::uuid;
    v_target_type := btrim(p_envelope ->> 'target_type');
    v_target_id := nullif(p_envelope ->> 'target_id', '')::uuid;
    v_expected_version := nullif(p_envelope ->> 'expected_version', '')::bigint;
    v_source := btrim(p_envelope ->> 'source');
    v_occurred_at := (p_envelope ->> 'occurred_at')::timestamptz;
    v_payload := coalesce(p_envelope -> 'payload', '{}'::jsonb);
  exception when others then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end;

  if v_command_id is null or length(v_idempotency_key) not between 8 and 200
    or v_command_name not in (
      'provision_organization_member', 'update_organization_member',
      'deactivate_organization_member', 'reactivate_organization_member',
      'verify_member_channel_identity', 'remove_member_channel_identity', 'retry_outbox_event'
    )
    or v_target_id is null or v_source not in ('crm', 'feishu', 'n8n', 'system')
    or jsonb_typeof(v_payload) <> 'object'
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  v_hash := encode(extensions.digest(convert_to(p_envelope::text, 'UTF8'), 'sha256'), 'hex');
  select * into v_existing from public.command_executions
  where organization_id = v_organization_id and idempotency_key = v_idempotency_key
  for update;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    if v_existing.status = 'succeeded' then
      return v_existing.response;
    end if;
    raise exception using errcode = '40001', message = 'VERSION_CONFLICT';
  end if;

  select m.* into v_actor
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.organization_id = v_organization_id
    and m.user_id = v_actor_user_id
    and m.status = 'active'
    and m.role in ('owner', 'admin')
    and o.status = 'active'
  for update of m;
  if not found then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  insert into public.command_executions (
    command_id, organization_id, idempotency_key, command_name, actor_user_id, actor_member_id,
    target_type, target_id, expected_version, source, occurred_at, request_hash, request_payload
  ) values (
    v_command_id, v_organization_id, v_idempotency_key, v_command_name, v_actor_user_id, v_actor.id,
    v_target_type, v_target_id, v_expected_version, v_source, v_occurred_at, v_hash, p_envelope
  ) returning id into v_execution_id;

  if v_command_name = 'provision_organization_member' then
    select * into v_invitation from public.organization_invitations
    where organization_id = v_organization_id and id = v_target_id for update;
    if not found or v_invitation.status <> 'processing' then
      raise exception using errcode = 'P0002', message = 'NOT_FOUND';
    end if;
    if v_actor.id <> v_invitation.invited_by_member_id then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    if v_actor.role = 'admin' and v_invitation.role = 'admin' then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    if nullif(v_payload ->> 'auth_user_id', '')::uuid is null then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;

    insert into public.profiles (id, display_name, job_title)
    values (
      (v_payload ->> 'auth_user_id')::uuid, v_invitation.display_name, v_invitation.job_title
    ) on conflict (id) do nothing;

    insert into public.organization_members (
      organization_id, user_id, role, status, accepts_assignments, is_away, activated_at
    ) values (
      v_organization_id, (v_payload ->> 'auth_user_id')::uuid, v_invitation.role,
      'active', v_invitation.accepts_assignments, false, now()
    )
    on conflict (organization_id, user_id) do update
    set role = excluded.role, status = 'active', accepts_assignments = excluded.accepts_assignments,
        is_away = false, activated_at = coalesce(public.organization_members.activated_at, now()),
        deactivated_at = null
    where public.organization_members.status = 'inactive'
    returning * into v_target;
    if not found then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;

    update public.organization_invitations
    set status = 'provisioned', auth_user_id = v_target.user_id, provisioned_at = now(),
        last_error_code = null, last_error_message = null
    where id = v_invitation.id;
    v_result_version := v_target.version;
    v_owner_member_id := v_target.id;
    v_result := jsonb_build_object(
      'member_id', v_target.id, 'status', v_target.status, 'role', v_target.role,
      'invitation_id', v_invitation.id
    );

  elsif v_command_name in ('update_organization_member', 'deactivate_organization_member', 'reactivate_organization_member') then
    select * into v_target from public.organization_members
    where organization_id = v_organization_id and id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_expected_version is not null and v_target.version <> v_expected_version then
      raise exception using errcode = '40001', message = 'VERSION_CONFLICT';
    end if;
    if v_target.role = 'owner' or (v_actor.role = 'admin' and v_target.role = 'admin') then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    v_owner_member_id := v_target.id;

    if v_command_name = 'update_organization_member' then
      begin
        v_desired_role := coalesce(nullif(v_payload ->> 'role', ''), v_target.role::text)::public.organization_role;
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
      end;
      if v_desired_role = 'owner' or (v_actor.role = 'admin' and v_desired_role = 'admin') then
        raise exception using errcode = '42501', message = 'FORBIDDEN';
      end if;
      update public.organization_members
      set role = v_desired_role,
          accepts_assignments = coalesce((v_payload ->> 'accepts_assignments')::boolean, accepts_assignments),
          is_away = coalesce((v_payload ->> 'is_away')::boolean, is_away),
          daily_lead_limit = case when v_payload ? 'daily_lead_limit'
            then nullif(v_payload ->> 'daily_lead_limit', '')::integer else daily_lead_limit end
      where id = v_target.id
      returning * into v_target;
      v_result_version := v_target.version;
      v_result := jsonb_build_object(
        'member_id', v_target.id, 'role', v_target.role, 'status', v_target.status,
        'accepts_assignments', v_target.accepts_assignments, 'is_away', v_target.is_away,
        'daily_lead_limit', v_target.daily_lead_limit
      );

    elsif v_command_name = 'reactivate_organization_member' then
      if v_target.status <> 'inactive' then
        raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
      end if;
      begin
        v_desired_role := coalesce(nullif(v_payload ->> 'role', ''), v_target.role::text)::public.organization_role;
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
      end;
      if v_desired_role = 'owner' or (v_actor.role = 'admin' and v_desired_role = 'admin') then
        raise exception using errcode = '42501', message = 'FORBIDDEN';
      end if;
      update public.organization_members
      set role = v_desired_role, status = 'active', accepts_assignments = coalesce((v_payload ->> 'accepts_assignments')::boolean, true),
          is_away = false, activated_at = coalesce(activated_at, now()), deactivated_at = null
      where id = v_target.id returning * into v_target;
      v_result_version := v_target.version;
      v_result := jsonb_build_object('member_id', v_target.id, 'status', v_target.status, 'role', v_target.role);

    else
      if v_target.id = v_actor.id or v_target.status <> 'active' then
        raise exception using errcode = '42501', message = 'FORBIDDEN';
      end if;
      select (
        exists (select 1 from public.accounts where organization_id = v_organization_id and owner_member_id = v_target.id)
        or exists (select 1 from public.contacts where organization_id = v_organization_id and owner_member_id = v_target.id and status in ('provisional', 'active'))
        or exists (select 1 from public.leads where organization_id = v_organization_id and owner_member_id = v_target.id and status in ('new', 'working', 'qualified'))
        or exists (select 1 from public.opportunities where organization_id = v_organization_id and owner_member_id = v_target.id and status = 'open')
        or exists (select 1 from public.follow_up_tasks where organization_id = v_organization_id and assignee_member_id = v_target.id and status in ('open', 'snoozed'))
        or exists (select 1 from public.message_drafts where organization_id = v_organization_id and owner_member_id = v_target.id and status in ('draft', 'pending_approval', 'approved'))
      ) into v_has_workload;

      if v_has_workload then
        select * into v_replacement from public.organization_members
        where organization_id = v_organization_id
          and id = nullif(v_payload ->> 'replacement_member_id', '')::uuid
          and id <> v_target.id and role = 'sales' and status = 'active'
          and accepts_assignments and not is_away
        for update;
        if not found then
          raise exception using errcode = '22023', message = 'REPLACEMENT_REQUIRED';
        end if;

        insert into public.assignment_history (
          organization_id, lead_id, from_member_id, to_member_id, reason, reason_notes, assigned_by_member_id
        )
        select v_organization_id, id, v_target.id, v_replacement.id, 'reassignment',
          'Member deactivation workload transfer', v_actor.id
        from public.leads
        where organization_id = v_organization_id and owner_member_id = v_target.id
          and status in ('new', 'working', 'qualified');

        update public.accounts set owner_member_id = v_replacement.id
          where organization_id = v_organization_id and owner_member_id = v_target.id;
        get diagnostics v_count = row_count;
        v_counts := v_counts || jsonb_build_object('accounts', v_count);
        update public.contacts set owner_member_id = v_replacement.id
          where organization_id = v_organization_id and owner_member_id = v_target.id and status in ('provisional', 'active');
        get diagnostics v_count = row_count;
        v_counts := v_counts || jsonb_build_object('contacts', v_count);
        update public.leads set owner_member_id = v_replacement.id
          where organization_id = v_organization_id and owner_member_id = v_target.id and status in ('new', 'working', 'qualified');
        get diagnostics v_count = row_count;
        v_counts := v_counts || jsonb_build_object('leads', v_count);
        update public.opportunities set owner_member_id = v_replacement.id
          where organization_id = v_organization_id and owner_member_id = v_target.id and status = 'open';
        get diagnostics v_count = row_count;
        v_counts := v_counts || jsonb_build_object('opportunities', v_count);
        update public.follow_up_tasks set assignee_member_id = v_replacement.id
          where organization_id = v_organization_id and assignee_member_id = v_target.id and status in ('open', 'snoozed');
        get diagnostics v_count = row_count;
        v_counts := v_counts || jsonb_build_object('tasks', v_count);
        update public.message_drafts set owner_member_id = v_replacement.id
          where organization_id = v_organization_id and owner_member_id = v_target.id and status in ('draft', 'pending_approval', 'approved');
        get diagnostics v_count = row_count;
        v_counts := v_counts || jsonb_build_object('drafts', v_count);
      end if;

      update public.organization_members
      set status = 'inactive', accepts_assignments = false, is_away = false, deactivated_at = now()
      where id = v_target.id returning * into v_target;
      v_result_version := v_target.version;
      v_result := jsonb_build_object(
        'member_id', v_target.id, 'status', v_target.status,
        'replacement_member_id', v_replacement.id, 'reassigned', v_counts
      );
    end if;

  elsif v_command_name = 'verify_member_channel_identity' then
    if v_source <> 'system' or v_target_type <> 'organization_member' then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    select * into v_target from public.organization_members
    where organization_id = v_organization_id and id = v_target_id and status = 'active' for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_target.role = 'owner' and v_actor.role <> 'owner'
      or v_target.role = 'admin' and v_actor.role <> 'owner' and v_target.id <> v_actor.id
    then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
    if length(btrim(coalesce(v_payload ->> 'feishu_open_id', ''))) < 3 then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    insert into public.organization_member_channel_identities (
      organization_id, member_id, provider, feishu_open_id, feishu_user_id, external_id, status, verified_at
    ) values (
      v_organization_id, v_target.id, 'feishu_internal', btrim(v_payload ->> 'feishu_open_id'),
      nullif(btrim(v_payload ->> 'feishu_user_id'), ''), btrim(v_payload ->> 'feishu_open_id'), 'verified', now()
    ) on conflict (organization_id, provider, member_id) do update
    set feishu_open_id = excluded.feishu_open_id, feishu_user_id = excluded.feishu_user_id,
        external_id = excluded.external_id, status = 'verified', verified_at = now()
    returning * into v_identity;
    v_result_version := v_identity.version;
    v_owner_member_id := v_target.id;
    v_result := jsonb_build_object(
      'identity_id', v_identity.id, 'member_id', v_target.id, 'provider', v_identity.provider,
      'status', v_identity.status, 'feishu_open_id', v_identity.feishu_open_id,
      'feishu_user_id', v_identity.feishu_user_id
    );

  elsif v_command_name = 'remove_member_channel_identity' then
    select i.* into v_identity from public.organization_member_channel_identities i
    join public.organization_members m on m.organization_id = i.organization_id and m.id = i.member_id
    where i.organization_id = v_organization_id and i.id = v_target_id
      and i.provider = 'feishu_internal'
    for update of i;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    select * into v_target from public.organization_members
      where organization_id = v_organization_id and id = v_identity.member_id;
    if v_actor.role = 'admin' and (v_target.role = 'owner' or (v_target.role = 'admin' and v_target.id <> v_actor.id)) then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    if v_expected_version is not null and v_identity.version <> v_expected_version then
      raise exception using errcode = '40001', message = 'VERSION_CONFLICT';
    end if;
    update public.organization_member_channel_identities
    set status = 'invalid', verified_at = null
    where id = v_identity.id returning * into v_identity;
    v_result_version := v_identity.version;
    v_owner_member_id := v_identity.member_id;
    v_result := jsonb_build_object('identity_id', v_identity.id, 'member_id', v_identity.member_id, 'status', v_identity.status);

  elsif v_command_name = 'retry_outbox_event' then
    select * into v_event from public.outbox_events
    where organization_id = v_organization_id and id = v_target_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
    if v_expected_version is not null and v_event.version <> v_expected_version then
      raise exception using errcode = '40001', message = 'VERSION_CONFLICT';
    end if;
    if v_event.status <> 'dead_letter' then
      raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
    end if;
    update public.outbox_events
    set status = 'pending', attempts = 0, available_at = now(), locked_at = null, locked_by = null,
        completed_at = null, last_error_code = null, last_error_message = null
    where id = v_event.id returning * into v_event;
    v_result_version := v_event.version;
    v_result := jsonb_build_object('outbox_event_id', v_event.id, 'status', v_event.status, 'attempts', v_event.attempts);
  end if;

  insert into public.activities (
    organization_id, owner_member_id, actor_member_id, activity_type, title, metadata, occurred_at
  ) values (
    v_organization_id, v_owner_member_id, v_actor.id, v_command_name,
    replace(initcap(replace(v_command_name, '_', ' ')), 'Feishu', 'Feishu'),
    jsonb_build_object('command_id', v_command_id, 'target_type', v_target_type, 'target_id', v_target_id),
    v_occurred_at
  ) returning id into v_activity_id;

  insert into public.audit_logs (
    organization_id, actor_user_id, actor_member_id, action, target_type, target_id,
    source, command_execution_id, after_state, metadata
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
    'ok', true, 'command_id', v_command_id, 'command_execution_id', v_execution_id,
    'result', v_result, 'latest_version', v_result_version, 'activity_id', v_activity_id,
    'audit_id', v_audit_id, 'outbox_event_ids', jsonb_build_array(v_outbox_id)
  );
  update public.command_executions
  set status = 'succeeded', response = v_result, completed_at = now()
  where id = v_execution_id;
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
end;
$$;

revoke all on function crm.prepare_member_invitation(uuid, uuid, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function crm.fail_member_invitation(uuid, text, text) from public, anon, authenticated;
revoke all on function crm.execute_admin_command(jsonb) from public, anon, authenticated;
grant execute on function crm.prepare_member_invitation(uuid, uuid, text, text, text, text, boolean, text) to service_role;
grant execute on function crm.fail_member_invitation(uuid, text, text) to service_role;
grant execute on function crm.execute_admin_command(jsonb) to service_role;
