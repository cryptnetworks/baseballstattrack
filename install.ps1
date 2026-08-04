$ErrorActionPreference = "Stop"

$installerImage = if ($env:BST_INSTALLER_IMAGE) { $env:BST_INSTALLER_IMAGE } else { "ghcr.io/cryptnetworks/baseballstattrack-installer:latest" }
$installerPullPolicy = if ($env:BST_INSTALLER_PULL_POLICY) { $env:BST_INSTALLER_PULL_POLICY } else { "always" }
$deploymentDirectory = if ($env:BST_DEPLOYMENT_DIRECTORY) { $env:BST_DEPLOYMENT_DIRECTORY } else { Join-Path (Get-Location) "baseballstattrack-deployment" }
$sourceDirectory = if ($env:BST_SOURCE_DIRECTORY) { $env:BST_SOURCE_DIRECTORY } else { (Get-Location).Path }

if ($installerPullPolicy -notin @("always", "missing", "never")) {
  throw "BST_INSTALLER_PULL_POLICY must be always, missing, or never."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker Desktop is required. Install it from https://docs.docker.com/desktop/setup/install/windows-install/."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is installed, but its daemon is not running." }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is required." }

$deploymentDirectory = [IO.Path]::GetFullPath($deploymentDirectory)
$sourceDirectory = [IO.Path]::GetFullPath($sourceDirectory)
if (-not (Test-Path -PathType Container $sourceDirectory)) {
  throw "The installer source directory does not exist: $sourceDirectory"
}
New-Item -ItemType Directory -Force -Path $deploymentDirectory | Out-Null

$bootstrapCompose = Join-Path $deploymentDirectory "compose.installer.yml"
$bootstrapEnvironment = Join-Path $deploymentDirectory ".env.installer"
$installerProject = "baseballstattrack-installer-$PID"
$composeTemporary = "$bootstrapCompose.partial-$PID"
$environmentTemporary = "$bootstrapEnvironment.partial-$PID"
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
$bootstrapReady = $false

function ConvertTo-EnvironmentValue([string]$value) {
  return "'" + $value.Replace("'", "\'") + "'"
}

$environmentContent = @(
  "BST_INSTALLER_IMAGE=$(ConvertTo-EnvironmentValue $installerImage)"
  "BST_INSTALLER_PULL_POLICY=$(ConvertTo-EnvironmentValue $installerPullPolicy)"
  "BST_HOST_PLATFORM='windows'"
  "BST_DEPLOYMENT_DIRECTORY=$(ConvertTo-EnvironmentValue $deploymentDirectory)"
  "BST_SOURCE_DIRECTORY=$(ConvertTo-EnvironmentValue $sourceDirectory)"
) -join "`n"
$environmentContent += "`n"

$composeContent = @'
services:
  installer:
    image: ${BST_INSTALLER_IMAGE:?Set BST_INSTALLER_IMAGE in .env.installer}
    pull_policy: ${BST_INSTALLER_PULL_POLICY:-always}
    environment:
      BST_HOST_PLATFORM: ${BST_HOST_PLATFORM:?Set BST_HOST_PLATFORM in .env.installer}
      BST_DEPLOYMENT_DIR: /deployment
      BST_SOURCE_DIR: /source
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - type: bind
        source: ${BST_DEPLOYMENT_DIRECTORY:?Set BST_DEPLOYMENT_DIRECTORY in .env.installer}
        target: /deployment
      - type: bind
        source: ${BST_SOURCE_DIRECTORY:?Set BST_SOURCE_DIRECTORY in .env.installer}
        target: /source
        read_only: true
      - type: bind
        source: /var/run/docker.sock
        target: /var/run/docker.sock
'@
$composeContent += "`n"

try {
  [IO.File]::WriteAllText($environmentTemporary, $environmentContent, $utf8WithoutBom)
  [IO.File]::WriteAllText($composeTemporary, $composeContent, $utf8WithoutBom)
  Move-Item -Force $environmentTemporary $bootstrapEnvironment
  Move-Item -Force $composeTemporary $bootstrapCompose

  $composeArguments = @(
    "compose"
    "--project-name", $installerProject
    "--file", $bootstrapCompose
    "--env-file", $bootstrapEnvironment
  )
  $bootstrapReady = $true

  & docker @composeArguments config --quiet
  if ($LASTEXITCODE -ne 0) { throw "The generated installer Compose configuration is invalid." }

  & docker @composeArguments run --rm installer @args
  $installerExitCode = $LASTEXITCODE
}
finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $composeTemporary, $environmentTemporary
  if ($bootstrapReady) {
    & docker @composeArguments down --remove-orphans *> $null
  }
}

exit $installerExitCode
