import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "../../env";
import type { Database } from "../types.gen";

/**
 * Supabase client bound to the signed-in user's session cookies. Every tenant
 * read and mutation from server components and server actions goes through
 * this client, so RLS is always enforced (spec §26, §38).
 */
export async function createSupabaseServerClient() {
  const store = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a server component: cookies are read-only there. The
          // proxy refreshes the session on the next request instead.
        }
      },
    },
  });
}
