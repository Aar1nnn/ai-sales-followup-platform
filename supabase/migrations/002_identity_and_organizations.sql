create table public.organizations (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  status public.organization_status not null default 'active',
  is_primary boolean not null default true,
  timezone text not null default 'Asia/Shanghai',
  locale text not null default 'zh-CN',
  default_currency text not null default 'CNY' check (default_currency ~ '^[A-Z]{3}$'),
  deletion_requested_at timestamptz,
  deletion_scheduled_at timestamptz,
  deletion_cancelled_at timestamptz,
  deletion_requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  unique (slug),
  check (
    (status = 'pending_deletion' and deletion_requested_at is not null and deletion_scheduled_at is not null)
    or status <> 'pending_deletion'
  )
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  phone text,
  job_title text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0)
);

create table public.organization_members (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role public.organization_role not null,
  status public.member_status not null default 'invited',
  accepts_assignments boolean not null default true,
  is_away boolean not null default false,
  daily_lead_limit integer check (daily_lead_limit is null or daily_lead_limit >= 0),
  last_assigned_at timestamptz,
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  unique (organization_id, user_id),
  unique (organization_id, id)
);

comment on table public.profiles is 'Authentication-linked identity only. Organization role lives exclusively in organization_members.';
