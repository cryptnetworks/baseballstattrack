import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { selectDiscordAccount } from "@/app/discord/actions";
import { ApplicationShell } from "@/components/app/application-shell";
import { DiscordChannelRoutingPanel } from "@/components/discord/discord-channel-routing-panel";
import { DiscordCadencePanel } from "@/components/discord/discord-cadence-panel";
import { DiscordSettingsFeedback } from "@/components/discord/discord-settings-feedback";
import { DiscordSettingsShell } from "@/components/discord/discord-settings-shell";
import { DiscordTrackedScopesPanel } from "@/components/discord/discord-tracked-scopes-panel";
import { discordSettingsSectionSchema } from "@/domain/discord-settings-navigation";
import { getDiscordInstallationService } from "@/server/app/discord-installation-service";
import { getDiscordChannelRoutingService } from "@/server/app/discord-channel-routing-service";
import { getDiscordCadenceService } from "@/server/app/discord-cadence-service";
import { getDiscordTrackedScopesService } from "@/server/app/discord-tracked-scopes-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

async function loadDiscordWorkspace(requestedServer: string | undefined) {
  let identity;
  try {
    identity = await authenticatePageSession();
  } catch (error) {
    if (error instanceof AuthorizationError) redirect("/login");
    throw error;
  }
  const authorization = getAuthorizationService();
  const candidates = await authorization.listAvailableAccounts(identity);
  const authorizedAccounts = (
    await Promise.all(
      candidates.map(async (account) => {
        try {
          const actor = await authorization.authorize(
            identity,
            { kind: "ACCOUNT", accountId: account.id },
            "discord.settings.view",
          );
          return { account, actor };
        } catch (error) {
          if (
            error instanceof AuthorizationError &&
            (error.code === "NO_ACTIVE_MEMBERSHIP" ||
              error.code === "INSUFFICIENT_CAPABILITY" ||
              error.code === "ACCOUNT_UNAVAILABLE")
          ) {
            return null;
          }
          throw error;
        }
      }),
    )
  ).filter((candidate) => candidate !== null);
  const accounts = authorizedAccounts.map(({ account }) => account);
  if (accounts.length === 0) {
    return {
      accounts,
      selectedAccountId: null,
      installations: [],
      selectedInstallationId: null,
      invalidServerSelection: false,
      actor: null,
    };
  }
  const selectedCookie = (await cookies()).get(
    selectedAccountCookie.name,
  )?.value;
  const selected =
    authorizedAccounts.find(({ account }) => account.id === selectedCookie) ??
    authorizedAccounts[0]!;
  const selectedAccount = selected.account;
  const installations = await getDiscordInstallationService().list(
    selectedAccount.id,
    selected.actor,
  );
  const requested = requestedServer
    ? installations.find(({ id }) => id === requestedServer)
    : undefined;
  const fallback =
    installations.find(({ status }) => status === "ACTIVE") ?? installations[0];
  return {
    accounts,
    selectedAccountId: selectedAccount.id,
    installations,
    selectedInstallationId: (requested ?? fallback)?.id ?? null,
    invalidServerSelection: Boolean(requestedServer && !requested),
    actor: selected.actor,
  };
}

export default async function DiscordSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ server?: string; notice?: string; error?: string }>;
}) {
  const path = (await params).section ?? [];
  const parsedSection = discordSettingsSectionSchema.safeParse(
    path[0] ?? "overview",
  );
  if (!parsedSection.success || path.length > 1) notFound();
  const search = await searchParams;
  const requestedServer = search.server;
  const workspace = await loadDiscordWorkspace(requestedServer);
  const channelWorkspace =
    parsedSection.data === "channels" &&
    workspace.selectedAccountId &&
    workspace.selectedInstallationId &&
    workspace.actor
      ? await getDiscordChannelRoutingService().get(
          workspace.selectedAccountId,
          workspace.selectedInstallationId,
          workspace.actor,
        )
      : null;
  const trackedScopesWorkspace =
    parsedSection.data === "teams" &&
    workspace.selectedAccountId &&
    workspace.selectedInstallationId &&
    workspace.actor
      ? await getDiscordTrackedScopesService().get(
          workspace.selectedAccountId,
          workspace.selectedInstallationId,
          workspace.actor,
        )
      : null;
  const cadenceWorkspace =
    parsedSection.data === "updates" &&
    workspace.selectedAccountId &&
    workspace.selectedInstallationId &&
    workspace.actor
      ? await getDiscordCadenceService().get(
          workspace.selectedAccountId,
          workspace.selectedInstallationId,
          workspace.actor,
        )
      : null;

  return (
    <ApplicationShell>
      <DiscordSettingsShell
        accounts={workspace.accounts}
        installations={workspace.installations}
        section={parsedSection.data}
        selectAccountAction={selectDiscordAccount}
        selectedAccountId={workspace.selectedAccountId}
        selectedInstallationId={workspace.selectedInstallationId}
      >
        {workspace.invalidServerSelection ||
        channelWorkspace ||
        trackedScopesWorkspace ||
        cadenceWorkspace ? (
          <div>
            {workspace.invalidServerSelection ? (
              <div className="mt-6">
                <DiscordSettingsFeedback
                  errors={[
                    {
                      fieldId: "discord-server",
                      message:
                        "That Discord server is unavailable for this Account. A safe available server is selected instead.",
                    },
                  ]}
                  state="validation-error"
                />
              </div>
            ) : null}
            {channelWorkspace ? (
              <DiscordChannelRoutingPanel
                accountId={workspace.selectedAccountId!}
                channels={channelWorkspace.channels}
                destinations={
                  channelWorkspace.configuration.settings.destinations
                }
                {...(search.error ? { error: search.error } : {})}
                installationId={workspace.selectedInstallationId!}
                lastVerifiedAt={channelWorkspace.lastVerifiedAt}
                messageFormat={
                  channelWorkspace.configuration.settings.messageFormat
                }
                missingPermissions={channelWorkspace.missingPermissions}
                {...(search.notice ? { notice: search.notice } : {})}
                permissionEvidenceStale={
                  channelWorkspace.permissionEvidenceStale
                }
                revision={channelWorkspace.configuration.settings.revision}
              />
            ) : null}
            {trackedScopesWorkspace ? (
              <DiscordTrackedScopesPanel
                accountId={workspace.selectedAccountId!}
                {...(search.error ? { error: search.error } : {})}
                installationId={workspace.selectedInstallationId!}
                {...(search.notice ? { notice: search.notice } : {})}
                revision={
                  trackedScopesWorkspace.configuration.settings.revision
                }
                scopes={trackedScopesWorkspace.scopes}
                selectedCount={trackedScopesWorkspace.selectedCount}
                staleSelectedCount={trackedScopesWorkspace.staleSelectedCount}
              />
            ) : null}
            {cadenceWorkspace ? (
              <DiscordCadencePanel
                accountId={workspace.selectedAccountId!}
                {...(search.error ? { error: search.error } : {})}
                installationId={workspace.selectedInstallationId!}
                {...(search.notice ? { notice: search.notice } : {})}
                settings={cadenceWorkspace.settings}
              />
            ) : null}
          </div>
        ) : undefined}
      </DiscordSettingsShell>
    </ApplicationShell>
  );
}
