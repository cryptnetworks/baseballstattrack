# Docker-first deployment

The interactive installer deploys Baseball Stat Track without installing
Node.js, Python, PostgreSQL, or application packages on the host. A target host
needs only Docker Desktop, or Docker Engine with the Compose v2 plugin.

The launcher atomically creates a protected installer Compose file and
environment file, then starts the short-lived installer with Docker Compose.
The installer validates Docker, writes the application deployment files,
controls the Compose stack, runs the one-shot migration service, and checks
application, database, migration, and worker health. The launchers never call
`docker run` directly.

## Supported hosts

| Host                            | Required Docker runtime              | Notes                                                                                                                           |
| ------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| macOS on Apple Silicon or Intel | Docker Desktop                       | Open Docker Desktop and wait for the engine to report running. Published application images must support the host architecture. |
| Windows                         | Docker Desktop with WSL2 integration | Run the PowerShell launcher from a directory shared with Docker Desktop. Linux containers are required.                         |
| NixOS                           | Docker daemon and Compose v2 plugin  | Enable them in reviewed NixOS configuration. The installer never changes Nix modules.                                           |
| Other Linux                     | Docker Engine and Compose v2 plugin  | The operator must have Docker daemon access.                                                                                    |

Allow at least 10 GiB free for preflight. Production sizing and backup capacity
remain subject to the larger limits in [Production installation](PRODUCTION_INSTALLATION.md).

## Security boundary

The installer service mounts `/var/run/docker.sock`; access to that socket is
equivalent to control of the Docker host. Run only the image published from
this repository or build it from a reviewed checkout. Docker Compose removes
the installer container and its temporary network after each command. A Docker
host-gateway alias lets the installer validate the application's host-published
health port without joining application networks.

The launchers create `compose.installer.yml` and `.env.installer`; these contain
only the installer image, detected platform, and bind-mount paths. The wizard
then creates `docker-compose.yml`, `.env.production`, `app.env`, and installation
metadata. These files use mode `0600` inside a mode `0700` deployment directory
where the host supports POSIX permissions. Protect that directory with host
access controls on Docker Desktop. Secrets are generated with the operating
system cryptographic random source, are never printed, and are redacted from
command failures and installer log output.

The files contain only image coordinates, network/database bootstrap,
authentication provider bootstrap, and runtime secrets. Feature flags,
notification preferences, integrations, rates, display choices, and other
application behavior belong in **Settings → Application configuration** after
the first Account owner is provisioned.

## Install

Download the launcher from the exact release or source revision you intend to
run. On macOS, NixOS, and Linux:

```sh
chmod +x install.sh
BST_INSTALLER_IMAGE=ghcr.io/cryptnetworks/baseballstattrack-installer:sha-<full-source-sha> ./install.sh install
```

On Windows PowerShell:

```powershell
$env:BST_INSTALLER_IMAGE = "ghcr.io/cryptnetworks/baseballstattrack-installer:sha-<full-source-sha>"
.\install.ps1 install
```

Set `BST_DEPLOYMENT_DIRECTORY` to choose the protected host directory. The
default is `baseballstattrack-deployment` below the current directory. Each
launcher refreshes its bootstrap Compose and environment files before invoking
the installer, so moving the checkout or changing the pinned installer image
does not leave stale bind mounts behind.

`BST_INSTALLER_PULL_POLICY` defaults to `always`. The `missing` and `never`
values are intended for reviewed offline caches and local image rehearsals;
production operators should retain `always` with an immutable installer tag.

The wizard asks only for:

- local, team/league, or production mode;
- deployment URL, timezone, bind port, and database bootstrap names;
- intended initial Account name and slug;
- one initial OAuth/OIDC provider and its runtime credentials; and
- approval to generate database, encryption, signing, and worker secrets.

Google, Authentik, Discord, Facebook, and Apple are supported authentication
bootstrap providers. Client secrets and Apple private keys stay in the
protected application environment file. Production rejects the mutable
`latest` application image tag and binds the application to loopback for a TLS
reverse proxy. Team mode publishes on all host interfaces; protect it with the
host firewall and trusted network.

