import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Let client-side Firebase Auth handle route protection dynamically.
  // This avoids cookie synchronization delay and Secure cookie issues over local HTTP.
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/editor/:path*", "/present/:path*", "/login", "/signup"],
};
