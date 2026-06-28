import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { message } = await request.json();
    // Prints directly to the server terminal console running npm run dev
    console.log(`[UPLOADER] ${message}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "Failed to print log" }, { status: 500 });
  }
}
