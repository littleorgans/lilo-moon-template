#!/usr/bin/env bash

set -euo pipefail

source_scope="lilo"
source_scope+="-moon"
source_org="little"
source_org+="organs"
source_slug="${source_scope}-template"

usage() {
  printf 'Usage: just rename <org> <scope> <slug>\n' >&2
}

fail() {
  printf '%s\n' "$1" >&2
  exit 64
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

verify_absent() {
  local found=0
  local token

  for token in "$source_slug" "$source_org" "$source_scope"; do
    if git grep -q -F -e "$token" --; then
      printf 'Rename verification failed. Tracked files still contain "%s":\n' "$token" >&2
      git grep -n -F -e "$token" -- >&2
      found=1
    fi
  done

  if ((found != 0)); then
    return 1
  fi

  printf 'Rename verification passed. No template identity tokens remain in tracked files.\n'
}

validate_target() {
  local label="$1"
  local value="$2"
  local source="$3"

  if [[ ! "$value" =~ ^[[:alnum:]][[:alnum:]_.-]*$ ]]; then
    fail "$label must contain only letters, numbers, periods, underscores, and hyphens."
  fi
  if [[ "$value" == "$source" ]]; then
    fail "$label must differ from the template value."
  fi
  if [[ "$value" == *"$source_slug"* || "$value" == *"$source_org"* || "$value" == *"$source_scope"* ]]; then
    fail "$label must not contain a template identity token."
  fi
}

require_command git
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "Run this command inside a Git repository."
cd "$repo_root"

if [[ "${1:-}" == "--verify" ]]; then
  [[ "$#" -eq 1 ]] || fail "The --verify mode takes no other arguments."
  verify_absent
  exit 0
fi

if [[ "$#" -ne 3 ]]; then
  usage
  exit 64
fi

target_org="$1"
target_scope="$2"
target_slug="$3"

validate_target "Organization" "$target_org" "$source_org"
validate_target "Package scope without @" "$target_scope" "$source_scope"
validate_target "Repository slug" "$target_slug" "$source_slug"
require_command perl
require_command pnpm

replaced_files=0
while IFS= read -r -d '' file; do
  if [[ -f "$file" ]] && LC_ALL=C grep -q -F \
    -e "$source_slug" -e "$source_org" -e "$source_scope" -- "$file"; then
    SOURCE_SLUG="$source_slug" TARGET_SLUG="$target_slug" \
      SOURCE_ORG="$source_org" TARGET_ORG="$target_org" \
      SOURCE_SCOPE="$source_scope" TARGET_SCOPE="$target_scope" \
      perl -0pi -e '
        s/\Q$ENV{SOURCE_SLUG}\E/$ENV{TARGET_SLUG}/g;
        s/\Q$ENV{SOURCE_ORG}\E/$ENV{TARGET_ORG}/g;
        s/\Q$ENV{SOURCE_SCOPE}\E/$ENV{TARGET_SCOPE}/g;
      ' -- "$file"
    replaced_files=$((replaced_files + 1))
  fi
done < <(git ls-files -z)

printf 'Updated %d tracked files. Refreshing the pnpm lockfile.\n' "$replaced_files"
pnpm install
verify_absent
