-- pg_cron schedule for automated stock analysis
-- Prerequisites: pg_cron and pg_net extensions must be enabled in Supabase Dashboard
-- (Database > Extensions > search for "pg_cron" and "pg_net" > Enable)
--
-- IMPORTANT: Replace the placeholders below with your actual values before running.
--   <SUPABASE_URL>       → Your project URL (e.g. https://sejqoigpipnwiyebtvjm.supabase.co)
--   <SERVICE_ROLE_KEY>   → Your service role key (from Supabase Dashboard > Settings > API)
--
-- Run this migration manually in the Supabase SQL Editor (Dashboard > SQL Editor).
-- Do NOT commit real secrets to version control.

-- Enable extensions if not already enabled
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Grant usage so pg_cron can invoke pg_net
grant usage on schema extensions to postgres;

-- Schedule: Mon-Fri at 14:30, 16:30, 18:30, 20:30 UTC
-- (≈ 09:30, 11:30, 13:30, 15:30 ET — covering US market hours)
select cron.schedule(
  'analyze-stocks-weekday',
  '30 14,16,18,20 * * 1-5',
  $$
  select net.http_post(
    url := '<SUPABASE_URL>/functions/v1/analyze-stocks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- To verify the job was created:
-- select * from cron.job;

-- To remove the job later:
-- select cron.unschedule('analyze-stocks-weekday');
