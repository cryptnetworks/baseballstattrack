import { Prisma, type PrismaClient } from "@prisma/client";

import { AuthorizationService } from "@/server/auth/authorization-service";
import { PrismaAuthorizationStore } from "@/server/auth/store";
import type {
  AuthenticatedIdentity,
  Capability,
  ResourceTarget,
  TrustedActorContext,
} from "@/server/auth/types";

export async function runAuthorizedTransaction<Result>(
  prisma: PrismaClient,
  identity: AuthenticatedIdentity,
  target: ResourceTarget,
  capability: Capability,
  operation: (
    transaction: Prisma.TransactionClient,
    actor: TrustedActorContext,
  ) => Promise<Result>,
): Promise<Result> {
  // Provision outside the serializable authorization transaction. A unique-key
  // conflict aborts an interactive PostgreSQL transaction, preventing a safe
  // reread of the winning row inside that transaction.
  await new PrismaAuthorizationStore(prisma).resolveOrProvisionUser(identity);
  return prisma.$transaction(
    async (transaction) => {
      const authorization = new AuthorizationService(
        new PrismaAuthorizationStore(transaction),
      );
      const actor = await authorization.authorize(identity, target, capability);
      return operation(transaction, actor);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
