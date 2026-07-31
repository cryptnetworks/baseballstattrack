import { z } from "zod";

import { PrivacyLifecycleError } from "@/domain/privacy-lifecycle";
import { getPrivacyLifecycleService } from "@/server/app/privacy-lifecycle-service";
import { getAuthorizationService } from "@/server/auth/application";
import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { requireSameOrigin } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

const accountIdSchema = z.string().trim().min(1).max(128);
const artifactIdSchema = z.string().trim().min(1).max(128);
const prepareSchema = z
  .object({
    accountId: accountIdSchema,
    clientRequestId: z.string().trim().min(1).max(128),
  })
  .strict();

async function exportActor(request: Request, accountId: string) {
  return authorizeProtectedRequest(
    () => authenticateRouteRequest(request),
    getAuthorizationService(),
    { kind: "ACCOUNT", accountId },
    "report.export",
  );
}

function accessInput(request: Request) {
  const url = new URL(request.url);
  return {
    accountId: accountIdSchema.parse(url.searchParams.get("accountId")),
    artifactId: artifactIdSchema.parse(url.searchParams.get("artifactId")),
    token: z
      .string()
      .min(32)
      .max(256)
      .parse(request.headers.get("x-export-token")),
  };
}

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: "The export request is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof PrivacyLifecycleError) {
    return Response.json(
      { error: "The export is unavailable." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { error: safeAuthorizationMessage(error) },
    {
      status: safeAuthorizationStatus(error),
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = prepareSchema.parse(await request.json());
    const actor = await exportActor(request, input.accountId);
    const prepared = await getPrivacyLifecycleService().prepareExport(
      input,
      actor,
    );
    return Response.json(prepared, {
      status: 201,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const input = accessInput(request);
    const actor = await exportActor(request, input.accountId);
    const artifact = await getPrivacyLifecycleService().downloadExport(
      input,
      actor,
    );
    return new Response(artifact.bytes as BodyInit, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Export-Checksum": artifact.checksum,
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const input = accessInput(request);
    const actor = await exportActor(request, input.accountId);
    await getPrivacyLifecycleService().cancelExport(input, actor);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
