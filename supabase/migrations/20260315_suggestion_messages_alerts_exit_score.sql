-- suggestion_messages: conversation threads on suggestions
create table if not exists suggestion_messages (
  id uuid default gen_random_uuid() primary key,
  suggestion_id uuid references suggestions(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

create index if not exists idx_suggestion_messages_suggestion
  on suggestion_messages(suggestion_id);

alter table suggestion_messages enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Users can read own messages' and tablename = 'suggestion_messages') then
    create policy "Users can read own messages" on suggestion_messages for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can insert own messages' and tablename = 'suggestion_messages') then
    create policy "Users can insert own messages" on suggestion_messages for insert with check (auth.uid() = user_id);
  end if;
end $$;

-- exit score columns on suggestions
alter table suggestions add column if not exists exit_score integer default 0;
alter table suggestions add column if not exists exit_score_details jsonb default '{}';
alter table suggestions add column if not exists options_strategy jsonb default null;

-- alerts table
create table if not exists alerts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  symbol text not null,
  alert_type text not null check (alert_type in (
    'price_target_hit', 'stop_loss_hit', 'exit_score_high',
    'action_changed', 'options_expiry_warning'
  )),
  title text not null,
  message text not null,
  metadata jsonb default '{}',
  is_read boolean default false,
  email_sent boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_alerts_user
  on alerts(user_id, created_at desc);

alter table alerts enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Users can read own alerts' and tablename = 'alerts') then
    create policy "Users can read own alerts" on alerts for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can update own alerts' and tablename = 'alerts') then
    create policy "Users can update own alerts" on alerts for update using (auth.uid() = user_id);
  end if;
end $$;

-- alert preferences on profiles
alter table profiles add column if not exists alert_preferences jsonb
  default '{"exit_score_threshold": 61, "options_expiry_days": 7}';
