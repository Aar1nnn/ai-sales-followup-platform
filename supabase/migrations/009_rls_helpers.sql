create or replace function public.current_organization_member_id(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.organization_id = p_organization_id
    and m.user_id = auth.uid()
    and m.status = 'active'
    and o.status <> 'deleted'
  limit 1
$$;

create or replace function public.is_active_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_organization_member_id(p_organization_id) is not null
$$;

create or replace function public.organization_role(p_organization_id uuid)
returns public.organization_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1
$$;

create or replace function public.can_administer_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.organization_role(p_organization_id) in ('owner', 'admin'), false)
$$;

create or replace function public.can_manage_sales(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.organization_role(p_organization_id) in ('owner', 'admin', 'manager'), false)
$$;

create or replace function public.can_access_assigned_record(p_organization_id uuid, p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_sales(p_organization_id)
    or (
      public.organization_role(p_organization_id) = 'sales'
      and p_member_id = public.current_organization_member_id(p_organization_id)
    )
$$;

create or replace function public.is_active_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_organization_id and o.status = 'active'
  )
$$;

create or replace function public.can_access_contact(p_organization_id uuid, p_contact_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.contacts c
    where c.organization_id = p_organization_id
      and c.id = p_contact_id
      and public.can_access_assigned_record(p_organization_id, c.owner_member_id)
  )
$$;

create or replace function public.can_access_lead(p_organization_id uuid, p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.leads l
    where l.organization_id = p_organization_id
      and l.id = p_lead_id
      and public.can_access_assigned_record(p_organization_id, l.owner_member_id)
  )
$$;

create or replace function public.can_access_opportunity(p_organization_id uuid, p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.opportunities o
    where o.organization_id = p_organization_id
      and o.id = p_opportunity_id
      and public.can_access_assigned_record(p_organization_id, o.owner_member_id)
  )
$$;

create or replace function public.can_access_account(p_organization_id uuid, p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_sales(p_organization_id)
    or exists (
      select 1 from public.accounts a
      where a.organization_id = p_organization_id
        and a.id = p_account_id
        and a.owner_member_id = public.current_organization_member_id(p_organization_id)
    )
    or exists (
      select 1 from public.contacts c
      where c.organization_id = p_organization_id
        and c.account_id = p_account_id
        and c.owner_member_id = public.current_organization_member_id(p_organization_id)
    )
$$;

revoke all on function public.current_organization_member_id(uuid) from public;
revoke all on function public.is_active_org_member(uuid) from public;
revoke all on function public.organization_role(uuid) from public;
revoke all on function public.can_administer_organization(uuid) from public;
revoke all on function public.can_manage_sales(uuid) from public;
revoke all on function public.can_access_assigned_record(uuid, uuid) from public;
revoke all on function public.is_active_organization(uuid) from public;
revoke all on function public.can_access_contact(uuid, uuid) from public;
revoke all on function public.can_access_lead(uuid, uuid) from public;
revoke all on function public.can_access_opportunity(uuid, uuid) from public;
revoke all on function public.can_access_account(uuid, uuid) from public;

grant execute on function public.current_organization_member_id(uuid) to authenticated, service_role;
grant execute on function public.is_active_org_member(uuid) to authenticated, service_role;
grant execute on function public.organization_role(uuid) to authenticated, service_role;
grant execute on function public.can_administer_organization(uuid) to authenticated, service_role;
grant execute on function public.can_manage_sales(uuid) to authenticated, service_role;
grant execute on function public.can_access_assigned_record(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_active_organization(uuid) to authenticated, service_role;
grant execute on function public.can_access_contact(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_access_lead(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_access_opportunity(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_access_account(uuid, uuid) to authenticated, service_role;
