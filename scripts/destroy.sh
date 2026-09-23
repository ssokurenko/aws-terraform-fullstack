#!/usr/bin/env bash
# Tear down everything deploy.sh created.
# Usage: ./scripts/destroy.sh            (asks for confirmation)
#        ./scripts/destroy.sh -auto-approve
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/_lib.sh"
TF="terraform -chdir=$ROOT/infra"

$TF init -input=false >/dev/null

if ! $TF state list >/dev/null 2>&1 || [ -z "$($TF state list 2>/dev/null)" ]; then
  echo "Nothing in Terraform state. Nothing to destroy."
  exit 0
fi

# 1. The archive_file data source is evaluated during destroy too; it fails if
#    backend/dist is missing (fresh clone, cleaned build). A stub is enough.
for svc in items attachments; do
  if [ ! -f "$ROOT/backend/dist/$svc/index.js" ]; then
    mkdir -p "$ROOT/backend/dist/$svc"
    echo "exports.handler=async()=>({statusCode:410});" > "$ROOT/backend/dist/$svc/index.js"
  fi
done

# 2. Deletion protection blocks destroy. Refuse rather than silently disabling it.
DB_ID=$($TF state show -no-color aws_db_instance.main 2>/dev/null | awk -F'"' '/^ *identifier  *=/{print $2; exit}')
# Keep every $(...) on one line: bash 5.3 misparses a line-continued one when the shell
# is interactive, which is how Git Bash runs a .sh started from PowerShell or Explorer.
PROTECTED=""
if [ -n "${DB_ID:-}" ]; then
  PROTECTED=$(aws rds describe-db-instances --db-instance-identifier "$DB_ID" --query 'DBInstances[0].DeletionProtection' --output text 2>/dev/null || true)
fi
if [ "$PROTECTED" = "True" ]; then
  echo "RDS instance $DB_ID has deletion protection on."
  echo "Set deletion_protection = false in terraform.tfvars, run ./scripts/deploy.sh, then retry."
  exit 1
fi

# 3. Empty both buckets so destroy works even when force_destroy_bucket = false.
for out in web_bucket attachments_bucket; do
  BUCKET=$($TF output -raw "$out" 2>/dev/null || true)
  if [ -n "$BUCKET" ] && aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
    echo "==> Emptying s3://$BUCKET"
    aws s3 rm "s3://$BUCKET" --recursive --only-show-errors
  fi
done

# 4. Destroy. Expect 15-30 min: CloudFront disable, RDS delete, and Lambda VPC
#    network interfaces (they release a while after the function is gone).
echo "==> terraform destroy"
$TF destroy "$@"

# 5. Clean up what RDS created outside Terraform.
if [ -n "${DB_ID:-}" ]; then
  LOG_GROUP="/aws/rds/instance/$DB_ID/postgresql"
  MSYS_NO_PATHCONV=1 aws logs delete-log-group --log-group-name "$LOG_GROUP" 2>/dev/null \
    && echo "Deleted log group $LOG_GROUP" || true

  SNAPS=$(aws rds describe-db-snapshots --db-instance-identifier "$DB_ID" --snapshot-type manual --query 'DBSnapshots[].DBSnapshotIdentifier' --output text 2>/dev/null || true)
  if [ -n "$SNAPS" ] && [ "$SNAPS" != "None" ]; then
    echo "Kept manual snapshot(s), which still cost storage: $SNAPS"
    echo "Delete with: aws rds delete-db-snapshot --db-snapshot-identifier <id>"
  fi
fi

rm -rf "$ROOT/infra/.build"
echo "Done. All stack resources removed."
