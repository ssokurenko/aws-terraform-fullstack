#!/usr/bin/env bash
# Full deploy: build services -> terraform apply -> build SPA -> upload -> invalidate.
# Usage: ./scripts/deploy.sh [-auto-approve]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/_lib.sh"
TF="terraform -chdir=$ROOT/infra"

# npm ci needs a lockfile; the first run creates one with npm install (commit it).
npm_install() { if [ -f package-lock.json ]; then npm ci; else npm install; fi; }

echo "==> Building Lambda services (items, attachments)"
(cd "$ROOT/backend" && npm_install && npm run build)

echo "==> Terraform apply"
$TF init -input=false
$TF apply "$@"

BUCKET=$($TF output -raw web_bucket)
DIST_ID=$($TF output -raw cloudfront_distribution_id)
APP_URL=$($TF output -raw app_url)
RG_URL=$($TF output -raw resource_group_url)
RG_TAGS=$($TF output -raw stack_tag_filter)

echo "==> Building SPA"
(cd "$ROOT/frontend" && npm_install && npm run build)

echo "==> Uploading to s3://$BUCKET"
# Hashed assets: cache for a year. index.html: always revalidate.
aws s3 sync "$ROOT/frontend/dist" "s3://$BUCKET" --delete \
  --exclude index.html --cache-control "public,max-age=31536000,immutable"
aws s3 cp "$ROOT/frontend/dist/index.html" "s3://$BUCKET/index.html" \
  --cache-control "no-cache"

echo "==> Invalidating CloudFront"
# MSYS_NO_PATHCONV: stop Git Bash on Windows rewriting "/index.html" into a C:/ path.
MSYS_NO_PATHCONV=1 aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/index.html" >/dev/null

echo
echo "==> Check the created resources in the AWS console (Resource Group, tags: $RG_TAGS):"
echo "    $RG_URL"
echo "    Lists this region's resources; CloudFront and IAM roles are global and not shown there."
echo
echo "Done: $APP_URL"
