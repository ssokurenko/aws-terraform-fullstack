# Two independently deployable Lambda services sharing the VPC and database.
# Build first: (cd ../backend && npm ci && npm run build)
#   -> ../backend/dist/items/index.js, ../backend/dist/attachments/index.js

locals {
  db_env = merge(
    {
      DB_PORT = "5432"
      DB_NAME = var.db_name
      DB_USER = var.db_username
    },
    var.db_proxy_enabled ? {
      DB_HOST = aws_db_proxy.main[0].endpoint
      } : {
      # Direct to RDS (no proxy): password login, one connection per container, and the
      # runtime's CA bundle so TLS to RDS verifies (Node 20+ doesn't load it by default).
      DB_HOST             = aws_db_instance.main.address
      DB_PASSWORD         = random_password.db[0].result
      DB_POOL_MAX         = "1"
      NODE_EXTRA_CA_CERTS = "/var/runtime/ca-cert.pem"
    }
  )

  # IAM database auth to RDS Proxy (no password in Lambda). Not needed without the proxy.
  db_connect_statements = var.db_proxy_enabled ? [{
    Effect   = "Allow"
    Action   = "rds-db:connect"
    Resource = "arn:aws:rds-db:${local.region}:${local.account_id}:dbuser:${local.proxy_resource_id}/${var.db_username}"
  }] : []
}

# ---------- Items service: CRUD on /api/items ----------

module "items" {
  source = "./modules/lambda-service"

  name               = "${local.name}-items"
  source_dir         = "${path.module}/../backend/dist/items"
  memory_mb          = var.lambda_memory_mb
  timeout_s          = var.lambda_timeout_s
  subnet_ids         = aws_subnet.private[*].id
  security_group_ids = [aws_security_group.lambda.id]
  log_retention_days = var.log_retention_days
  environment        = local.db_env

  policy_json = length(local.db_connect_statements) == 0 ? null : jsonencode({
    Version   = "2012-10-17"
    Statement = local.db_connect_statements
  })
}

# ---------- Attachments service: image uploads ----------

module "attachments" {
  source = "./modules/lambda-service"

  name               = "${local.name}-attachments"
  source_dir         = "${path.module}/../backend/dist/attachments"
  memory_mb          = var.lambda_memory_mb
  timeout_s          = 30
  subnet_ids         = aws_subnet.private[*].id
  security_group_ids = [aws_security_group.lambda.id]
  log_retention_days = var.log_retention_days

  environment = merge(local.db_env, {
    BUCKET       = aws_s3_bucket.attachments.id
    MAX_BYTES    = tostring(var.attachment_max_bytes)
    MAX_PER_ITEM = tostring(var.attachments_per_item)
  })

  policy_json = jsonencode({
    Version = "2012-10-17"
    Statement = concat(local.db_connect_statements, [
      {
        # PutObject on incoming/ is what the presigned POST is signed with
        Sid      = "Incoming"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.attachments.arn}/incoming/*"
      },
      {
        Sid      = "Published"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.attachments.arn}/files/*"
      }
    ])
  })
}

# ---------- Triggers ----------

resource "aws_lambda_permission" "items_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.items.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "attachments_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.attachments.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "attachments_s3" {
  statement_id   = "AllowS3Invoke"
  action         = "lambda:InvokeFunction"
  function_name  = module.attachments.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = aws_s3_bucket.attachments.arn
  source_account = local.account_id
}

resource "aws_s3_bucket_notification" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  lambda_function {
    lambda_function_arn = module.attachments.function_arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "incoming/"
  }

  depends_on = [aws_lambda_permission.attachments_s3]
}
