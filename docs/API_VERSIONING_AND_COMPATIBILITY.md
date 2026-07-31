# API versioning and compatibility

The statistics API is a supported, authenticated read contract. Its canonical
machine-readable definition is
[`api/statistics-v1.openapi.yaml`](api/statistics-v1.openapi.yaml). The OpenAPI
document, its examples, and the implementation must change together.

## Version support

Version 1 uses `/api/v1` paths, the
`application/vnd.baseballstattrack.stats.v1+json` success media type, the
`X-API-Version: v1` header, and an `apiVersion: "v1"` response envelope. v1 is
the current and minimum supported version.

Within v1, changes are additive-only. Compatible changes include adding an
optional query parameter, a new response field, a new endpoint, or a new enum
value whose meaning does not alter an existing value. Clients must ignore
response fields they do not recognize.

The following changes are breaking and require a new major path and media
type:

- removing a path, operation, response status, documented field, or enum value;
- making an optional request parameter required;
- narrowing a field type or changing a field's meaning, units, or identity;
- exposing an internal database, membership, setup, provider, or lineage key;
- weakening authentication, exact-scope authorization, correction labeling, or
  freshness semantics.

## Deprecation

A supported version is not removed silently. A replacement must be documented
and deployed before deprecation, with a migration guide and an announced
support window approved through the release process. Deprecation metadata and
the final removal date must be published in the replacement contract. Removal
occurs only in a new major version; v1 clients continue receiving the v1 shape
during its support window.

## Contract verification

Canonical examples cover authorization failure, empty results, incomplete
pagination, corrected data, and rate limiting. The Discord integration consumes
the same corrected report examples in its command tests, pinning it to the v1
response contract rather than a second handwritten fixture.

Run `npm run api:contract` to parse the OpenAPI document, validate every
canonical example, reject internal fields, and compare the document with its
committed digest. Pull-request CI additionally compares the candidate contract
with the target branch and rejects removal or narrowing of the supported v1
surface.

For an intentional compatible contract change:

1. update implementation, OpenAPI schemas, examples, and consumer tests;
2. run `npm run api:contract:write` to refresh the reviewed digest;
3. run `npm run verify`; and
4. call out the compatibility impact in the pull request.

Do not refresh the digest to conceal a breaking change. Design and publish a
new API version instead.
