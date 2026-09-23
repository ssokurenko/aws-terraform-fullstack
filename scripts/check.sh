#!/usr/bin/env bash
# Everything that can be verified without an AWS account. Run before the first deploy
# and before every commit. Optional tools (tflint, trivy) run only when installed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/_lib.sh"
npm_install() { if [ -f package-lock.json ]; then npm ci; else npm install; fi; }
step() { echo; echo "==> $*"; }

step "Backend: install, unit tests, bundle"
(cd "$ROOT/backend" && npm_install >/dev/null && npm test && npm run build)

step "Frontend: install, production build"
(cd "$ROOT/frontend" && npm_install >/dev/null && npm run build)

step "Terraform: format, validate, offline tests (mocked providers)"
cd "$ROOT/infra"
terraform fmt -check -recursive
terraform init -backend=false -input=false >/dev/null
terraform validate
terraform test

if command -v tflint >/dev/null; then
  step "tflint"
  tflint --init >/dev/null && tflint --recursive
else
  echo "(skip) tflint not installed: brew install tflint"
fi

if command -v trivy >/dev/null; then
  step "trivy: IaC misconfiguration scan (report only; fix or accept each finding)"
  trivy config --severity HIGH,CRITICAL .
else
  echo "(skip) trivy not installed: brew install trivy"
fi

echo; echo "All offline checks passed."
