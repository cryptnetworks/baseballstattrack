# GitHub Wiki publishing guide

The repository `docs/` directory is the only authoritative documentation
source. The [Baseball Stat Track Wiki](https://github.com/cryptnetworks/baseballstattrack/wiki)
is generated output for readers; direct Wiki edits are not authoritative.

## Publication architecture

```text
repository docs/
        |
        v
docs/wiki-manifest.yaml
        |
        v
validator and Markdown transformer
        |
        v
temporary Wiki checkout
        |
        v
cryptnetworks/baseballstattrack.wiki.git
```

The generator builds and validates the complete desired Wiki in memory before
it writes to the temporary checkout. A failure therefore leaves the Wiki
repository unchanged.

## Documentation inventory

`docs/wiki-manifest.yaml` is a fail-closed inventory. Every Markdown source must
match exactly one entry.

| Classification | Published | Typical content                                                                     |
| -------------- | --------- | ----------------------------------------------------------------------------------- |
| `public`       | Yes       | User guides, supported contracts, architecture, development, and operations         |
| `internal`     | No        | ADRs, milestone evidence, machine API artifacts, and future implementation planning |
| `restricted`   | No        | Deferred sensitive designs and raw security findings                                |

Public entries define an explicit source path, friendly Wiki page name, stable
order, and visibility. Internal and restricted entries require a reason. A new
Markdown file that is not inventoried makes validation fail instead of becoming
public by default.

The repository `README.md` remains the repository landing page. ADRs under
`docs/decisions/`, machine-readable contracts under `docs/api/`, raw security
audit evidence, and implementation-only milestone documents remain
repository-only.

## Wiki transformation rules

Every public source is converted without changing its authoritative repository
copy:

- page filenames become reader-friendly Wiki names;
- relative Markdown links and `docs/...` link destinations become canonical
  Wiki page links;
- links to non-public Markdown remain repository source links;
- heading anchors are normalized and validated using GitHub-compatible slugs;
- image assets are copied into the generated namespace and linked through the
  Wiki raw-content endpoint;
- fenced code blocks, language identifiers, and Markdown tables are preserved;
- Markdown tables must have a valid header, separator, and consistent columns;
- Mermaid fences pass through unchanged because GitHub Markdown renders
  Mermaid diagrams; and
- every page receives a source attribution with an edit path back to `docs/`.

Missing sources, anchors, or assets; unsafe paths; duplicate Wiki names or
orders; invalid tables; unsafe active HTML; and unclosed code fences all fail
validation.

## Navigation and ownership

The generator owns:

- `Home.md`, the task-oriented landing page;
- `_Sidebar.md`, the compact section navigation;
- `_Footer.md`, the source-of-truth notice;
- `_generated/*.md`, transformed documentation pages;
- `_generated/assets/`, copied images; and
- `_generated/.publication-manifest.json`, the generated path inventory and
  content hash.

Wiki-only content is allowed only under `_wiki-owned/`. The generator preserves
that namespace and refuses to claim or delete it. Generated files are replaced
on publication. Removed and renamed sources are detected through the previous
generated manifest so stale generated pages are deleted without touching
reserved content.

## Local validation and preview

Validate the inventory and generated Markdown:

```sh
npm run docs:wiki:validate
npm run docs:wiki:workflow:validate
```

Preview the exact changes against a temporary Wiki checkout:

```sh
git clone https://github.com/cryptnetworks/baseballstattrack.wiki.git /tmp/baseballstattrack-wiki
npm run docs:wiki:dry-run -- --wiki-dir /tmp/baseballstattrack-wiki
```

A second dry run against identical generated content reports no changes.

## GitHub Actions behavior

Pull requests run validation and a read-only Wiki diff preview. They never
receive the publication credential and cannot push.

After a successful trusted `main` CI run, the workflow checks out the exact
successful source revision, validates it, clones the Wiki into runner temporary
storage, and publishes only when content changed.

Manual dispatch supports:

- `validate` — validate the source without cloning or writing the Wiki;
- `dry-run` — validate and display the prospective Wiki diff; and
- `publish` — publish an explicitly trusted `main` revision.

## Credential and security model

`WIKI_PUBLISH_TOKEN` is an Actions secret used only by the trusted publish
step. It needs the minimum repository-content permission required to push to
`cryptnetworks/baseballstattrack.wiki.git`. It is passed through non-interactive
Git credential handling, is never embedded in a URL, and must never be printed.

Rotate the credential by creating a replacement with the same least privilege,
updating the repository secret, running a manual dry run, performing one
controlled publish, and revoking the previous credential.

The transformer also rejects common credential formats, private-key blocks,
user-specific home-directory paths, unsafe active HTML, traversal paths, and
public content not explicitly approved by the manifest.

## Recovery and rollback

For a failed publication:

1. Preserve the failed Actions run and error message.
2. Correct the repository source or credential; never patch the generated Wiki
   as the long-term fix.
3. Run `validate`, then `dry-run`.
4. Trigger a controlled manual `publish` from the intended `main` revision.

To roll back, inspect the Wiki Git history, revert or restore the last known-good
Wiki revision, correct `docs/` on `main`, and republish. A manual Wiki rollback
is temporary recovery evidence; the repository source must be corrected so the
next deterministic publication preserves the intended state.

## Troubleshooting

- **Uninventoried source:** add an explicit manifest entry and visibility.
- **Undiscoverable page:** link the detail page directly from one curated hub.
- **Broken anchor:** update the source link to the normalized destination
  heading.
- **Unsafe or secret-like content:** remove the value or classify the document
  as non-public; do not weaken the scanner for real credentials.
- **No Wiki commit:** no generated content changed; this is the expected
  idempotent result.
- **Authentication failure:** verify the secret exists, retains Wiki write
  permission, and has not expired or been revoked.
