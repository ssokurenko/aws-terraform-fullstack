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

trap '__on_err "$LINENO" "$BASH_COMMAND"' ERR
trap '__pause' EXIT

if [ "${DEBUG:-}" = "1" ]; then set -x; fi
