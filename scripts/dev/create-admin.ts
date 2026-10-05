/**
 * Creates (or promotes) a platform admin on the LOCAL Supabase stack.
 * Refuses any non-localhost Supabase URL: production admins are created by
 * hand in the Supabase dashboard, never by a script.
 *
 * Usage: pnpm admin:create <email> <password> ["Full Name"]
 * The admin enrols TOTP MFA on first sign-in (spec §20).
 */
import { createClient } from "@supabase/supabase-js";
import { passwordIssues } from "../../lib/domain/passwords";

const [email, password, fullName = "Operátor"] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error("Refusing: NEXT_PUBLIC_SUPABASE_URL is not a local Supabase. Run `pnpm env:local` first.");
  process.exit(1);
}
if (!email || !password) {
  console.error('Usage: pnpm admin:create <email> <password> ["Full Name"]');
  process.exit(1);
}
const issues = passwordIssues(password);
if (issues.length) {
  console.error(`Password rejected: ${issues.join(", ")} (min. 12 characters, letters and digits).`);
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

async function main() {
  let userId: string | undefined;
  const created = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.data.user) {
    userId = created.data.user.id;
  } else if (created.error?.code === "email_exists") {
    const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  } else {
    throw created.error;
  }
  if (!userId) throw new Error("user not found");
  const { error } = await supabase.from("platform_admins").upsert({ user_id: userId });
  if (error) throw error;
  console.log(`Platform admin ready: ${email}. Sign in at http://localhost:3001/login and set up MFA.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
