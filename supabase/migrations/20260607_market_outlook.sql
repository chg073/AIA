-- ─────────────────────────────────────────────────────────────────────────────
-- Market & Portfolio Outlook
--   Daily AI-synthesized "should I be buying or sitting on the sidelines"
--   view, combining the SPY market regime with a rollup of the user's
--   active suggestions.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists market_outlooks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,

  -- Market regime snapshot (from SPY)
  market_regime text,                    -- 'bull' | 'bear' | 'transitional'
  spy_price numeric,
  spy_return_ytd numeric,
  spy_return_1y numeric,
  spy_above_sma200 boolean,
  spy_rsi_weekly numeric,

  -- Portfolio aggregation
  buy_signals integer default 0,
  hold_signals integer default 0,
  sell_signals integer default 0,
  watch_signals integer default 0,
  avg_exit_score numeric,
  watchlist_size integer default 0,

  -- AI synthesis
  overall_stance text,                   -- 'deploy_capital' | 'cautious_buy' | 'hold' | 'defensive' | 'reduce_exposure'
  headline text,                          -- 1-line takeaway
  reasoning text,                         -- 2-4 sentences
  top_priorities jsonb default '[]',     -- [{symbol, action, why}]
  cash_recommendation text,               -- 1 sentence on cash level

  created_at timestamptz default now()
);

create index if not exists idx_market_outlooks_user_recent
  on market_outlooks(user_id, created_at desc);

alter table market_outlooks enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Users can read own outlooks' and tablename = 'market_outlooks') then
    create policy "Users can read own outlooks" on market_outlooks for select using (auth.uid() = user_id);
  end if;
end $$;

-- Inserts come from the edge function with the service role key (bypasses RLS).

-- ─── Cron snippet (run manually with your service role key) ─────────────────
-- Schedule the daily market outlook 30 minutes after analyze-stocks finishes.
-- Replace <SERVICE_ROLE_KEY> with your real key and run in the SQL editor:
--
-- select cron.schedule(
--   'market-outlook-daily',
--   '45 21 * * 1-5',
--   $$
--   select net.http_post(
--     url := 'https://sejqoigpipnwiyebtvjm.supabase.co/functions/v1/market-outlook',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body := '{}'::jsonb
--   ) as request_id;
--   $$
-- );
