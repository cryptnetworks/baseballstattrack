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

  constructor(encodedConfiguration: string) {
    this.destinations = destinationConfigurationSchema.parse(
      JSON.parse(encodedConfiguration),
    );
  }

  resolve(reference: string, expectedChannel: NotificationChannel) {
    const destination = this.destinations[reference];
    if (!destination || destination.channel !== expectedChannel) {
      throw new NotificationProviderError("DESTINATION_UNAVAILABLE", false);
    }
    return destination;
  }
}

type Fetch = typeof fetch;

export class HttpNotificationTransport implements NotificationTransport {
  private readonly emailEndpoint: URL;
  private readonly discordApiBase: URL;

  constructor(
    emailEndpoint: string,
    private readonly emailToken: string,
    discordApiBase: string,
    private readonly discordToken: string,
    private readonly fetcher: Fetch = fetch,
  ) {
    this.emailEndpoint = providerUrl(
      emailEndpoint,
      "NOTIFICATION_EMAIL_PROVIDER_URL",
    );
    this.discordApiBase = providerUrl(
      discordApiBase,
      "NOTIFICATION_DISCORD_API_BASE_URL",
    );
    if (emailToken.length < 16 || discordToken.length < 16) {
      throw new Error("Notification provider credentials are unavailable.");
    }
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
    const request =
      input.channel === "EMAIL"
        ? {
            url: this.emailEndpoint,
            token: `Bearer ${this.emailToken}`,
            body: {
              to: input.destination,
              subject: input.message.subject,
              text: input.message.text,
              idempotencyKey: input.idempotencyKey,
            },
          }
        : {
            url: new URL(
              `channels/${encodeURIComponent(input.destination)}/messages`,
              this.discordApiBase.toString().replace(/\/?$/u, "/"),
            ),
            token: `Bot ${this.discordToken}`,
            body: {
              content: `**${input.message.subject}**\n${input.message.text}`,
              nonce: input.idempotencyKey,
              enforce_nonce: true,
              allowed_mentions: { parse: [] },
            },
          };

    let response: Response;
    try {
      response = await this.fetcher(request.url, {
        method: "POST",
        headers: {
          Authorization: request.token,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "User-Agent": "BaseballStatTrack-Notifications/1",
        },
        body: JSON.stringify(request.body),
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
