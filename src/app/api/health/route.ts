import { NextResponse } from "next/server";

import { getApplicationStatus } from "@/server/app/status-service";

export function GET() {
  return NextResponse.json(getApplicationStatus());
}
