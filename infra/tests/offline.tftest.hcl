# Offline infrastructure tests: `terraform test` from infra/.
# Every provider that would call AWS is mocked, so no credentials or account are needed.
# Runs `plan` only and asserts on the configuration's security and wiring rules.

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["ca-central-1a", "ca-central-1b", "ca-central-1d"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_region" {
    defaults = { region = "ca-central-1" }
  }
}

# The Lambda zips don't need to exist.
mock_provider "archive" {}

# Pin anything terraform.tfvars might override, so results don't depend on local settings.
variables {
  project                  = "crud-test"
  environment              = "dev"
  db_proxy_enabled         = true
  db_backup_retention_days = 7
}

run "network_is_private" {
  command = plan

  assert {
    condition     = length(aws_subnet.private) == 2
    error_message = "Expected exactly two private subnets (two AZs)."
  }
  assert {
    condition     = aws_db_instance.main.publicly_accessible == false
    error_message = "RDS must not be publicly accessible."
  }
  assert {
    condition     = aws_db_instance.main.storage_encrypted
    error_message = "RDS storage must be encrypted."
  }
  assert {
    condition     = aws_db_proxy.main[0].require_tls
    error_message = "RDS Proxy must require TLS."
  }
}

run "api_routes" {
  command = plan

  assert {
    condition     = length(aws_api_gateway_method.route) == 9
    error_message = "Expected 9 API methods (5 items + 4 attachments)."
  }
  assert {
    condition     = alltrue([for m in aws_api_gateway_integration.route : m.type == "AWS_PROXY"])
    error_message = "All routes must use Lambda proxy integration."
  }
}

run "buckets_are_locked_down" {
  command = plan

  assert {
    condition = alltrue([
      for b in [aws_s3_bucket_public_access_block.web, aws_s3_bucket_public_access_block.attachments] :
      b.block_public_acls && b.block_public_policy && b.ignore_public_acls && b.restrict_public_buckets
    ])
    error_message = "Both buckets must block all public access."
  }
  assert {
    condition     = anytrue([for r in aws_s3_bucket_cors_configuration.attachments.cors_rule : contains(r.allowed_methods, "POST") && length(r.allowed_methods) == 1])
    error_message = "Attachments CORS must allow POST only."
  }
  assert {
    condition     = anytrue([for r in aws_s3_bucket_lifecycle_configuration.attachments.rule : r.status == "Enabled"])
    error_message = "Unvalidated uploads in incoming/ must expire."
  }
}

run "free_plan_without_proxy" {
  command = plan

  variables {
    db_proxy_enabled         = false
    db_backup_retention_days = 1
  }

  assert {
    condition     = length(aws_db_proxy.main) == 0 && length(aws_secretsmanager_secret.db) == 0
    error_message = "No RDS Proxy or proxy secret without the proxy."
  }
  assert {
    condition     = aws_db_instance.main.backup_retention_period == 1
    error_message = "Backup retention must follow db_backup_retention_days."
  }
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.db_from_lambda) == 1
    error_message = "Lambda must reach RDS directly without the proxy."
  }
  assert {
    condition     = module.items.function_name != "" && output.db_proxy_endpoint == null
    error_message = "Stack must plan without the proxy."
  }
}

run "prod_hardening_flags" {
  command = plan

  variables {
    environment          = "prod"
    deletion_protection  = true
    db_multi_az          = true
    force_destroy_bucket = false
  }

  assert {
    condition     = aws_db_instance.main.deletion_protection && aws_db_instance.main.multi_az
    error_message = "Prod settings must reach the RDS instance."
  }
  assert {
    condition     = aws_db_instance.main.skip_final_snapshot == false
    error_message = "Prod must take a final snapshot on delete."
  }
  assert {
    condition     = aws_s3_bucket.attachments.force_destroy == false
    error_message = "Prod buckets must not be force-destroyable."
  }
}
