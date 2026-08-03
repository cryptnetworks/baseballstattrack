# Production installation

This guide installs Baseball Stat Track as a production service. The supported
deployment is the repository's image-only Docker Compose stack on a 64-bit
Linux host. It runs PostgreSQL 17, a one-shot migration service, the Next.js
application, and optional Discord and Cloudflare Tunnel services.

The production host does not build source code and does not require Node.js,
npm, Prisma, or Python. It needs only `docker-compose.yml` and the two production
environment examples from the exact source revision selected for deployment.
Application services run published GHCR images from that same revision.

## 1. Prepare the platform

Provide:

- a current Docker Engine and Docker Compose v2;
- at least 4 vCPU, 8 GiB RAM, and 40 GiB free SSD capacity for the minimum
  combined-host deployment;
- a DNS name and TLS-terminating reverse proxy or Cloudflare Tunnel;
- OAuth/OIDC clients for every enabled authentication provider;
- a protected directory for production configuration;
- a separate, tested PostgreSQL backup destination; and
- outbound HTTPS and DNS access for configured identity and integration
  providers.

For a small production installation, 100 GiB of SSD-backed database storage is
recommended. Keep the PostgreSQL filesystem below 75% usage and place backups
in a separate failure domain. See
[Database storage capacity](DATABASE_STORAGE_CAPACITY.md) before choosing the
database volume and alert thresholds.

## 2. Install the deployment manifest and configuration

Obtain `docker-compose.yml`, `compose.production.env.example`, and
`app.production.env.example` from one reviewed source revision. Verify the
revision before copying those files to the host; do not combine a Compose file
from one revision with images from another.

Install the manifest and protected configuration:

```sh
sudo install -d -m 755 /opt/baseballstattrack
sudo install -d -m 700 /etc/baseballstattrack
sudo install -m 644 docker-compose.yml /opt/baseballstattrack/docker-compose.yml
sudo install -m 600 compose.production.env.example /etc/baseballstattrack/production.env
sudo install -m 600 app.production.env.example /etc/baseballstattrack/app.env
```

Set `APP_ENV_FILE=/etc/baseballstattrack/app.env` in `production.env`, then
replace every placeholder. At minimum, configure:

- one immutable `sha-<full source SHA>` tag for `APP_IMAGE`,
  `MIGRATION_IMAGE`, and `DISCORD_BOT_IMAGE`;
- `POSTGRES_PASSWORD`, `DATABASE_URL`, and `DIRECT_URL` for the same database
  service, database, and user;
- the public HTTPS site URL and application encryption key;
- enabled OAuth/OIDC providers and their server-side credentials;
- signing keys and provider credentials for enabled integrations; and
- optional Discord and Cloudflare credentials only when those profiles are
  enabled.

Use independently generated high-entropy values. Never commit production
configuration, copy it into an image, place it in a command-line URL, or expose
it through a client-visible environment variable. Follow
[Configuration management](CONFIGURATION_MANAGEMENT.md) for ownership,
rotation, and emergency revocation.

## 3. Configure public access

The application binds to `127.0.0.1:3000` by default. Terminate TLS at the host
reverse proxy and forward requests to that loopback address. If using the
optional Cloudflare profile, configure the remotely managed tunnel hostname to
target `http://app:3000` and place only the tunnel token in the Compose
configuration.

Register `<public-site-url>/auth/callback` with each identity provider. A valid
provider identity does not grant application access; every user still requires
an active Account membership and server-side capability checks.

## 4. Validate and deploy

Validate the resolved Compose configuration before pulling or starting
services:

```sh
docker compose \
  --file /opt/baseballstattrack/docker-compose.yml \
  --env-file /etc/baseballstattrack/production.env \
  config --quiet

docker compose \
  --file /opt/baseballstattrack/docker-compose.yml \
  --env-file /etc/baseballstattrack/production.env \
  pull

docker compose \
  --file /opt/baseballstattrack/docker-compose.yml \
  --env-file /etc/baseballstattrack/production.env \
  up --detach --wait
```

Startup is dependency ordered and fails closed:

1. PostgreSQL must become healthy.
2. The migration image runs `prisma migrate deploy` and must exit successfully.
3. The application starts and must pass `/api/ready`.
4. Enabled optional services start only after their dependencies are ready.

The application never applies migrations during ordinary startup. A failed
migration prevents dependent services from starting.

## 5. Verify the installation

Confirm service state and application readiness:

```sh
docker compose \
  --file /opt/baseballstattrack/docker-compose.yml \
  --env-file /etc/baseballstattrack/production.env \
  ps --all

curl --fail http://127.0.0.1:3000/api/ready
```

Then verify through the public HTTPS origin:

- the status page and readiness endpoint are reachable through TLS;
- an approved user can authenticate and access only the intended Account;
- an unapproved or cross-Account request fails closed;
- a backup completes and can be restored into an isolated environment;
- storage, readiness, migration, authentication, and provider failures alert;
  and
- enabled Discord, notification, calendar, webhook, and ingestion boundaries
  use least-privilege credentials.

Do not accept a deployment based only on container state. Authentication,
authorization, backup restoration, and external-provider behavior are part of
production readiness.

## 6. Operate and monitor

Use [Operations and security](OPERATIONS_AND_SECURITY.md) as the production
runbook index. The primary service commands are:

```sh
docker compose --file /opt/baseballstattrack/docker-compose.yml --env-file /etc/baseballstattrack/production.env ps --all
docker compose --file /opt/baseballstattrack/docker-compose.yml --env-file /etc/baseballstattrack/production.env logs app migrate
curl --fail http://127.0.0.1:3000/api/ready
```

Monitor application readiness, database reachability and storage, backup age,
migration state, authentication failures, worker backlog, webhook failures,
Discord health, and external-provider errors. Do not log secrets, session
material, private player fields, database URLs, or complete integration
payloads.

## 7. Upgrade and roll back

Before an upgrade:

1. verify a current restorable backup;
2. record the running image digests and database migration state;
3. set every application image to the same new immutable source tag;
4. pull and run `up --detach --wait`; and
5. repeat readiness, authorization, integration, storage, and backup checks.

Applied migrations are immutable. Roll back an application image only when it
remains compatible with the migrated schema. Otherwise restore according to
[Backup and restore](BACKUP_AND_RESTORE.md) or ship a roll-forward repair.

An ordinary `docker compose down` retains the database volume. Never run
`docker compose down --volumes` against production.

## Detailed production references

- [Production Docker Compose deployment](PRODUCTION_COMPOSE.md)
- [Container operations](CONTAINER_OPERATIONS.md)
- [Authentication providers](AUTHENTICATION_PROVIDERS.md)
- [Production authentication and team isolation](PRODUCTION_AUTHENTICATION_AND_TEAM_ISOLATION.md)
- [Backup and restore](BACKUP_AND_RESTORE.md)
- [Production reliability and incident response](PRODUCTION_RELIABILITY.md)
- [Observability, audit, and alerting](OBSERVABILITY_AUDIT_AND_ALERTING.md)
- [Discord control-plane deployment](DISCORD_CONTROL_PLANE_DEPLOYMENT.md)

The public Wiki intentionally contains production operations, product usage,
integration behavior, architectural design choices, and calculation rules. It
does not publish local-development, test, contribution, issue, branch, or
pull-request procedures.
