begin;
select plan(19);

set local role service_role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role","aal":"aal2"}';

select has_schema('crm', 'crm schema exists');
select has_table('public', 'organizations', 'organizations exists');
select has_table('public', 'command_executions', 'command executions exists');
select has_table('public', 'outbox_events', 'outbox exists');
select has_column('public', 'leads', 'organization_id', 'leads are organization scoped');
select has_column('public', 'leads', 'version', 'leads have optimistic version');
select has_index('public', 'organizations', 'organizations_one_active_primary_idx', 'one primary organization index exists');
select has_index('public', 'organization_members', 'organization_members_one_active_owner_idx', 'one active owner index exists');

select is(
  (
    select p.provolatile::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'crm'
      and p.proname = 'calculate_standard_v1_score'
      and pg_get_function_identity_arguments(p.oid) = 'p_dimensions jsonb'
  ),
  's',
  'standard v1 scoring function uses stable volatility'
);

select is(
  crm.calculate_standard_v1_score(
    '{
      "need_clarity":{"status":"known","score":20},
      "budget_fit":{"status":"known","score":10},
      "decision_authority":{"status":"unknown","score":null},
      "urgency":{"status":"known","score":15},
      "customer_fit":{"status":"known","score":15},
      "engagement":{"status":"known","score":10}
    }'::jsonb
  ) ->> 'known_weight',
  '85',
  'unknown dimensions do not count as zero'
);
select is(
  crm.calculate_standard_v1_score(
    '{
      "need_clarity":{"status":"known","score":20},
      "budget_fit":{"status":"known","score":10},
      "decision_authority":{"status":"unknown","score":null},
      "urgency":{"status":"known","score":15},
      "customer_fit":{"status":"known","score":15},
      "engagement":{"status":"known","score":10}
    }'::jsonb
  ) ->> 'normalized_score',
  '82.35',
  'known score is normalized over known weight'
);

select throws_ok(
  $$select crm.calculate_standard_v1_score('{"need_clarity":{"status":"known","score":21}}'::jsonb)$$,
  '22023', 'VALIDATION_ERROR', 'invalid scoring evidence is rejected'
);

select throws_ok(
  $$select crm.derive_standard_v1_dimensions(null, 'aa200000-0000-0000-0000-000000000001', 'aa500000-0000-0000-0000-000000000001')$$,
  '22023', 'VALIDATION_ERROR', 'missing extracted evidence is rejected'
);

select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'leads'),
  4,
  'leads has separate CRUD policies'
);

update public.organization_scoring_profiles set
  minimum_viable_budget = 5000,
  target_budget_min = 10000,
  target_budget_max = 50000,
  target_industries = array['软件'],
  target_company_sizes = array['50-200'],
  target_regions = array['华东'],
  target_use_cases = array['AI 营销'],
  target_buyer_roles = array['销售负责人']
where id = 'aa500000-0000-0000-0000-000000000001';

create temporary table deterministic_score_test (dimensions jsonb);
insert into deterministic_score_test
select crm.derive_standard_v1_dimensions(
  '{
    "need_clarity":{"status":"known","level":"detailed","evidence":"明确要求部署营销跟进系统","score":0},
    "budget_fit":{"status":"known","amount":20000,"evidence":"预算 2 万","score":0},
    "decision_authority":{"status":"known","level":"decision_maker","role":"销售负责人","evidence":"本人负责决策","score":0},
    "urgency":{"status":"known","timeframe_days":7,"evidence":"一周内启动","score":0},
    "customer_fit":{"status":"known","industry":"软件","company_size":"50-200","region":"华东","use_case":"AI 营销","buyer_role":"销售负责人","signals":[],"excluded_signal":false,"evidence":"ICP 字段完整","score":0},
    "engagement":{"status":"known","level":"high","evidence":"已主动预约演示","score":0}
  }'::jsonb,
  'aa200000-0000-0000-0000-000000000001',
  'aa500000-0000-0000-0000-000000000001'
);

select is(
  (select dimensions #>> '{need_clarity,score}' from deterministic_score_test),
  '20',
  'database derives need score and ignores AI numeric score'
);
select is(
  (select dimensions #>> '{customer_fit,score}' from deterministic_score_test),
  '15.00',
  'database compares customer facts with organization ICP profile'
);
select is(
  crm.calculate_standard_v1_score((select dimensions from deterministic_score_test)) ->> 'total_score',
  '100.00',
  'deterministic dimensions produce the final normalized score'
);

select lives_ok(
  $$select crm.execute_command('{
    "command_id":"10000000-0000-4000-a000-000000000099",
    "idempotency_key":"test:deterministic-score:1",
    "command_name":"record_lead_score",
    "organization_id":"aaaaaaaa-0000-0000-0000-000000000001",
    "actor_user_id":"10000000-0000-0000-0000-000000000001",
    "target_type":"lead",
    "target_id":"aa200000-0000-0000-0000-000000000001",
    "expected_version":null,
    "source":"n8n",
    "occurred_at":"2026-08-05T12:00:00Z",
    "payload":{
      "extracted_evidence":{
        "need_clarity":{"status":"known","level":"detailed","evidence":"明确要求部署营销跟进系统"},
        "budget_fit":{"status":"known","amount":20000,"evidence":"预算 2 万"},
        "decision_authority":{"status":"known","level":"decision_maker","role":"销售负责人","evidence":"本人负责决策"},
        "urgency":{"status":"known","timeframe_days":7,"evidence":"一周内启动"},
        "customer_fit":{"status":"known","industry":"软件","company_size":"50-200","region":"华东","use_case":"AI 营销","buyer_role":"销售负责人","signals":[],"excluded_signal":false,"evidence":"ICP 字段完整"},
        "engagement":{"status":"known","level":"high","evidence":"已主动预约演示"}
      },
      "dimension_scores":{"need_clarity":{"status":"known","score":0}},
      "confidence":0.9,
      "missing_information":[],
      "recommended_next_action":"人工确认并跟进",
      "ai_provider":"test_provider",
      "ai_model":"test_model",
      "input_tokens":10,
      "output_tokens":20,
      "latency_ms":30,
      "prompt_version":"standard_v1-evidence-test",
      "reason":"pgTap deterministic scoring"
    }
  }'::jsonb)$$,
  'record score command accepts evidence without trusting AI scores'
);
select is(
  (select dimension_scores #>> '{need_clarity,score}' from public.lead_scores where ai_model = 'test_model'),
  '20',
  'stored score is database-derived rather than copied from AI payload'
);

select * from finish();
rollback;
