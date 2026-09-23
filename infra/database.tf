# ---------- Credentials ----------
# With RDS Proxy (default): ephemeral password + write-only args (Terraform 1.11+), so the
# password never reaches state. The same value goes to RDS and to the Secrets Manager
# secret RDS Proxy uses to open DB connections.
# Without RDS Proxy (db_proxy_enabled = false, e.g. AWS free plan): Lambda logs in with the
# password from its environment, so it is a regular random_password stored in state.
# Switching db_proxy_enabled on an existing stack: also bump db_password_version.

ephemeral "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%^&*()-_=+" # RDS rejects / @ " and space
}

resource "random_password" "db" {
  count = var.db_proxy_enabled ? 0 : 1

  length           = 32
  special          = true
  override_special = "!#$%^&*()-_=+"
  keepers          = { version = var.db_password_version }
}

locals {
  db_password = var.db_proxy_enabled ? ephemeral.random_password.db.result : random_password.db[0].result
}

resource "aws_secretsmanager_secret" "db" {
  count = var.db_proxy_enabled ? 1 : 0

  name_prefix             = "${local.name}-db-"
  description             = "Master credentials used by RDS Proxy"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "db" {
  count = var.db_proxy_enabled ? 1 : 0

  secret_id = aws_secretsmanager_secret.db[0].id
  secret_string_wo = jsonencode({
    username = var.db_username
    password = local.db_password
  })
  secret_string_wo_version = var.db_password_version
}

# ---------- RDS PostgreSQL ----------

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name}-pg"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 5 # storage autoscaling
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name             = var.db_name
  username            = var.db_username
  password_wo         = local.db_password
  password_wo_version = var.db_password_version

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = var.db_multi_az

  auto_minor_version_upgrade = true
  backup_retention_period    = var.db_backup_retention_days
  backup_window              = "07:00-08:00"
  maintenance_window         = "sun:08:30-sun:09:30"
  copy_tags_to_snapshot      = true

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = "${local.name}-pg-final"

  enabled_cloudwatch_logs_exports = ["postgresql"]
}

# ---------- RDS Proxy (connection pooling for Lambda) ----------
# Not available on AWS free plan accounts: set db_proxy_enabled = false there.

resource "aws_iam_role" "proxy" {
  count = var.db_proxy_enabled ? 1 : 0

  name = "${local.name}-rds-proxy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "rds.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "proxy_secrets" {
  count = var.db_proxy_enabled ? 1 : 0

  name = "read-db-secret"
  role = aws_iam_role.proxy[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.db[0].arn
      },
      {
        Effect    = "Allow"
        Action    = ["kms:Decrypt"]
        Resource  = "*"
        Condition = { StringEquals = { "kms:ViaService" = "secretsmanager.${local.region}.amazonaws.com" } }
      }
    ]
  })
}

resource "aws_db_proxy" "main" {
  count = var.db_proxy_enabled ? 1 : 0

  name                   = "${local.name}-proxy"
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.proxy[0].arn
  vpc_subnet_ids         = aws_subnet.private[*].id
  vpc_security_group_ids = [aws_security_group.proxy.id]
  require_tls            = true
  idle_client_timeout    = 1800

  auth {
    auth_scheme               = "SECRETS"
    secret_arn                = aws_secretsmanager_secret.db[0].arn
    iam_auth                  = "REQUIRED" # clients must present an IAM token
    client_password_auth_type = "POSTGRES_SCRAM_SHA_256"
  }

  depends_on = [aws_secretsmanager_secret_version.db, aws_iam_role_policy.proxy_secrets]
}

resource "aws_db_proxy_default_target_group" "main" {
  count = var.db_proxy_enabled ? 1 : 0

  db_proxy_name = aws_db_proxy.main[0].name

  connection_pool_config {
    max_connections_percent      = 90
    max_idle_connections_percent = 50
    connection_borrow_timeout    = 120
  }
}

resource "aws_db_proxy_target" "main" {
  count = var.db_proxy_enabled ? 1 : 0

  db_proxy_name          = aws_db_proxy.main[0].name
  target_group_name      = aws_db_proxy_default_target_group.main[0].name
  db_instance_identifier = aws_db_instance.main.identifier
}

locals {
  # arn:aws:rds:<region>:<acct>:db-proxy:prx-xxxx -> prx-xxxx
  proxy_resource_id = var.db_proxy_enabled ? element(split(":", aws_db_proxy.main[0].arn), 6) : null
}
