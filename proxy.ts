import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { parseEnv } from "./lib/env/schema";
import { isRealDataReady } from "./lib/real-data-routes";

/**
 * Proxy (Next 16's middleware): refreshes the Supabase session cookie on every
 * request and does the optimistic "signed in?" redirect for protected areas.
 * Real authorization happens in layouts and server actions (requireContext)
 * and in RLS; this is only the first, cheap check (spec §20).
 *
 * In DATA_SOURCE=demo there is no auth at all: the proxy does nothing.
 */
const env = parseEnv(process.env);

const PROTECTED = ["/admin", "/app"];

export async function proxy(request: NextRequest) {
  if (env.DATA_SOURCE !== "supabase") return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // Validates the session with the Auth server and refreshes expiring tokens.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));
  if (!user && isProtected) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(login);
  }
  // Screens still built on the in-memory demo store are not available on
  // real data yet; later slices move them over (lib/real-data-routes.ts).
  if (isProtected && !isRealDataReady(path)) {
    const unavailable = request.nextUrl.clone();
    unavailable.pathname = "/unavailable";
    unavailable.search = "";
    return NextResponse.rewrite(unavailable);
  }
  return response;
}

export const config = {
  // Everything except static assets and image optimisation.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
