import {
  CalendarProviderError,
  type CalendarProviderAdapter,
  type CalendarProviderEvent,
} from "@/domain/calendar-sync";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

function providerError(status: number): CalendarProviderError {
  if (status === 401 || status === 403) {
    return new CalendarProviderError("AUTHENTICATION_FAILED", false);
  }
  if (status === 409 || status === 412) {
    return new CalendarProviderError("CONFLICT", false);
  }
  if (status === 404 || status === 410) {
    return new CalendarProviderError("NOT_FOUND", false);
  }
  if (status === 429) return new CalendarProviderError("RATE_LIMITED", true);
  return new CalendarProviderError("PROVIDER_UNAVAILABLE", status >= 500);
}

function version(response: Response): string {
  const etag = response.headers.get("etag");
  if (!etag) throw new CalendarProviderError("PROVIDER_UNAVAILABLE", true);
  return etag;
}

export class GoogleCalendarAdapter implements CalendarProviderAdapter {
  constructor(
    private readonly accessToken: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  private headers(expectedVersion: string | null = null) {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(expectedVersion ? { "If-Match": expectedVersion } : {}),
    };
  }

  private eventsUrl(calendarId: string, eventId?: string): string {
    return `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}?sendUpdates=none`;
  }

  async upsert(input: {
    calendarId: string;
    eventId: string;
    event: CalendarProviderEvent;
    expectedVersion: string | null;
  }): Promise<Readonly<{ version: string }>> {
    if (input.expectedVersion) {
      const response = await this.request(
        this.eventsUrl(input.calendarId, input.eventId),
        {
          method: "PUT",
          headers: this.headers(input.expectedVersion),
          body: JSON.stringify({ id: input.eventId, ...input.event }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) throw providerError(response.status);
      return { version: version(response) };
    }

    const created = await this.request(this.eventsUrl(input.calendarId), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ id: input.eventId, ...input.event }),
      signal: AbortSignal.timeout(10_000),
    });
    if (created.ok) return { version: version(created) };
    if (created.status !== 409) throw providerError(created.status);

    // A prior request may have reached Google before this application persisted
    // its response. Reusing the deterministic event id makes that retry safe.
    const recovered = await this.request(
      this.eventsUrl(input.calendarId, input.eventId),
      {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify({ id: input.eventId, ...input.event }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!recovered.ok) throw providerError(recovered.status);
    return { version: version(recovered) };
  }

  async cancel(input: {
    calendarId: string;
    eventId: string;
    expectedVersion: string | null;
  }): Promise<void> {
    const response = await this.request(
      this.eventsUrl(input.calendarId, input.eventId),
      {
        method: "DELETE",
        headers: this.headers(input.expectedVersion),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.ok || response.status === 404 || response.status === 410)
      return;
    throw providerError(response.status);
  }
}

export type CalendarCredentialResolver = (
  reference: string,
) => CalendarProviderAdapter;

export function configuredCalendarCredentialResolver(
  encoded = process.env.CALENDAR_PROVIDER_TOKENS_JSON,
): CalendarCredentialResolver {
  if (!encoded) {
    throw new Error("CALENDAR_PROVIDER_TOKENS_JSON is not configured.");
  }
  let tokens: unknown;
  try {
    tokens = JSON.parse(encoded);
  } catch {
    throw new Error("CALENDAR_PROVIDER_TOKENS_JSON is invalid.");
  }
  if (!tokens || Array.isArray(tokens) || typeof tokens !== "object") {
    throw new Error("CALENDAR_PROVIDER_TOKENS_JSON is invalid.");
  }
  const safeTokens = tokens as Record<string, unknown>;
  return (reference) => {
    const token = safeTokens[reference];
    if (typeof token !== "string" || token.length < 20) {
      throw new Error("Calendar credential reference is unavailable.");
    }
    return new GoogleCalendarAdapter(token);
  };
}
