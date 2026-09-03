import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";

export const dynamic = "force-dynamic";

/**
 * Campaign short links: /r/{token} → 302 to the campaign's target URL.
 * The click is attributed server-side; link previews never count.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const client = new ConvexHttpClient(convexUrl);
  const resolved = await client.query(api.trackedLinks.resolve, { token });
  if (!resolved) return new NextResponse("Not found", { status: 404 });
  try {
    await client.mutation(api.trackedLinks.recordClick, {
      token,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
  } catch {
    // Attribution must never block the patient from reaching the page.
  }
  return NextResponse.redirect(resolved.targetUrl, { status: 302 });
}
