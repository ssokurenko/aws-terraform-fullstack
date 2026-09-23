# Attachments bucket
#   incoming/<item>/<id>.<ext>  browser uploads here via presigned POST (not served)
#   files/<item>/<id>.<ext>     validated copies, served by CloudFront at /files/*

resource "aws_s3_bucket" "attachments" {
  bucket_prefix = "${local.name}-files-"
  force_destroy = var.force_destroy_bucket
}

resource "aws_s3_bucket_public_access_block" "attachments" {
  bucket                  = aws_s3_bucket.attachments.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "attachments" {
  bucket = aws_s3_bucket.attachments.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Browser POSTs straight to S3, so the bucket needs CORS for the app's origin
resource "aws_s3_bucket_cors_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  cors_rule {
    allowed_methods = ["POST"]
    allowed_origins = concat(["https://${aws_cloudfront_distribution.main.domain_name}"], var.extra_upload_origins)
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

# Uploads that never pass validation (or are abandoned) don't pile up
resource "aws_s3_bucket_lifecycle_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  rule {
    id     = "expire-incoming"
    status = "Enabled"
    filter {
      prefix = "incoming/"
    }
    expiration {
      days = 1
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# CloudFront may read published files only, never incoming/
resource "aws_s3_bucket_policy" "attachments" {
  bucket = aws_s3_bucket.attachments.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.attachments.arn}/files/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.main.arn } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.attachments]
}

# ---------- Private path from Lambda to S3 (free gateway endpoint, still no NAT) ----------

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${local.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_vpc.main.main_route_table_id]

  tags = { Name = "${local.name}-s3" }
}

resource "aws_vpc_security_group_egress_rule" "lambda_to_s3" {
  security_group_id = aws_security_group.lambda.id
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
