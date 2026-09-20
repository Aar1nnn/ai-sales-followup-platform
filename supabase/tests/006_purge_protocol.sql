begin;
select plan(7);
set local role service_role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role","aal":"aal2"}';

insert into public.organizations (
  id, name, slug, is_primary, status, deletion_requested_at, deletion_scheduled_at
) values (
  'cccccccc-0000-0000-0000-000000000003', '待清除企业', 'purge-test', false,
  'pending_deletion', now() - interval '31 days', now() - interval '1 day'
);

insert into public.organization_members (
  id, organization_id, user_id, role, status, activated_at
) values (
  'cc100000-0000-0000-0000-000000000001',
  'cccccccc-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000001',
  'sales', 'active', now()
);

insert into public.organization_purge_jobs (
  organization_id, status, current_phase, scheduled_at
) values (
  'cccccccc-0000-0000-0000-000000000003', 'scheduled', 'storage', now() - interval '1 day'
);

select throws_ok(
  $$select crm.purge_organization_step('cccccccc-0000-0000-0000-000000000003', false, 100, false)$$,
  '55000', 'VALIDATION_ERROR', 'purge cannot advance before storage is cleared'
);

select is(
  crm.purge_organization_step('cccccccc-0000-0000-0000-000000000003', true, 100, false) ->> 'next_phase',
  'inbound',
  'storage phase advances only after explicit confirmation'
);

select crm.purge_organization_step('cccccccc-0000-0000-0000-000000000003', true, 100, false);
select crm.purge_organization_step('cccccccc-0000-0000-0000-000000000003', true, 100, false);
select crm.purge_organization_step('cccccccc-0000-0000-0000-000000000003', true, 100, false);
select crm.purge_organization_step('cccccccc-0000-0000-0000-000000000003', true, 100, false);
select crm.purge_organization_step('cccccccc-0000-0000-0000-000000000003', true, 100, false);
select crm.purge_organization_step('cccccccc-0000-0000-0000-000000000003', true, 100, false);
select crm.purge_organization_step('cccccccc-0000-0000-0000-000000000003', true, 100, false);

select is(
  crm.purge_organization_step('cccccccc-0000-0000-0000-000000000003', true, 100, false) ->> 'status',
  'waiting_auth_cleanup',
  'database pauses before deleting organization settings'
);
select ok(
  exists (select 1 from public.organizations where id = 'cccccccc-0000-0000-0000-000000000003'),
  'organization still exists while auth cleanup is pending'
);
select is(
  (
    select cursor -> 'auth_user_ids'
    from public.organization_purge_jobs
    where organization_id = 'cccccccc-0000-0000-0000-000000000003'
  ),
  '[]'::jsonb,
  'shared auth user is excluded from deletion list'
);

select is(
  crm.purge_organization_step('cccccccc-0000-0000-0000-000000000003', true, 100, true) ->> 'status',
  'completed',
  'purge completes after auth cleanup confirmation'
);
select ok(
  not exists (select 1 from public.organizations where id = 'cccccccc-0000-0000-0000-000000000003')
    and exists (select 1 from public.organization_tombstones where organization_name_hash is not null),
  'organization is removed and content-free tombstone remains'
);

select * from finish();
rollback;