Preflight displays Docker CLI, daemon, Compose, disk, and Docker-published port
status. A successful install then validates Compose, pulls immutable images (or
builds a local checkout when explicitly selected), starts PostgreSQL, runs
migrations, starts the application and enabled services, and polls `/api/health`
and `/api/ready`.

## First administrator handoff

OAuth email is mutable and is not an identity key. The installer therefore
does not grant Account ownership by email or trust a client-supplied identity.
After the intended administrator signs in, provision the exact provider and
provider-subject pair as owner through the existing reviewed Account
authorization procedure. Then create application-configuration revision 1 in
the admin portal. Keep the intended Account metadata in
`.bst-installation.json` for that handoff; it is not a grant.

## Day-two commands

Use the same launcher and installer image family for every command:

```sh
./install.sh status
./install.sh logs
./install.sh update
./install.sh recover
./install.sh uninstall
```

`status` checks HTTP health/readiness, PostgreSQL readiness, the latest required
migration, and Compose service state. `logs` returns the most recent 200
Compose lines with known secrets and database URL passwords redacted.

### Update

`update` requires a new immutable tag. It creates a PostgreSQL custom-format
backup and SHA-256 sidecar before changing image coordinates, saves the prior
environment file, pulls, migrates, restarts, and validates health. Backups are
kept under `backups/`. Applied migrations are not automatically reversed. On a
failed update, retain the backup and `.env.production.previous`, inspect logs,
and use the documented roll-forward or restore plan.

### Recovery and failed installation

`recover` requires the protected files and an existing database volume. It
does not replace configuration or data. It validates Compose, starts the
database, safely re-runs the idempotent migration deployment, starts services,
and repeats health validation.

When installation stops, the error identifies the failed Docker/Compose
boundary and a recovery action. Generated files and database volumes remain in
place. Use `logs`, correct the external problem, and run `recover`. Recovery
can resume from protected configuration even if the failure occurred before
the first database volume was created. If Docker
state exists without matching protected configuration, the installer refuses
to overwrite it; recover the original files or follow
[Backup and restore](BACKUP_AND_RESTORE.md).

### Uninstall

Uninstall offers containers only, containers plus volumes, or full generated
configuration cleanup. Any volume removal requires the exact phrase
`delete database volume` and confirmation of a verified external backup.
Full cleanup retains backup archives. A database volume cannot be reconstructed
from removed local state without a valid backup.

## Troubleshooting

- **Docker unavailable:** install the official Docker package for the detected
  platform and start its daemon. The wizard does not install it.
- **Permission denied on the socket:** grant the operator reviewed Docker
  access, then start a new shell. Docker access is privileged.
- **Port in use:** choose another application port or stop the identified
  listener. Preflight detects Docker-published ports; Compose still fails safely
  if a non-Docker process owns the port.
- **Registry pull fails:** verify package access and the immutable image tag.
- **Readiness fails:** run `logs`; confirm the migration container exited zero,
  PostgreSQL is healthy, provider variables are valid, and configuration
  revision 1 has been created where applicable.
- **Apple key read fails:** put the key file in the protected deployment
  directory and enter only its filename. Do not paste it into shell history.

## Production checklist

- Pin the installer and all application images to the same reviewed source SHA.
- Terminate TLS at a reviewed reverse proxy and leave the app bound to loopback.
- Restrict the deployment directory, Docker daemon, backups, and registry.
- Configure and verify the OAuth callback URL before sign-in.
- Provision the owner by provider subject, never by email.
- Store backups in a separate failure domain and rehearse restoration.
- Review configuration revision 1, Account isolation, health monitoring,
  retention, and security operations before admitting real league data.
- Keep Docker, the pinned infrastructure images, and security findings under
  the procedures in [Operations and security](OPERATIONS_AND_SECURITY.md).

The installer does not configure offline operation, native host services,
automatic TLS, managed-database topologies, or automatic first-owner grants.
