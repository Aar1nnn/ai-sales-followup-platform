begin;
select plan(8);

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}';
select is((select count(*)::integer from public.leads), 2, 'Sales A1 sees only assigned leads');
select is((select count(*)::integer from public.leads where organization_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 0, 'Sales A1 cannot see organization B');
select is((select count(*)::integer from public.contacts), 2, 'Sales A1 sees only assigned contacts');
select is((select count(*)::integer from public.channel_connections), 0, 'Sales cannot read channel connection metadata');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}';
select is((select count(*)::integer from public.leads where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 3, 'Manager A sees organization A sales leads');
select is((select count(*)::integer from public.leads where organization_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 0, 'Manager A cannot see organization B');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*)::integer from public.channel_connections where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1, 'Owner can see connection metadata');
select throws_ok(
  $$update public.leads set notes = 'direct browser write' where id = 'aa200000-0000-0000-0000-000000000001'$$,
  '42501',
  'permission denied for table leads',
  'browser core write is denied before RLS write evaluation'
);

select * from finish();
rollback;
