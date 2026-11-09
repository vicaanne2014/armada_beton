import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isConfigured, supabaseKey, supabaseUrl } from "./env";

/** Menyegarkan sesi Supabase dan memaksa login. Hanya pemeriksaan optimistis; otorisasi sebenarnya di RLS + RPC. */
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!isConfigured()) {
    if (path === "/setup") return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl(), supabaseKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  if (!signedIn && path !== "/login") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (signedIn && (path === "/login" || path === "/setup")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return response;
}
