export interface DiscordUpdateSchedulerEnvironment {
  DISCORD_UPDATE_WORKER_TOKEN?: string;
  DISCORD_UPDATE_WORKER_ID?: string;
  DISCORD_UPDATE_WORKER_BASE_URL?: string;
  DISCORD_UPDATE_WORKER_INTERVAL_SECONDS?: string;
  DISCORD_UPDATE_WORKER_TIMEOUT_SECONDS?: string;
  DISCORD_UPDATE_WORKER_HEALTH_HOST?: string;
  DISCORD_UPDATE_WORKER_HEALTH_PORT?: string;
}

export interface DiscordUpdateSchedulerConfiguration {
  token: string;
  workerId: string;
  endpoint: URL;
  intervalMs: number;
  timeoutMs: number;
  healthHost: string;
  healthPort: number;
}

export function readConfiguration(
  environment?: DiscordUpdateSchedulerEnvironment,
): DiscordUpdateSchedulerConfiguration;

export function startScheduler(
  configuration?: DiscordUpdateSchedulerConfiguration,
): Promise<() => Promise<void>>;
