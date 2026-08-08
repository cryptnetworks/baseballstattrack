import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  InstallationSetupStatus,
  type PrismaClient,
} from "@prisma/client";

import type { AuthenticatedIdentity } from "@/server/auth/types";
import { requireInstallationSetupTransition } from "@/domain/installation-setup";

export const INSTALLATION_SETUP_ID = "installation";

const setupSelect = {
  id: true,
  status: true,
  accountId: true,
  bootstrapUserId: true,
  completedAt: true,
  completedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type InstallationSetupView = Readonly<{
  id: string;
  status: InstallationSetupStatus;
  accountId: string | null;
  bootstrapUserId: string | null;
  completedAt: Date | null;
  completedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export class InstallationSetupError extends Error {
  constructor(
    readonly code: "NOT_AVAILABLE" | "INVALID_STATE" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "InstallationSetupError";
  }
}

function view(row: InstallationSetupView): InstallationSetupView {
  return Object.freeze({ ...row });
}

export class PrismaInstallationSetupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get() {
    const row = await this.prisma.installationSetup.findUnique({
      where: { id: INSTALLATION_SETUP_ID },
      select: setupSelect,
    });
    return row ? view(row) : null;
  }

  async begin(now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1::integer FROM pg_advisory_xact_lock(hashtextextended('installation-setup', 0))`;
      const current = await tx.installationSetup.findUnique({
        where: { id: INSTALLATION_SETUP_ID },
        select: setupSelect,
      });
      if (!current)
        throw new InstallationSetupError(
          "NOT_FOUND",
          "Installation setup has not been initialized by migrations.",
        );
      if (current.status === InstallationSetupStatus.READY)
        return view(current);
      if (current.status !== InstallationSetupStatus.NOT_STARTED)
        return view(current);
      requireInstallationSetupTransition(
        current.status,
        InstallationSetupStatus.BOOTSTRAP_IN_PROGRESS,
      );
      return view(
        await tx.installationSetup.update({
          where: { id: INSTALLATION_SETUP_ID },
          data: {
            status: InstallationSetupStatus.BOOTSTRAP_IN_PROGRESS,
            updatedAt: now,
          },
          select: setupSelect,
        }),
      );
    });
  }

  async bootstrap(input: {
    identity: AuthenticatedIdentity;
    accountName: string;
    accountSlug: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1::integer FROM pg_advisory_xact_lock(hashtextextended('installation-setup', 0))`;
      const setup = await tx.installationSetup.findUnique({
        where: { id: INSTALLATION_SETUP_ID },
        select: setupSelect,
      });
      if (!setup)
        throw new InstallationSetupError(
          "NOT_FOUND",
          "Installation setup has not been initialized by migrations.",
        );
      if (setup.status === InstallationSetupStatus.READY)
        throw new InstallationSetupError(
          "NOT_AVAILABLE",
          "Installation setup is already complete.",
        );
      if (setup.status === InstallationSetupStatus.NOT_STARTED)
        throw new InstallationSetupError(
          "INVALID_STATE",
          "Start installation setup before bootstrapping the administrator.",
        );

      const user = await tx.appUser.findUnique({
        where: {
          provider_providerSubject: {
            provider: input.identity.provider,
            providerSubject: input.identity.providerSubject,
          },
        },
        select: { id: true, status: true },
      });
      if (!user || user.status !== "ACTIVE")
        throw new InstallationSetupError(
          "NOT_AVAILABLE",
          "Sign in with a configured provider before bootstrapping the administrator.",
        );
      if (
        setup.status === InstallationSetupStatus.ADMIN_CREATED ||
        setup.status === InstallationSetupStatus.CONFIGURATION_REQUIRED
      ) {
        if (setup.bootstrapUserId !== user.id || !setup.accountId)
          throw new InstallationSetupError(
            "NOT_AVAILABLE",
            "The installation administrator has already been established.",
          );
        return {
          setup: view(setup),
          accountId: setup.accountId,
          appUserId: user.id,
        };
      }
      if (setup.status !== InstallationSetupStatus.BOOTSTRAP_IN_PROGRESS)
        throw new InstallationSetupError(
          "INVALID_STATE",
          "Installation setup is not ready for administrator bootstrap.",
        );
      requireInstallationSetupTransition(
        setup.status,
        InstallationSetupStatus.ADMIN_CREATED,
      );

      let accountId = setup.accountId;
      let membershipId: string | null = null;
      if (accountId) {
        const membership = await tx.accountMembership.findFirst({
          where: { accountId, userId: user.id },
          select: { id: true },
        });
        membershipId = membership?.id ?? null;
      }
      if (!membershipId) {
        const existingMembership = await tx.accountMembership.findFirst({
          where: {
            userId: user.id,
            status: "ACTIVE",
            account: { status: "ACTIVE" },
            roleAssignments: {
              some: { role: "OWNER", scope: "ACCOUNT", revokedAt: null },
            },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, accountId: true },
        });
        if (existingMembership) {
          accountId = existingMembership.accountId;
          membershipId = existingMembership.id;
        }
      }
      if (!accountId) {
        const existingAccount = await tx.account.findUnique({
          where: { slug: input.accountSlug },
          select: { id: true },
        });
        if (existingAccount)
          throw new InstallationSetupError(
            "NOT_AVAILABLE",
            "That Account slug already exists and cannot be claimed during bootstrap.",
          );
        const account = await tx.account.create({
          data: {
            slug: input.accountSlug,
            displayName: input.accountName,
          },
          select: { id: true },
        });
        accountId = account.id;
      }
      if (!membershipId) {
        const membership = await tx.accountMembership.create({
          data: {
            accountId,
            userId: user.id,
            status: "ACTIVE",
            activatedAt: now,
          },
          select: { id: true },
        });
        membershipId = membership.id;
      } else {
        await tx.accountMembership.update({
          where: { id: membershipId },
          data: {
            status: "ACTIVE",
            activatedAt: now,
            disabledAt: null,
            removedAt: null,
          },
        });
      }
      const ownerExists = await tx.membershipRoleAssignment.findFirst({
        where: {
          accountId,
          membershipId,
          role: "OWNER",
          scope: "ACCOUNT",
          revokedAt: null,
        },
        select: { id: true },
      });
      if (!ownerExists)
        await tx.membershipRoleAssignment.create({
          data: {
            id: `${membershipId}-owner`,
            accountId,
            membershipId,
            role: "OWNER",
            scope: "ACCOUNT",
          },
        });

      const updated = await tx.installationSetup.update({
        where: { id: INSTALLATION_SETUP_ID },
        data: {
          status: InstallationSetupStatus.ADMIN_CREATED,
          accountId,
          bootstrapUserId: user.id,
          updatedAt: now,
        },
        select: setupSelect,
      });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId,
          actorKind: ActorKind.USER,
          actorId: user.id,
          actorUserId: user.id,
          action: "installation_setup.admin_bootstrap",
          capability: "account.manage",
          targetType: "INSTALLATION_SETUP",
          targetId: INSTALLATION_SETUP_ID,
          outcome: AuditOutcome.SUCCEEDED,
          metadata: { provider: input.identity.provider },
          createdAt: now,
        },
      });
      return { setup: view(updated), accountId, appUserId: user.id };
    });
  }

  async markConfigurationRequired(accountId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1::integer FROM pg_advisory_xact_lock(hashtextextended('installation-setup', 0))`;
      const current = await tx.installationSetup.findUnique({
        where: { id: INSTALLATION_SETUP_ID },
        select: setupSelect,
      });
      if (!current || current.accountId !== accountId)
        throw new InstallationSetupError(
          "INVALID_STATE",
          "The initial Account is not associated with this installation.",
        );
      if (current.status === InstallationSetupStatus.READY)
        return view(current);
      if (
        current.status !== InstallationSetupStatus.ADMIN_CREATED &&
        current.status !== InstallationSetupStatus.CONFIGURATION_REQUIRED
      )
        throw new InstallationSetupError(
          "INVALID_STATE",
          "Bootstrap the administrator before configuring the installation.",
        );
      requireInstallationSetupTransition(
        current.status,
        InstallationSetupStatus.CONFIGURATION_REQUIRED,
      );
      return view(
        await tx.installationSetup.update({
          where: { id: INSTALLATION_SETUP_ID },
          data: {
            status: InstallationSetupStatus.CONFIGURATION_REQUIRED,
            updatedAt: now,
          },
          select: setupSelect,
        }),
      );
    });
  }

  async complete(input: {
    accountId: string;
    completedById: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1::integer FROM pg_advisory_xact_lock(hashtextextended('installation-setup', 0))`;
      const current = await tx.installationSetup.findUnique({
        where: { id: INSTALLATION_SETUP_ID },
        select: setupSelect,
      });
      if (!current || current.accountId !== input.accountId)
        throw new InstallationSetupError(
          "INVALID_STATE",
          "The initial Account is not associated with this installation.",
        );
      if (current.status === InstallationSetupStatus.READY)
        return view(current);
      if (current.status !== InstallationSetupStatus.CONFIGURATION_REQUIRED)
        throw new InstallationSetupError(
          "INVALID_STATE",
          "Complete the required configuration before finishing setup.",
        );
      requireInstallationSetupTransition(
        current.status,
        InstallationSetupStatus.READY,
      );
      const updated = await tx.installationSetup.update({
        where: { id: INSTALLATION_SETUP_ID },
        data: {
          status: InstallationSetupStatus.READY,
          completedAt: now,
          completedById: input.completedById,
          updatedAt: now,
        },
        select: setupSelect,
      });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind: ActorKind.USER,
          actorId: input.completedById,
          actorUserId: input.completedById,
          action: "installation_setup.completed",
          capability: "configuration.manage",
          targetType: "INSTALLATION_SETUP",
          targetId: INSTALLATION_SETUP_ID,
          outcome: AuditOutcome.SUCCEEDED,
          createdAt: now,
        },
      });
      return view(updated);
    });
  }
}
