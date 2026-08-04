# Deployment installer internals

The deployment wizard runs inside its own container so target hosts need only
Docker Desktop or Docker Engine with Compose v2. The repository-root
`install.sh` and `install.ps1` files are launchers; they do not install
application or database dependencies.

The installer mounts the Docker socket and a protected deployment directory.
Docker socket access is equivalent to control of the Docker host, so use only
the published image from this repository or an image built from reviewed
source. The container is removed when the command ends.

Commands are `install`, `update`, `recover`, `status`, `logs`, `uninstall`, and
`preflight`. Node 24 executes the TypeScript sources directly. Unit tests inject
command runners and network clients; container smoke tests exercise image
construction and the help entry point.

The installer image includes the Docker CLI, Compose v2, and Buildx. These are
container tools used to control the mounted host daemon; they are not installed
on the target host. npm and npx are removed from the final image because the
wizard uses Node's built-in TypeScript execution and has no package-install
path.
