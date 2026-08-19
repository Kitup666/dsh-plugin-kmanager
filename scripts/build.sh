#!/usr/bin/env bash
# POSIX side of scripts/build.mjs (see the PowerShell wrapper for the rationale).
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/build.mjs "$@"