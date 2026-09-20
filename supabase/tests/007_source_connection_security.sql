begin;
select plan(6);
set local role service_role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role","aal":"aal2"}';

create temporary table source_test_ids (connection_id uuid);
insert into source_test_ids
select (crm.configure_source_connection(
  'aaaaaaaa-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  null,
  'generic_webhook',
  '安全测试入口',
  null,
  '{"paths":{"contact.name":"customer.name"}}'::jsonb,
  '{"verified_identity_fields":["email"]}'::jsonb,
  30,
  65536,
  '{"hmac_secret":"fake-source-secret-for-test"}'
) ->> 'connection_id')::uuid;

select is(
  (select status::text from public.lead_source_connections where id = (select connection_id from source_test_ids)),
  'active',
  'source connection is activated through server-only configuration RPC'
);
select ok(
  (select secret_ref is not null and secret_ref like 'source:%' from public.lead_source_connections where id = (select connection_id from source_test_ids)),
  'business table stores only a Vault reference'
);
select is(
  (select decrypted_secret from vault.decrypted_secrets where name = (
    select secret_ref from public.lead_source_connections where id = (select connection_id from source_test_ids)
  )),
  '{"hmac_secret":"fake-source-secret-for-test"}',
  'Vault contains the connection credential'
);
select ok(
  not exists (
    select 1 from public.command_executions
    where target_id = (select connection_id from source_test_ids)
      and request_payload::text like '%fake-source-secret-for-test%'
  ),
  'command execution does not contain plaintext source secret'
);
select ok(
  not exists (
    select 1 from public.audit_logs
    where target_id = (select connection_id from source_test_ids)
      and (after_state::text || metadata::text) like '%fake-source-secret-for-test%'
  ),
  'audit log does not contain plaintext source secret'
);
select is(
  (select count(*)::integer from public.outbox_events where aggregate_id = (select connection_id from source_test_ids) and event_type = 'source.connection.configured'),
  1,
  'source configuration emits one outbox event'
);

select * from finish();
rollback;
