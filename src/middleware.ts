import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const sessionToken = request.cookies.get("session-token")?.value;
  const { pathname } = request.nextUrl;

  // Protect /dashboard and /editor routes
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/editor") || pathname.startsWith("/present")) {
    if (!sessionToken) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      // Save the intended destination to redirect back after login
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
    }
  }

  // Redirect logged-in users away from auth pages
  if (pathname === "/login" || pathname === "/signup") {
    if (sessionToken) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/editor/:path*", "/present/:path*", "/login", "/signup"],
};
