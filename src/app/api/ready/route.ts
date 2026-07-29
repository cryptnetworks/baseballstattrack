import { NextResponse } from "next/server";

import { getApplicationReadiness } from "@/server/app/readiness-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await getApplicationReadiness();

  return NextResponse.json(readiness, {
    status: readiness.status === "ready" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
