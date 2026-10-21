/**
 * `pnpm db:seed`: loads the deterministic seed world (spec §31) into the
 * LOCAL Supabase stack. Refuses any non-localhost Supabase URL and
 * APP_ENV=production: seed data never reaches a real project.
 *
 * Idempotent: the seeded companies have fixed IDs and are deleted (with all
 * their data, by cascade) and re-created; seeded accounts are reset to
 * SEED_USER_PASSWORD with no MFA factors and their seeded memberships.
 * Dates are relative to the moment of seeding (the customer base itself is
 * identical on every run).
 *
 * Usage: pnpm db:start && pnpm env:local && pnpm db:seed
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/db/types.gen";
import { passwordIssues } from "../../lib/domain/passwords";
import { buildSeedWorld, type SeedWorld } from "./rows";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const password = process.env.SEED_USER_PASSWORD ?? "";

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) || process.env.APP_ENV === "production") {
  console.error("Refusing: the seed only runs against a local Supabase stack. Run `pnpm env:local` first.");
  process.exit(1);
}
if (!serviceKey || !password || passwordIssues(password).length) {
  console.error("SEED_USER_PASSWORD is missing or too weak. Re-run `pnpm env:local` to generate one.");
  process.exit(1);
}

type Client = SupabaseClient<Database>;
const supabase: Client = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });
const BATCH = 1_000;

async function insertAll<T extends keyof Database["public"]["Tables"]>(
  table: T,
  rows: Database["public"]["Tables"][T]["Insert"][],
) {
  for (let i = 0; i < rows.length; i += BATCH) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic table name defeats the typed builder
    const { error } = await (supabase.from(table) as any).insert(rows.slice(i, i + BATCH));
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

async function findUserIds(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1_000 });
    if (error) throw error;
    for (const u of data.users) if (u.email) ids.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 1_000) return ids;
  }
}

async function resetAccounts(world: SeedWorld): Promise<void> {
  const existing = await findUserIds();
  for (const account of world.accounts) {
    let userId = existing.get(account.email);
    const attributes = { password, email_confirm: true, user_metadata: { full_name: account.fullName } };
    if (userId) {
      const { error } = await supabase.auth.admin.updateUserById(userId, attributes);
      if (error) throw error;
      const { data: factors } = await supabase.auth.admin.mfa.listFactors({ userId });
      for (const f of factors?.factors ?? []) await supabase.auth.admin.mfa.deleteFactor({ id: f.id, userId });
    } else {
      const { data, error } = await supabase.auth.admin.createUser({ email: account.email, ...attributes });
      if (error || !data.user) throw error ?? new Error("createUser failed");
      userId = data.user.id;
    }
    const { error: profileError } = await supabase
      .from("profiles")
      .upsert({ user_id: userId, full_name: account.fullName });
    if (profileError) throw profileError;

    // Memberships outside the seeded companies (e.g. from manual testing) are removed too.
    await supabase.from("memberships").delete().eq("user_id", userId);
    if (account.platformAdmin) {
      const { error } = await supabase.from("platform_admins").upsert({ user_id: userId });
      if (error) throw error;
    } else {
      await supabase.from("platform_admins").delete().eq("user_id", userId);
      const { error } = await supabase
        .from("memberships")
        .insert({ user_id: userId, company_id: world.companies[account.company!].id, role: account.role! });
      if (error) throw error;
    }
  }
}

async function main() {
  const started = Date.now();
  const world = buildSeedWorld(new Date());
  const companyIds = world.companies.map((c) => c.id);

  const { error: deleteError } = await supabase.from("companies").delete().in("id", companyIds);
  if (deleteError) throw new Error(`cleanup failed: ${deleteError.message}`);

  await insertAll("companies", world.companies);
  await insertAll("customers", world.customers);
  await insertAll("vehicles", world.vehicles);
  await insertAll("visits", world.visits);
  await insertAll("service_category_mappings", world.serviceCategoryMappings);
  await resetAccounts(world);

  for (const company of world.companies) {
    const count = (rows: { company_id: string }[]) => rows.filter((r) => r.company_id === company.id).length;
    console.log(
      `${company.name}: ${count(world.customers)} customers, ${count(world.vehicles)} vehicles, ${count(world.visits)} visits`,
    );
  }
  console.log(`\nSeeded in ${((Date.now() - started) / 1000).toFixed(1)} s. Accounts (password: SEED_USER_PASSWORD):`);
  for (const a of world.accounts) {
    const where = a.platformAdmin ? "operator, /admin (MFA on first sign-in)" : world.companies[a.company!].name;
    console.log(`  ${a.email.padEnd(30)} ${a.role ?? "platform admin"} · ${where}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
