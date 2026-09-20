-- Development-only deterministic fictional data. Never run this file as a production migration.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner.a@example.test', extensions.crypt('LocalOnly123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'admin.a@example.test', extensions.crypt('LocalOnly123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'manager.a@example.test', extensions.crypt('LocalOnly123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'sales.a1@example.test', extensions.crypt('LocalOnly123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'sales.a2@example.test', extensions.crypt('LocalOnly123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'sales.b1@example.test', extensions.crypt('LocalOnly123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into public.organizations (id, name, slug, is_primary) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '示例企业 A', 'example-org-a', true),
  ('bbbbbbbb-0000-0000-0000-000000000001', '隔离测试企业 B', 'example-org-b', false)
on conflict (id) do nothing;

insert into public.profiles (id, display_name) values
  ('10000000-0000-0000-0000-000000000001', 'Owner A'),
  ('10000000-0000-0000-0000-000000000002', 'Admin A'),
  ('10000000-0000-0000-0000-000000000003', 'Manager A'),
  ('10000000-0000-0000-0000-000000000004', 'Sales A1'),
  ('10000000-0000-0000-0000-000000000005', 'Sales A2'),
  ('20000000-0000-0000-0000-000000000001', 'Sales B1')
on conflict (id) do nothing;

insert into public.organization_members (id, organization_id, user_id, role, status, activated_at) values
  ('aa000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner', 'active', now()),
  ('aa000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'admin', 'active', now()),
  ('aa000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'manager', 'active', now()),
  ('aa000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'sales', 'active', now()),
  ('aa000000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 'sales', 'active', now()),
  ('bb000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'owner', 'active', now())
on conflict (id) do nothing;

insert into public.organization_assignment_settings (organization_id, updated_by_member_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001')
on conflict (organization_id) do nothing;

insert into public.organization_scoring_profiles (id, organization_id, name, profile_version, status, created_by_member_id) values
  ('aa500000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Standard v1', 1, 'active', 'aa000000-0000-0000-0000-000000000001'),
  ('bb500000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Standard v1', 1, 'active', 'bb000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.pipeline_stages (id, organization_id, name, stage_key, position, is_default, is_closed, is_won) values
  ('aa300000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '需求确认', 'discovery', 10, true, false, false),
  ('aa300000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '已成交', 'won', 20, false, true, true),
  ('bb300000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '需求确认', 'discovery', 10, true, false, false)
on conflict (id) do nothing;

insert into public.contacts (id, organization_id, owner_member_id, status, full_name, phone, phone_verified_at) values
  ('aa100000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000004', 'active', '示例客户 A1', '00000000001', now()),
  ('aa100000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000005', 'active', '示例客户 A2', '00000000002', now()),
  ('aa100000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000004', 'active', '示例客户 A3', '00000000004', now()),
  ('bb100000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', 'active', '示例客户 B1', '00000000003', now())
on conflict (id) do nothing;

insert into public.leads (id, organization_id, contact_id, owner_member_id, status, source, need) values
  ('aa200000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000004', 'working', 'internal_manual', '部署 AI 营销系统'),
  ('aa200000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000005', 'new', 'internal_manual', '销售流程自动化'),
  ('aa200000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000003', 'aa000000-0000-0000-0000-000000000004', 'converted', 'internal_manual', '企业知识库与销售协同'),
  ('bb200000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', 'new', 'internal_manual', '隔离测试')
on conflict (id) do nothing;

update public.leads
set converted_at = coalesce(converted_at, now())
where id = 'aa200000-0000-0000-0000-000000000003';

insert into public.channel_connections (organization_id, provider, name, status, capabilities, created_by_member_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'manual', '人工发送', 'active', '{"customer_auto_send":false}', 'aa000000-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'manual', '人工发送', 'active', '{"customer_auto_send":false}', 'bb000000-0000-0000-0000-000000000001')
on conflict (organization_id, provider, name) do nothing;

insert into public.follow_up_tasks (
  id, organization_id, contact_id, lead_id, assignee_member_id, created_by_member_id,
  title, notes, due_at
) values (
  'aa700000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
  'aa100000-0000-0000-0000-000000000001', 'aa200000-0000-0000-0000-000000000001',
  'aa000000-0000-0000-0000-000000000004', 'aa000000-0000-0000-0000-000000000001',
  '确认 AI 落地范围', 'Development-only P0 UI fixture', now() - interval '1 hour'
) on conflict (id) do nothing;

insert into public.message_drafts (
  id, organization_id, contact_id, lead_id, owner_member_id, created_by_member_id,
  provider, status, content
) values (
  'aa600000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
  'aa100000-0000-0000-0000-000000000001', 'aa200000-0000-0000-0000-000000000001',
  'aa000000-0000-0000-0000-000000000004', 'aa000000-0000-0000-0000-000000000001',
  'manual', 'pending_approval', '您好，我们已经整理好 AI 营销系统的首轮落地建议，方便时可以一起确认实施范围。'
) on conflict (id) do nothing;

insert into public.opportunities (
  id, organization_id, contact_id, lead_id, owner_member_id, pipeline_stage_id,
  status, title, amount, currency, expected_close_date
) values (
  'aa400000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
  'aa100000-0000-0000-0000-000000000003', 'aa200000-0000-0000-0000-000000000003',
  'aa000000-0000-0000-0000-000000000004', 'aa300000-0000-0000-0000-000000000001',
  'open', '示例客户 A3 - 企业知识库与销售协同', 120000, 'CNY', current_date + 30
) on conflict (id) do nothing;

insert into public.activities (
  id, organization_id, contact_id, lead_id, owner_member_id, actor_member_id,
  activity_type, title, notes, occurred_at
) values (
  'aa800000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
  'aa100000-0000-0000-0000-000000000001', 'aa200000-0000-0000-0000-000000000001',
  'aa000000-0000-0000-0000-000000000004', 'aa000000-0000-0000-0000-000000000001',
  'development_fixture', '已创建开发验收记录', '仅用于 P0 前端真实渲染测试。', now() - interval '2 hours'
) on conflict (id) do nothing;
