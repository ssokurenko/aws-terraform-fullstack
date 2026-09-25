#!/usr/bin/env bash
# Shared by every script in scripts/. Source it right after `set -euo pipefail`.
#  - On failure, prints the exit code, line and command that failed.
#  - When run in an interactive terminal (e.g. double-clicked in Git Bash), waits for
#    Enter before exiting so the window stays open. Set NO_PAUSE=1 to skip (CI does).
#  - DEBUG=1 traces every command (set -x).

# Refuse to run when the script text is piped or pasted into bash (e.g. VS Code
# "Run Active File In Active Terminal"): commands like terraform and aws would read
# the rest of the script as their input and it would stop half-way.
case "${BASH_SOURCE[1]:-}" in
  *.sh) ;;
  *) echo "Run this script as a file from a Git Bash terminal, e.g.: ./scripts/destroy.sh" >&2
     return 2 2>/dev/null || exit 2 ;;
esac

__on_err() {
  local code=$? line=$1 cmd=$2
  echo >&2
  echo "!! FAILED (exit $code) at ${BASH_SOURCE[1]:-$0}:$line" >&2
  echo "!! command: $cmd" >&2
}

__pause() {
  local code=${1:-$?}
  if [ -t 0 ] && [ -z "${NO_PAUSE:-}" ] && [ -z "${CI:-}" ]; then
    echo
    if [ "$code" -eq 0 ]; then echo "Finished OK."; else echo "Exited with code $code."; fi
    read -r -p "Press Enter to close..." _ || true
  fi
}

# Selects the stack to work on. Usage: use_stack "<stack>"  (needs ROOT and TF set)
# A stack is one deployed instance of the app, named "<project>-<environment>":
#   infra/stacks/<stack>.tfvars     its settings
#   Terraform workspace <stack>     its state (infra/terraform.tfstate.d/<stack>/)
# Sets STACK and VAR_FILE (relative to infra/) and exports TF_WORKSPACE, so every later
# terraform command in the script works on this stack's state only.
use_stack() {
  local name="${1:-}"
  unset TF_WORKSPACE
  if [ -z "$name" ] || [[ "$name" == -* ]] || [ ! -f "$ROOT/infra/stacks/$name.tfvars" ]; then
    [ -n "$name" ] && [[ "$name" != -* ]] && echo "No settings file infra/stacks/$name.tfvars." >&2
    echo "Usage: $(basename "${BASH_SOURCE[1]}") <stack> [terraform options]" >&2
    echo "Stacks (infra/stacks/*.tfvars):" >&2
    local f found=""
    for f in "$ROOT"/infra/stacks/*.tfvars; do
      [ -f "$f" ] && { found=1; echo "  $(basename "$f" .tfvars)" >&2; }
    done
    [ -z "$found" ] && echo "  (none) create one: cp infra/stacks/example.tfvars.example infra/stacks/<project>-<environment>.tfvars" >&2
    return 2
  fi
  if [ -f "$ROOT/infra/terraform.tfvars" ]; then
    echo "infra/terraform.tfvars is loaded into every stack. Move its settings into infra/stacks/<stack>.tfvars and delete it." >&2
    return 2
  fi
  if [ -s "$ROOT/infra/terraform.tfstate" ] && grep -q '"mode": "managed"' "$ROOT/infra/terraform.tfstate"; then
    echo "infra/terraform.tfstate holds a stack deployed before per-stack state. Move it into its own workspace first:" >&2
    echo "  terraform -chdir=infra workspace new <stack>" >&2
    echo "  TF_WORKSPACE=<stack> terraform -chdir=infra state push terraform.tfstate" >&2
    echo "  TF_WORKSPACE=<stack> terraform -chdir=infra state list    # check it's all there" >&2
    echo "  mv infra/terraform.tfstate infra/terraform.tfstate.migrated" >&2
    return 2
  fi

  $TF init -input=false >/dev/null
  if ! $TF workspace list | sed 's/^[* ]*//' | grep -qx "$name"; then
    echo "==> New stack \"$name\": creating its Terraform workspace"
    $TF workspace new "$name" >/dev/null
  fi
  STACK="$name"
  VAR_FILE="stacks/$name.tfvars"
  export TF_WORKSPACE="$name"
  echo "==> Stack: $STACK (settings: infra/$VAR_FILE)"
}

trap '__on_err "$LINENO" "$BASH_COMMAND"' ERR
trap '__pause' EXIT

if [ "${DEBUG:-}" = "1" ]; then set -x; fi
