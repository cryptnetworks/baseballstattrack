import type { AuthorizationService } from "@/server/auth/authorization-service";
import { requireSameOriginValues } from "@/server/auth/request-security";
import type {
  AuthenticatedIdentity,
  Capability,
  ResourceTarget,
} from "@/server/auth/types";

type IdentityResolver = () => Promise<AuthenticatedIdentity>;

export async function authorizeProtectedRequest(
  authenticate: IdentityResolver,
  authorization: AuthorizationService,
  target: ResourceTarget,
  capability: Capability,
) {
  const identity = await authenticate();
  return authorization.authorize(identity, target, capability);
}

export async function authorizeProtectedAction(input: {
  origin: string | null;
  host: string | null;
  authenticate: IdentityResolver;
  authorization: AuthorizationService;
  target: ResourceTarget;
  capability: Capability;
}) {
  requireSameOriginValues(input.origin, input.host);
  return authorizeProtectedRequest(
    input.authenticate,
    input.authorization,
    input.target,
    input.capability,
  );
}
