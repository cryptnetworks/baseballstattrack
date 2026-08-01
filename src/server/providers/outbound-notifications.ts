import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";

import {
  NotificationProviderError,
  notificationChannels,
  type NotificationChannel,
  type NotificationDestinationResolver,
  type NotificationMessage,
  type NotificationTransport,
} from "@/domain/notifications";

const destinationConfigurationSchema = z.record(
  z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u),
  z.discriminatedUnion("channel", [
    z.object({ channel: z.literal("EMAIL"), destination: z.email() }).strict(),
    z
      .object({
        channel: z.literal("DISCORD"),
        destination: z.string().regex(/^\d{2,32}$/u),
      })
      .strict(),
  ]),
);

function providerUrl(value: string, name: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(`${name} must be an HTTPS URL without credentials.`);
  }
  return url;
}

export class ConfiguredNotificationDestinationResolver implements NotificationDestinationResolver {
  private readonly destinations: z.infer<typeof destinationConfigurationSchema>;
  private readonly enabledChannels: ReadonlySet<NotificationChannel>;

  constructor(
    encodedConfiguration: string,
    enabledChannels: readonly NotificationChannel[] = notificationChannels,
  ) {
    this.destinations = destinationConfigurationSchema.parse(
      JSON.parse(encodedConfiguration),
    );
    this.enabledChannels = new Set(enabledChannels);
  }

  resolve(reference: string, expectedChannel: NotificationChannel) {
    const destination = this.destinations[reference];
    if (
      !this.enabledChannels.has(expectedChannel) ||
      !destination ||
      destination.channel !== expectedChannel
    ) {
      throw new NotificationProviderError("DESTINATION_UNAVAILABLE", false);
    }
    return destination;
  }
}

type Fetch = typeof fetch;
type Mailer = Pick<Transporter, "sendMail">;

export type SmtpConfiguration = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
}>;

export class ConfiguredNotificationTransport implements NotificationTransport {
  private readonly discordApiBase: URL | null;
  private readonly mailer: Mailer | null;

  constructor(
    private readonly configuration: {
      smtp: SmtpConfiguration | null;
      discord: { apiBase: string; token: string } | null;
    },
    private readonly fetcher: Fetch = fetch,
    mailer?: Mailer,
  ) {
    this.discordApiBase = configuration.discord
      ? providerUrl(
          configuration.discord.apiBase,
          "NOTIFICATION_DISCORD_API_BASE_URL",
        )
      : null;
    if (configuration.discord && configuration.discord.token.length < 16) {
      throw new Error("Discord notification credentials are unavailable.");
    }
    this.mailer = configuration.smtp
      ? (mailer ??
        nodemailer.createTransport({
          host: configuration.smtp.host,
          port: configuration.smtp.port,
          secure: configuration.smtp.secure,
          auth: {
            user: configuration.smtp.username,
            pass: configuration.smtp.password,
          },
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 15_000,
        }))
      : null;
  }

  async send(input: {
    channel: NotificationChannel;
    destination: string;
    idempotencyKey: string;
    message: NotificationMessage;
    timeoutMs: number;
  }) {
    if (!notificationChannels.includes(input.channel)) {
      throw new NotificationProviderError("DESTINATION_UNAVAILABLE", false);
    }
    if (input.channel === "EMAIL") return this.sendEmail(input);
    return this.sendDiscord(input);
  }

  private async sendEmail(input: {
    destination: string;
    idempotencyKey: string;
    message: NotificationMessage;
  }) {
    const smtp = this.configuration.smtp;
    if (!smtp || !this.mailer) {
      throw new NotificationProviderError("DESTINATION_UNAVAILABLE", false);
    }
    try {
      await this.mailer.sendMail({
        from: smtp.from,
        to: input.destination,
        subject: input.message.subject,
        text: input.message.text,
        messageId: `<${input.idempotencyKey}@baseballstattrack.local>`,
        headers: { "X-Baseball-Stat-Track-Delivery": input.idempotencyKey },
      });
      return { status: 250 };
    } catch (error) {
      const smtpError = error as { code?: string; responseCode?: number };
      if (smtpError.code === "EAUTH") {
        throw new NotificationProviderError("AUTHENTICATION_FAILED", false);
      }
      if (
        smtpError.responseCode === 421 ||
        (smtpError.responseCode !== undefined &&
          smtpError.responseCode >= 450 &&
          smtpError.responseCode <= 452) ||
        ["ECONNECTION", "ESOCKET", "ETIMEDOUT"].includes(smtpError.code ?? "")
      ) {
        throw new NotificationProviderError("PROVIDER_UNAVAILABLE", true);
      }
      throw new NotificationProviderError("DESTINATION_UNAVAILABLE", false);
    }
  }

  private async sendDiscord(input: {
    destination: string;
    idempotencyKey: string;
    message: NotificationMessage;
    timeoutMs: number;
  }) {
    if (!this.configuration.discord || !this.discordApiBase) {
      throw new NotificationProviderError("DESTINATION_UNAVAILABLE", false);
    }
    const url = new URL(
      `channels/${encodeURIComponent(input.destination)}/messages`,
      this.discordApiBase.toString().replace(/\/?$/u, "/"),
    );
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.configuration.discord.token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "User-Agent": "BaseballStatTrack-Notifications/1",
        },
        body: JSON.stringify({
          content: `**${input.message.subject}**\n${input.message.text}`,
          nonce: input.idempotencyKey,
          enforce_nonce: true,
          allowed_mentions: { parse: [] },
        }),
        signal: AbortSignal.timeout(input.timeoutMs),
      });
    } catch {
      throw new NotificationProviderError("PROVIDER_UNAVAILABLE", true);
    }

    if (response.status >= 200 && response.status < 300) {
      return { status: response.status };
    }
    if (response.status === 401 || response.status === 403) {
      throw new NotificationProviderError(
        "AUTHENTICATION_FAILED",
        false,
        response.status,
      );
    }
    if (response.status === 429) {
      throw new NotificationProviderError(
        "RATE_LIMITED",
        true,
        response.status,
      );
    }
    if (response.status >= 500 || response.status === 408) {
      throw new NotificationProviderError(
        "PROVIDER_UNAVAILABLE",
        true,
        response.status,
      );
    }
    throw new NotificationProviderError(
      "DESTINATION_UNAVAILABLE",
      false,
      response.status,
    );
  }
}
