# Restore drill log

Appended by `pnpm db:restore-drill` (local) and by hand after each quarterly production drill (spec §30): restore the latest dump into a fresh project, compare row counts, check RLS, run the RLS test suite.

| When (UTC)               | Target                           | Result | Detail                | Duration |
| ------------------------ | -------------------------------- | ------ | --------------------- | -------- |
| 2026-11-05T16:38:37.503Z | local stack (supabase_db_navrat) | PASS   | 27 tables, 36728 rows | 5 s      |
| 2026-11-05T17:06:10.450Z | local stack (supabase_db_navrat) | PASS   | 27 tables, 36747 rows | 5 s      |
| 2026-11-05T19:07:20.364Z | local stack (supabase_db_navrat) | PASS | 28 tables, 36759 rows | 34 s |
