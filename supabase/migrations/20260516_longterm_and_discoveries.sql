-- ─────────────────────────────────────────────────────────────────────────────
-- Long-term focus migration:
--   1. New `discoveries` table — AI-curated stock ideas the user isn't yet watching.
--   2. Updated cron schedules:
--        - analyze-stocks → once daily after US market close (was every 2h)
--        - discover-stocks → once weekly (new, weekend morning UTC)
--
-- IMPORTANT: cron schedules at the bottom use placeholders for SUPABASE_URL and
-- SERVICE_ROLE_KEY. Replace them and re-run the schedule blocks in the Supabase
-- SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── discoveries table ──────────────────────────────────────────────────────
create table if not exists discoveries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  symbol text not null,
  company_name text,
  current_price numeric,
  market_cap numeric,

  -- Momentum metrics
  return_1m numeric,
  return_3m numeric,
  return_6m numeric,
  return_1y numeric,
  return_3y numeric,
  return_ytd numeric,
  rsi_weekly numeric,
  distance_from_52w_high numeric,    -- e.g. -0.05 means 5% below the 52w high
  volume_surge_ratio numeric,         -- recent 30d avg volume / 1y avg volume
  momentum_score numeric,             -- 0–100 composite score

  -- AI curation
  ai_thesis text,                     -- 2–3 sentences: why this stock is interesting
  ai_risk text,                       -- 1 sentence: key risks
  ai_recommended boolean default false,
  ai_horizon text,                    -- e.g. "6–24 months"

  source text,                         -- which screener surfaced the symbol
  status text default 'new' check (status in ('new', 'added', 'dismissed')),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists idx_discoveries_user_symbol
  on discoveries(user_id, symbol);

create index if not exists idx_discoveries_user_status
  on discoveries(user_id, status, momentum_score desc);

alter table discoveries enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Users can read own discoveries' and tablename = 'discoveries') then
    create policy "Users can read own discoveries" on discoveries for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can update own discoveries' and tablename = 'discoveries') then
    create policy "Users can update own discoveries" on discoveries for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can delete own discoveries' and tablename = 'discoveries') then
    create policy "Users can delete own discoveries" on discoveries for delete using (auth.uid() = user_id);
  end if;
end $$;

-- Inserts come from the edge function with the service role key, which bypasses
-- RLS, so we don't need an insert policy here.

-- ─── Make suggestions live longer (was 4h; now 7 days) ──────────────────────
-- Nothing to change in the schema — the edge function & analyze API now write
-- a 7d expires_at, but old rows will simply expire on their original schedule.

-- ─── Cron rescheduling ──────────────────────────────────────────────────────
-- 1) Replace the old every-2-hours job with a single daily run after US close.
-- 2) Add a weekly discover-stocks job.
-- (Both blocks are commented because they require your real SUPABASE_URL and
-- SERVICE_ROLE_KEY. Uncomment and substitute before running.)

-- Remove the old schedule (safe to run even if it doesn't exist)
do $$ begin
  perform cron.unschedule('analyze-stocks-weekday');
exception when others then null;
end $$;

-- -- Daily long-term analysis: 21:15 UTC Mon–Fri ≈ 16:15 ET (15 min after close)
-- select cron.schedule(
--   'analyze-stocks-longterm',
--   '15 21 * * 1-5',
--   $$
--   select net.http_post(
--     url := '<SUPABASE_URL>/functions/v1/analyze-stocks',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body := '{}'::jsonb
--   ) as request_id;
--   $$
-- );
--
-- -- Weekly discovery: Saturday 13:00 UTC (market closed, AI has fresh weekly close data)
-- select cron.schedule(
--   'discover-stocks-weekly',
--   '0 13 * * 6',
--   $$
--   select net.http_post(
--     url := '<SUPABASE_URL>/functions/v1/discover-stocks',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body := '{}'::jsonb
--   ) as request_id;
--   $$
-- );
