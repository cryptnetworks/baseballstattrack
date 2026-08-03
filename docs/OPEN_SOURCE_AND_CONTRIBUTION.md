# Open source and contribution

> **Draft governance language for attorney and maintainer review.** This
> document does not create a new license, contributor agreement, copyright
> assignment, or waiver.

## Existing software license

The repository currently contains an
[MIT License](https://github.com/cryptnetworks/baseballstattrack/blob/main/LICENSE).
Contributions
accepted into the covered repository are intended for distribution under that
license unless a clearly identified file or dependency carries a different
license. This document does not replace the MIT License or expand its scope.

Public source availability does not remove copyright, trademark, privacy,
confidentiality, or third-party-data restrictions. Product data, credentials,
branding, and imported provider material are not licensed merely because the
application source is available.

## Contribution workflow

Contributors should follow the repository's
[Contributing Guide](https://github.com/cryptnetworks/baseballstattrack/blob/main/CONTRIBUTING.md):
work from a linked issue, use the repository branch conventions, keep changes
focused, include appropriate tests and documentation, and pass required review
and CI. Maintainers may request changes, decline a contribution, or close it
without merging.

A contributor must:

- submit only work they are authorized to contribute;
- identify copied, generated, adapted, or third-party material and its license;
- preserve required copyright and license notices;
- avoid real credentials, private account data, production dumps, private
  scoring records, and personal or youth-sports information in code, fixtures,
  issues, or pull requests;
- use synthetic or properly authorized test data;
- avoid adding a dependency, provider SDK, dataset, logo, or media asset until
  its license and operational implications are reviewed; and
- respond to code review and provide verification evidence.

## Copyright and contribution rights

Submission alone does not assign a contributor's copyright. No contributor
license agreement, copyright assignment, or Developer Certificate of Origin is
currently established by this draft.

The intended interim model is that contributors retain their copyright and ask
the maintainers to consider their contribution for inclusion and distribution
under the repository's MIT License. This sentence is proposed governance text,
not a substitute for a valid contributor agreement. Before relying on it,
counsel must choose and approve one of the following:

- **[OPTION A — non-assignment]:** contributors retain ownership and grant the
  project the rights needed to use and distribute contributions under the
  project license;
- **[OPTION B — assignment]:** specified contributions are assigned through a
  separate signed agreement with appropriate representations and exceptions; or
- **[OPTION C — DCO]:** contributors certify origin and authority through an
  adopted Developer Certificate of Origin and sign-off process.

Until a choice is adopted, maintainers should not represent that contributors
have signed a CLA, assigned copyright, or completed a DCO certification.

## Review, provenance, and generated material

Review should consider correctness, maintainability, security, privacy,
accessibility, baseball semantics, and licensing. Generated code or content is
not exempt from provenance review. A contributor must be able to explain its
source, verify that submission is permitted, and correct or remove material
that cannot be safely licensed.

Contributions involving external baseball data must use synthetic fixtures or
an approved licensed source. Public website access is not permission to scrape
or republish. Provider data must not be copied into repository examples unless
its license expressly permits that use and required attribution is included.

## Security and responsible disclosure

Do not report suspected vulnerabilities in a public issue or pull request.
Follow the repository's
[Security Policy](https://github.com/cryptnetworks/baseballstattrack/blob/main/SECURITY.md),
use synthetic or redacted evidence, do not test against production or another
account, and do not include secrets, tokens, private event payloads, or real
personal data.

This policy does not create a bug-bounty program, safe-harbor promise, response
deadline, or authorization to test systems. Counsel and security reviewers must
approve any future responsible-disclosure or safe-harbor language.

## Community conduct and enforcement

Contributors must follow the repository's
[Code of Conduct](https://github.com/cryptnetworks/baseballstattrack/blob/main/CODE_OF_CONDUCT.md),
which requires welcoming, respectful, harassment-free participation and directs
conduct concerns to the repository owner privately.

Maintainers may remove material that creates security, privacy, licensing,
attribution, or legal risk. A final policy should define moderation contacts,
appeal handling, and record retention without exposing private reports.

## Attorney-review items

- Confirm how the existing MIT copyright notice maps to current owners.
- Choose non-assignment, assignment, CLA, or DCO terms and an acceptance process.
- Define treatment of generated material, employer-owned work, patents, and feedback.
- Confirm documentation, branding, fixtures, and datasets covered by each license.
- Approve a code of conduct and responsible-disclosure language if desired.
