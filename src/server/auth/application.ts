import { AuthorizationService } from "@/server/auth/authorization-service";
import { PrismaAuthorizationStore } from "@/server/auth/store";
import { getPrismaClient } from "@/server/data/prisma";

export function getAuthorizationService() {
  return new AuthorizationService(
    new PrismaAuthorizationStore(getPrismaClient()),
  );
}
