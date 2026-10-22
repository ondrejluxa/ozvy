-- Jobs run as service_role and update customers and companies, whose guard
-- triggers call app.is_end_user() / app.is_platform_admin(). service_role had
-- no usage on schema app, so every job update hit "permission denied for
-- schema app" (found by supabase/tests/database/06_imports.test.sql).
grant usage on schema app to service_role;
grant execute on all functions in schema app to service_role;
alter default privileges in schema app grant execute on functions to service_role;
