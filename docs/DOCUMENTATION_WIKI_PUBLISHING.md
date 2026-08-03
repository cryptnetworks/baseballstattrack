# Documentation Wiki Publishing

This repository's `docs/` directory is the authoritative documentation source.
The [Baseball Stat Track GitHub Wiki](https://github.com/cryptnetworks/baseballstattrack.wiki)
is a generated publication target, not a second source of truth. Direct wiki
edits are preserved only when they are inside the reserved `_wiki-owned/`
namespace; they must not be used to change repository documentation.

## Pipeline

The publication path is:

```text
docs/
  -> docs/publication-manifest.yaml
  -> scripts/publish-docs-wiki.mjs
  -> temporary generated workspace
  -> cryptnetworks/baseballstattrack.wiki.git
```

The manifest expands the approved top-level Markdown rule into stable wiki
names, classifies exclusions, defines ordering, and supplies navigation groups.
The generator validates and rewrites the complete publication before it writes
anything to a wiki checkout.

## Manifest and visibility

`docs/publication-manifest.yaml` defines:

- the `docs/` source root and repository source-link policy;
- the filename-to-wiki mapping (`{stem}` with underscores converted to hyphens);
- public pages and their deterministic source ordering;
- internal and restricted exclusions, including decision records, machine API
  artifacts, deferred offline design, and future league planning;
- generated and reserved wiki namespaces; and
- landing-page and sidebar navigation groups.

The public wiki uses curated navigation. Six public hub pages organize product
use, rules and calculations, installation and development, integrations, and
secure operations. Detailed public references are still generated, but they do
not appear individually in the sidebar. Each hidden detail page must be linked
directly from a curated hub or validation fails. Link labels come from each
page's H1 heading instead of its storage filename.

Only `public` mappings are rendered. Internal and restricted Markdown is never
copied into the wiki. A public link to excluded material is rewritten to the
repository source URL rather than copying that material into the wiki.

## Validation and generation

Before a wiki write, the generator validates:

- YAML manifest shape, visibility, source coverage, missing sources, safe paths,
  page collisions, duplicate wiki names, and curated-navigation
  discoverability;
- Markdown H1 metadata, headings, anchors, balanced code fences, and NUL bytes;
- local Markdown links, anchors, images, and other local assets;
- source links for excluded or machine-readable artifacts; and
- high-signal credential/private-key patterns in public pages.

Generated output includes `Home.md`, `_Sidebar.md`, `_generated/*.md`, linked
image assets, and `_generated/.publication-manifest.json`. The generated
manifest records the exact generated paths and source mappings without adding a
timestamp, so identical content remains idempotent.

Use these commands locally:

```sh
npm run docs:wiki:validate
npm run docs:wiki:dry-run -- --wiki-dir /path/to/baseballstattrack.wiki
npm run docs:wiki:publish -- --wiki-dir /path/to/baseballstattrack.wiki
```

Dry-run generates and validates the prospective output, reports the file diff,
and does not commit or push. Publish mode requires `WIKI_PUBLISH_TOKEN` even
when the generated content happens to be unchanged.

## Workflow behavior

`.github/workflows/publish-docs-wiki.yml` has two trusted entry paths:

1. After the `CI` workflow succeeds for a push to `main`, it publishes the
   exact successful source SHA.
2. Manual dispatch accepts `dry-run` or `publish`, with an optional source SHA
   for a controlled republish.

The workflow has no `pull_request` trigger and does not grant write permission
to the repository `GITHUB_TOKEN`. Pull requests can validate the manifest and
workflow boundary through the normal CI documentation job, but cannot access
the wiki credential or write to the wiki.

The wiki checkout is temporary. Publication fails closed for an unavailable
credential, target branch, malformed generated manifest, unmanaged collision,
untracked file in `_generated/`, missing source, or unsafe mapping.

The current target branch is `master`, matching the wiki repository. Keep that
branch choice in the workflow environment rather than assuming the source
repository's `main` name.

## Credential model

Configure `WIKI_PUBLISH_TOKEN` as a GitHub Actions secret on the source
repository. The recommended credential is a fine-grained token or GitHub App
installation credential restricted to the
`cryptnetworks/baseballstattrack.wiki` repository with only the contents access
needed to read and write the wiki publication branch. Do not use a personal
account token with unrelated repository access.

The workflow keeps the source repository token read-only. It uses the wiki
credential only for the temporary clone and push, never prints it, never writes
it to the repository, and never exposes it to pull-request jobs. Rotate it by
creating the replacement credential, updating the Actions secret, running a
manual dry-run, publishing once under observation, and revoking the old
credential. A missing or invalid credential stops before publication.

Git-over-HTTPS authentication uses the tracked `scripts/wiki-git-askpass.sh`
adapter. Git requests a fixed `x-access-token` username and reads the password
from `WIKI_PUBLISH_TOKEN` at runtime. The token is never embedded in a remote
URL, converted into an authorization header, stored in Git configuration, or
written to disk. `GIT_TERMINAL_PROMPT=0` keeps unattended runs fail closed when
authentication is rejected.

## Ownership and deletion policy

Generated pages are overwritten only when listed in the prior generated
manifest. Removed or renamed source pages are deleted from `_generated/` only
when the prior manifest identifies them as generated. An unmanaged file in that
namespace fails closed instead of being guessed at or deleted.

Reserved wiki-owned pages belong under `_wiki-owned/` and are never copied,
rewritten, or deleted by this workflow. A generated path cannot overlap that
namespace. Wiki-only material outside the reserved namespace is also protected
by collision checks and must be moved deliberately before publication.

An identical second run reports no changes and creates no commit.

## Recovery and rollback

For a failed publication, inspect the workflow log and the wiki repository's
last accepted commit; do not retry blindly if the target changed concurrently.
After correcting the manifest, credential, or target state, rerun manual dry-run
and then manual publish.

To roll back a bad publication, identify the source SHA and wiki commit in the
workflow evidence, create a reviewed revert or restore commit in the wiki
repository, and rerun the source-controlled publication after fixing the source
docs. Do not force-push or restore by deleting unrelated wiki history.

If the wiki repository must be rebuilt, preserve `_wiki-owned/`, restore the
last known-good wiki revision, run a dry-run against that checkout, and perform
one controlled publish. The repository source remains authoritative throughout.

## Scope boundary

This pipeline does not implement fantasy features, league delegation, imports,
offline functionality, or M9 work. It publishes existing approved
documentation only; it does not make any product feature claim or change
application, database, authentication, scoring, integration, or migration
behavior.
