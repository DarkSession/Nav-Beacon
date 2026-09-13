#!/usr/bin/env bash
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
coverage="$root/coverage/server/coverage.json"
threshold="${SERVER_COVERAGE_THRESHOLD:-80}"

if ! [[ "$threshold" =~ ^[0-9]+$ ]] || ((threshold < 80)); then
  echo "SERVER_COVERAGE_THRESHOLD must be an integer of at least 80." >&2
  exit 2
fi

mkdir -p "$(dirname "$coverage")"

dotnet test "$root/server/tests/NavBeacon.Server.UnitTests/NavBeacon.Server.UnitTests.csproj" \
  --configuration Release \
  --no-build \
  -p:CollectCoverage=true \
  -p:CoverletOutput="$coverage" \
  -p:CoverletOutputFormat=json

dotnet test "$root/server/tests/NavBeacon.Server.IntegrationTests/NavBeacon.Server.IntegrationTests.csproj" \
  --configuration Release \
  --no-build \
  -p:CollectCoverage=true \
  -p:CoverletOutput="$root/coverage/server/" \
  -p:CoverletOutputFormat=cobertura \
  -p:MergeWith="$coverage" \
  -p:Threshold="$threshold" \
  -p:ThresholdType=line%2cbranch%2cmethod \
  -p:ThresholdStat=total
