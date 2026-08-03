import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import {
  deploymentConfiguration,
  runtimeSecretConfiguration,
} from "@/server/config/runtime-environment";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const databaseUrl = runtimeSecretConfiguration().databaseUrl;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required before opening Prisma.");
  }

  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });
  const prisma = new PrismaClient({ adapter });

  if (deploymentConfiguration().nodeEnvironment !== "production") {
    globalForPrisma.prisma = prisma;
  }

  return prisma;
}
