import {
  externalProviderPageSchema,
  externalRecordTypes,
  normalizeExternalRecord,
  type ExternalProviderAdapter,
  type ExternalProviderContract,
} from "@/domain/external-data";

export class LicensedJsonFeedProvider implements ExternalProviderAdapter {
  readonly contract: ExternalProviderContract = {
    key: "MLB_LICENSED_JSON_V1",
    displayName: "Licensed MLB JSON feed",
    capabilities: externalRecordTypes,
    authentication: "API_KEY",
    pagination: "CURSOR",
    maximumPageSize: 1_000,
    minimumCadenceSeconds: 60,
    freshnessSeconds: 300,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    attributionRequired: true,
  };

  private readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
  ) {
    this.baseUrl = new URL(baseUrl);
    if (
      this.baseUrl.protocol !== "https:" ||
      this.baseUrl.username ||
      this.baseUrl.password ||
      this.baseUrl.search ||
      this.baseUrl.hash ||
      !apiKey ||
      apiKey.length < 24
    ) {
      throw new Error("Licensed provider configuration is invalid.");
    }
  }

  async fetchPage(input: {
    cursor: string | null;
    from: Date;
    to: Date;
    checkpoint: unknown;
  }) {
    const url = new URL("v1/records", this.baseUrl);
    url.searchParams.set("from", input.from.toISOString());
    url.searchParams.set("to", input.to.toISOString());
    if (input.cursor) url.searchParams.set("cursor", input.cursor);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "BaseballStatTrack-Ingestion/1",
        },
        body: JSON.stringify({ checkpoint: input.checkpoint ?? null }),
      });
      if (!response.ok) {
        throw new Error(
          this.contract.retryableStatusCodes.includes(response.status)
            ? "PROVIDER_RETRYABLE_RESPONSE"
            : "PROVIDER_TERMINAL_RESPONSE",
        );
      }
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > 5_000_000)
        throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
      const text = await response.text();
      if (Buffer.byteLength(text) > 5_000_000) {
        throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
      }
      return externalProviderPageSchema.parse(JSON.parse(text));
    } finally {
      clearTimeout(timeout);
    }
  }

  normalize(record: unknown) {
    return normalizeExternalRecord(record);
  }
}
