# Product purpose

> **Draft for attorney and product review.** This document describes the
> intended product boundary. It is not legal advice, a warranty, or a claim of
> regulatory compliance.

## What Baseball Stat Track is

Baseball Stat Track is a baseball operations, scoring, statistics, reporting,
and team-management platform. It is designed to help authorized team personnel
prepare rosters and games, record baseball activity, preserve scoring history,
apply traceable corrections, and produce reports and statistics from accepted
source events.

The platform treats accepted game events and their revisions as source history.
Scores, box scores, player lines, team summaries, leaderboards, exports, and
other views are derived outputs. A correction adds traceable replacement
evidence and causes affected outputs to be recalculated; it does not silently
erase the prior record.

## Intended users

The intended users are authorized adult operators such as account owners,
administrators, coaches, managers, and scorekeepers. Read-only viewers,
integrations, and service processes may be given limited access when the
corresponding product capability is implemented and configured.

The product is not presently designed as a direct account service for players,
children, or parents. An organization that enters youth-sports information is
responsible for its authority to do so and for applicable league rules,
parental or guardian requirements, and law. The platform's technical controls
do not replace those responsibilities.

## Intended workflows

The supported product direction includes:

- account-scoped team, season, roster, player, game, and lineup management;
- live, online-first pitch-by-pitch or play-by-play scorekeeping;
- interruption recovery for limited unaccepted drafts;
- append-preserving scoring corrections and revision history;
- deterministic batting, pitching, fielding, score, team, and season outputs;
- authorized reports, print views, and versioned exports;
- authenticated read APIs and optional, separately configured integrations;
- consent-aware, minimized product-reliability analytics; and
- privacy workflows that use access revocation, detachment,
  pseudonymization, projection rebuilds, and controlled exports.

Some repository documents describe approved designs, staged capabilities, or
future work. Documentation of a design does not mean that it is enabled in a
particular deployment. Operators must verify deployed behavior and
configuration before representing a capability as available.

## Product limitations

Baseball Stat Track is an informational and operational tool. It does not:

- guarantee that a score, statistic, report, import, or external feed is
  complete, error-free, timely, or suitable for a particular decision;
- provide medical, health, safety, eligibility, legal, tax, or financial
  advice;
- diagnose injury, determine return-to-play status, or replace qualified
  coaches, officials, medical professionals, or league administrators;
- guarantee player development, competitive performance, recruiting,
  scouting, scholarship, roster, or professional outcomes;
- provide professional scouting conclusions unless a separately reviewed
  feature expressly says so; or
- make predictive claims from statistics or analytics.

Statistics and analytics are informational tools, not guaranteed predictions.
Fantasy features are entertainment and scoring tools, not financial advice,
wagering services, or guarantees of an outcome. Users remain responsible for
checking source records, corrections, rulesets, and report status before
relying on an output.

The progressive web application is online-first. Its service worker caches
approved public static assets, not private pages, authentication data, scoring
events, or reports. Limited browser storage may hold an install-prompt
preference and a narrowly scoped unaccepted recovery draft. Offline scoring,
automatic background submission, and permanent local archives are not promised.

## Data and integration boundary

User-entered records remain account-scoped. Imported provider records remain
subject to the provider's rights, license, attribution, and retention terms.
External records are staged with source and version information and do not
become canonical scoring history merely because retrieval succeeded. No public
website is treated as permission to scrape.

Third-party authentication, hosting, database, messaging, analytics, calendar,
webhook, and data-feed services may have their own terms and availability.
Third-party data availability and licensing may change. See
[Data ownership and usage](DATA_OWNERSHIP_AND_USAGE.md) and
[Third-party services](THIRD_PARTY_SERVICES.md).

## Review and change control

Material changes to the intended audience, direct youth access, public sharing,
medical or eligibility information, predictive analytics, payments, wagering,
third-party data rights, or cross-account use require product, privacy,
security, and legal review before release.
