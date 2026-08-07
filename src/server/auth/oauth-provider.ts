export const authenticationProviderKeys = [
  "local",
  "authentik",
  "google",
  "discord",
  "facebook",
  "apple",
] as const;

export type AuthenticationProviderKey =
  (typeof authenticationProviderKeys)[number];

export type OAuthProviderIdentity = Readonly<{
  provider: AuthenticationProviderKey;
  subject: string;
  email: string | null;
  emailVerified: boolean | null;
}>;

export type OAuthAuthorizationInput = Readonly<{
  redirectUri: string;
  state: string;
  codeChallenge: string;
  nonce: string;
}>;

export type OAuthCallbackInput = Readonly<{
  redirectUri: string;
  code: string;
  codeVerifier: string;
  nonce: string;
  signal?: AbortSignal;
}>;

export interface AuthenticationAdapter {
  readonly key: AuthenticationProviderKey;
  readonly label: string;
  authorizationUrl(input: OAuthAuthorizationInput): URL;
  exchange(input: OAuthCallbackInput): Promise<OAuthProviderIdentity>;
}
