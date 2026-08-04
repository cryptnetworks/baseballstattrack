$ErrorActionPreference = "Stop"

$installerImage = if ($env:BST_INSTALLER_IMAGE) { $env:BST_INSTALLER_IMAGE } else { "ghcr.io/cryptnetworks/baseballstattrack-installer:latest" }
$deploymentDirectory = if ($env:BST_DEPLOYMENT_DIRECTORY) { $env:BST_DEPLOYMENT_DIRECTORY } else { Join-Path (Get-Location) "baseballstattrack-deployment" }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker Desktop is required. Install it from https://docs.docker.com/desktop/setup/install/windows-install/."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is installed, but its daemon is not running." }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is required." }

New-Item -ItemType Directory -Force -Path $deploymentDirectory | Out-Null

# Docker Desktop exposes its engine socket inside Linux containers. The
# installer is short-lived; generated configuration remains in the host mount.
docker run --rm -it --pull always `
  --env BST_HOST_PLATFORM=windows `
  --add-host host.docker.internal:host-gateway `
  --volume /var/run/docker.sock:/var/run/docker.sock `
  --volume "${deploymentDirectory}:/deployment" `
  --volume "$(Get-Location):/source:ro" `
  $installerImage @args
exit $LASTEXITCODE
