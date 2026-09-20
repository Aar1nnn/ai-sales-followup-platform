create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create schema if not exists crm;

create type public.organization_status as enum (
  'active', 'suspended', 'pending_deletion', 'purging', 'deleted', 'purge_failed'
);
create type public.organization_role as enum ('owner', 'admin', 'manager', 'sales');
create type public.member_status as enum ('invited', 'active', 'inactive');
create type public.contact_status as enum ('provisional', 'active', 'merged', 'archived');
create type public.lead_status as enum ('new', 'working', 'qualified', 'disqualified', 'converted', 'archived');
create type public.opportunity_status as enum ('open', 'won', 'lost', 'cancelled');
create type public.task_status as enum ('open', 'snoozed', 'completed', 'cancelled');
create type public.assignment_strategy as enum ('round_robin', 'least_open_tasks', 'manager_manual');
create type public.assignment_reason as enum ('automatic', 'manual', 'reassignment', 'fallback');
create type public.provider_code as enum (
  'manual', 'feishu_internal', 'wecom_internal', 'wecom_customer_contact',
  'wechat_customer_service', 'email', 'whatsapp_business'
);
create type public.connection_status as enum ('draft', 'validating', 'active', 'invalid', 'disabled');
create type public.message_direction as enum ('inbound', 'outbound');
create type public.message_draft_status as enum ('draft', 'pending_approval', 'approved', 'rejected', 'sent', 'cancelled');
create type public.message_status as enum ('recorded', 'sent', 'delivered', 'failed');
create type public.manual_channel as enum ('personal_wechat', 'wecom_manual', 'phone', 'sms_manual', 'email_manual', 'other');
create type public.message_outcome as enum ('no_reply', 'replied', 'interested', 'not_interested', 'converted', 'invalid');
create type public.inbound_event_status as enum ('accepted', 'duplicate', 'processing', 'processed', 'failed', 'expired');
create type public.command_status as enum ('processing', 'succeeded', 'failed');
create type public.outbox_status as enum ('pending', 'processing', 'completed', 'dead_letter');
create type public.automation_run_status as enum ('running', 'succeeded', 'failed', 'dead_letter');
create type public.score_status as enum ('complete', 'incomplete', 'failed');
create type public.priority_level as enum ('high', 'medium_high', 'medium', 'low');
create type public.purge_job_status as enum ('scheduled', 'running', 'completed', 'failed', 'cancelled');

comment on schema crm is 'Non-browser transactional command and automation RPC schema.';
