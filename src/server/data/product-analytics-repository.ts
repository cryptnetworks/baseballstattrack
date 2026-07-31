import type {
  PrismaClient,
  ProductAnalyticsConsentStatus,
} from "@prisma/client";

export class PrismaProductAnalyticsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  preference(appUserId: string) {
    return this.prisma.productAnalyticsConsent.findUnique({
      where: { appUserId },
    });
  }

  recordPreference(input: {
    appUserId: string;
    status: ProductAnalyticsConsentStatus;
    policyVersion: string;
    changedAt: Date;
    expiresAt: Date | null;
  }) {
    return this.prisma.productAnalyticsConsent.upsert({
      where: { appUserId: input.appUserId },
      update: {
        status: input.status,
        policyVersion: input.policyVersion,
        grantedAt: input.status === "OPTED_IN" ? input.changedAt : null,
        withdrawnAt: input.status === "OPTED_OUT" ? input.changedAt : null,
        expiresAt: input.expiresAt,
      },
      create: {
        appUserId: input.appUserId,
        status: input.status,
        policyVersion: input.policyVersion,
        grantedAt: input.status === "OPTED_IN" ? input.changedAt : null,
        withdrawnAt: input.status === "OPTED_OUT" ? input.changedAt : null,
        expiresAt: input.expiresAt,
      },
    });
  }

  deletePreference(appUserId: string) {
    return this.prisma.productAnalyticsConsent.deleteMany({
      where: { appUserId },
    });
  }
}
