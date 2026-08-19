# Build dsh-plugin-kmanager from Windows PowerShell: junction-link the
# checkout's packages and compile src -> lib (tsc) then bundle the runtime
# entries (tsdown). Set DSH_CHECKOUT when the harness checkout lives elsewhere.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  node scripts/build.mjs $args
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}