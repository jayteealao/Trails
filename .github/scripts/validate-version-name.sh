#!/usr/bin/env bash
# Checks the manual-release version_name input before any build step runs.
# Accepts semver X.Y.Z with an optional -prerelease and +build part.
# Usage: validate-version-name.sh <version_name>
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <version_name>" >&2
  exit 2
fi

value=$1
pattern='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-((0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?(\+([0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*))?$'

if [[ $value =~ $pattern ]]; then
  echo "version_name $value is valid"
  exit 0
fi

printf "::error::version_name %q is not SemVer 2.0.0 X.Y.Z[-pre][+build]\n" "$value"
exit 1
