import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/db/supabase/server-client";

/**
 * Landing route for links in Supabase Auth emails (password recovery). The
 * Czech template sends ?token_hash&type; the PKCE ?code variant is accepted
 * too. A valid link signs the user in and continues to `next`.
 */
const TYPES: EmailOtpType[] = ["recovery", "email", "email_change", "invite", "magiclink", "signup"];

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNextPath(url.searchParams.get("next"), "/login");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const supabase = await createSupabaseServerClient();

  let ok = false;
  if (tokenHash && type && TYPES.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }
  return NextResponse.redirect(new URL(ok ? next : "/reset-password", url.origin));
}
