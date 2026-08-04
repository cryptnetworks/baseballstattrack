export type HostPlatform = "macos" | "windows" | "nixos" | "linux";

export type DeploymentMode = "local" | "team" | "production" | "recovery";

export type AuthenticationProvider =
  "authentik" | "google" | "discord" | "facebook" | "apple";

export type ProviderBootstrap = Readonly<{
  provider: AuthenticationProvider;
  clientId: string;
  clientSecret?: string;
  issuerUrl?: string;
  teamId?: string;
  keyId?: string;
  privateKey?: string;
}>;

export type InstallerAnswers = Readonly<{
  mode: DeploymentMode;
  siteUrl: string;
  timezone: string;
  appPort: number;
  bindAddress: "127.0.0.1" | "0.0.0.0";
  databaseName: string;
  databaseUser: string;
  accountDisplayName: string;
  accountSlug: string;
  provider: ProviderBootstrap;
  generateSecrets: true;
  imageTag: string;
  buildLocalImages: boolean;
}>;

export type GeneratedSecrets = Readonly<{
  databasePassword: string;
  authenticationEncryptionKey: string;
  webhookSigningMasterKey: string;
  webhookWorkerToken: string;
  externalIngestionWorkerToken: string;
  calendarFeedSigningKey: string;
  notificationWorkerToken: string;
  notificationEventToken: string;
  discordUpdateEventToken: string;
  discordUpdateWorkerToken: string;
}>;

export type GeneratedDeploymentConfiguration = Readonly<{
  composeEnvironment: Readonly<Record<string, string>>;
  applicationEnvironment: Readonly<Record<string, string>>;
  secrets: GeneratedSecrets;
}>;

export type InstallationMetadata = Readonly<{
  schemaVersion: 1;
  projectName: string;
  mode: DeploymentMode;
  siteUrl: string;
  timezone: string;
  appPort: number;
  accountDisplayName: string;
  accountSlug: string;
  administratorProvider: AuthenticationProvider;
  imageTag: string;
  createdAt: string;
  updatedAt: string;
}>;

export type CommandResult = Readonly<{
  status: number;
  stdout: string;
  stderr: string;
}>;

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: Readonly<{
    cwd?: string;
    input?: string;
    environment?: Readonly<Record<string, string | undefined>>;
  }>,
) => Promise<CommandResult>;

export type RequirementCheck = Readonly<{
  name: "Docker" | "Docker daemon" | "Compose" | "Disk space" | "Ports";
  ok: boolean;
  detail: string;
}>;
