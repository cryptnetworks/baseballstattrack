import { z } from "zod";

import {
  DEFAULT_APPLICATION_CONFIGURATION,
  applicationIdentitySchema,
} from "@/domain/application-configuration";
import { getAuthorizationService } from "@/server/auth/application";
import { type AuthenticatedIdentity } from "@/server/auth/types";
import { getLocalAuthenticationService } from "@/server/app/local-authentication-service";
import { getOAuthAuthenticationService } from "@/server/app/oauth-authentication-service";
import { getApplicationConfigurationService } from "@/server/app/application-configuration-service";
import { getApplicationReadiness } from "@/server/app/readiness-service";
import {
  InstallationSetupError,
  PrismaInstallationSetupRepository,
  type InstallationSetupView,
} from "@/server/data/installation-setup-repository";
import { getPrismaClient } from "@/server/data/prisma";

const accountNameSchema = z.string().trim().min(1).max(160);
const accountSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export type InstallationSetupChecks = Readonly<{
  database: boolean;
  migrations: boolean;
  administrator: boolean;
  authentication: boolean;
  configuration: boolean;
  services: boolean;
}>;

export type InstallationSetupSnapshot = Readonly<{
  setup: InstallationSetupView | null;
  checks: InstallationSetupChecks;
  nextAction:
    | "DEPLOYMENT"
    | "SIGN_IN"
    | "CREATE_ACCOUNT"
    | "CONFIGURE_IDENTITY"
    | "VERIFY_READINESS"
    | "COMPLETE"
    | "ADMIN_PORTAL";
}>;

export class InstallationSetupService {
  private ready = false;

  constructor(
    private readonly repository: PrismaInstallationSetupRepository,
    private readonly readiness = getApplicationReadiness,
  ) {}

  async snapshot(): Promise<InstallationSetupSnapshot> {
    const setup = await this.repository.get();
    const checks = await this.checks(setup);
    let nextAction: InstallationSetupSnapshot["nextAction"] = "DEPLOYMENT";
    if (setup?.status === "READY") nextAction = "ADMIN_PORTAL";
    else if (!setup) nextAction = "DEPLOYMENT";
    else if (
      setup.status === "NOT_STARTED" ||
      setup.status === "BOOTSTRAP_IN_PROGRESS"
    )
      nextAction = "SIGN_IN";
    else if (!setup.accountId) nextAction = "CREATE_ACCOUNT";
    else if (!checks.configuration) nextAction = "CONFIGURE_IDENTITY";
    else if (
      !checks.database ||
      !checks.migrations ||
      !checks.authentication ||
      !checks.services
    )
      nextAction = "VERIFY_READINESS";
    else nextAction = "COMPLETE";
    return Object.freeze({ setup, checks, nextAction });
  }

  async begin() {
    return this.repository.begin();
  }

  async isReady() {
    if (this.ready) return true;
    const setup = await this.repository.get();
    this.ready = setup?.status === "READY";
    return this.ready;
  }

  async bootstrap(identity: AuthenticatedIdentity, inputValue: unknown) {
    const input = z
      .object({
        accountName: accountNameSchema,
        accountSlug: accountSlugSchema,
      })
      .strict()
      .parse(inputValue);
    return this.repository.bootstrap({ identity, ...input });
  }

  async configure(identity: AuthenticatedIdentity, inputValue: unknown) {
    const input = z
      .object({
        accountId: z.string().trim().min(1).max(128),
        identity: applicationIdentitySchema,
      })
      .strict()
      .parse(inputValue);
    const setup = await this.repository.get();
    if (
      !setup ||
      setup.status !== "ADMIN_CREATED" ||
      setup.accountId !== input.accountId
    )
      throw new InstallationSetupError(
        "NOT_AVAILABLE",
        "Installation setup is unavailable.",
      );
    const actor = await getAuthorizationService().authorize(
      identity,
      { kind: "ACCOUNT", accountId: input.accountId },
      "configuration.manage",
    );
    const current = await getApplicationConfigurationService().runtime(
      input.accountId,
    );
    const values = {
      ...DEFAULT_APPLICATION_CONFIGURATION,
      ...current.values,
      identity: input.identity,
    };
    if (current.revision > 0) {
      await getApplicationConfigurationService().save(
        {
          accountId: input.accountId,
          expectedRevision: current.revision,
          reason: "Establish application identity during first launch setup",
          values,
        },
        actor,
      );
    } else {
      await getApplicationConfigurationService().seedInitial(
        {
          accountId: input.accountId,
          reason: "Initialize application identity during first launch setup",
          values,
        },
        actor,
      );
    }
    return this.repository.markConfigurationRequired(input.accountId);
  }

  async complete(identity: AuthenticatedIdentity) {
    const setup = await this.repository.get();
    if (!setup?.accountId || setup.status === "READY") {
      if (setup?.status === "READY") return setup;
      throw new InstallationSetupError(
        "NOT_AVAILABLE",
        "Installation setup is unavailable.",
      );
    }
    const actor = await getAuthorizationService().authorize(
      identity,
      { kind: "ACCOUNT", accountId: setup.accountId },
      "configuration.manage",
    );
    const snapshot = await this.snapshot();
    if (Object.values(snapshot.checks).some((value) => !value))
      throw new InstallationSetupError(
        "INVALID_STATE",
        "Deployment readiness checks must pass before setup can be completed.",
      );
    const completed = await this.repository.complete({
      accountId: setup.accountId,
      completedById: actor.appUserId,
    });
    this.ready = completed.status === "READY";
    return completed;
  }

  private async checks(
    setup: InstallationSetupView | null,
  ): Promise<InstallationSetupChecks> {
    const readiness = await this.readiness();
    let authentication = false;
    try {
      authentication =
        getLocalAuthenticationService().enabled() ||
        getOAuthAuthenticationService().providers().length > 0;
    } catch {
      authentication = false;
    }
    let configuration = false;
    let administrator = false;
    if (setup?.accountId && setup.bootstrapUserId) {
      try {
        const current = await getApplicationConfigurationService().runtime(
          setup.accountId,
        );
        configuration =
          current.revision > 0 &&
          current.values.identity.installationName.length > 0;
        administrator = Boolean(
          await getPrismaClient().accountMembership.findFirst({
            where: {
              accountId: setup.accountId,
              userId: setup.bootstrapUserId,
              status: "ACTIVE",
              roleAssignments: { some: { role: "OWNER", revokedAt: null } },
            },
            select: { id: true },
          }),
        );
      } catch {
        configuration = false;
        administrator = false;
      }
    }
    return Object.freeze({
      database: readiness.checks.database,
      migrations: readiness.checks.migration,
      administrator,
      authentication,
      configuration,
      services: readiness.checks.schema && readiness.checks.configuration,
    });
  }
}

let singleton: InstallationSetupService | undefined;
export function getInstallationSetupService() {
  singleton ??= new InstallationSetupService(
    new PrismaInstallationSetupRepository(getPrismaClient()),
  );
  return singleton;
}
