variable "project" {
  description = "Short project name, used as a resource name prefix."
  type        = string
  default     = "crud-app"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)."
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region for all regional resources."
  type        = string
  default     = "ca-central-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

# ---------- Database ----------

variable "db_name" {
  description = "Initial PostgreSQL database name."
  type        = string
  default     = "app"
}

variable "db_username" {
  description = "Master username. Lambda connects as this user through RDS Proxy using IAM auth."
  type        = string
  default     = "app_admin"
}

variable "db_engine_version" {
  description = "PostgreSQL major version (auto minor upgrades pick the patch)."
  type        = string
  default     = "17"
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Initial storage in GiB."
  type        = number
  default     = 20
}

variable "db_multi_az" {
  description = "Multi-AZ standby. Turn on for production."
  type        = bool
  default     = false
}

variable "db_password_version" {
  description = "Bump to rotate the master password (write-only argument trigger)."
  type        = number
  default     = 1
}

variable "db_backup_retention_days" {
  description = "Days of automated RDS backups (0-35). AWS free plan accounts allow at most 1."
  type        = number
  default     = 7

  validation {
    condition     = var.db_backup_retention_days >= 0 && var.db_backup_retention_days <= 35
    error_message = "db_backup_retention_days must be between 0 and 35."
  }
}

variable "db_proxy_enabled" {
  description = <<-EOT
    Put RDS Proxy (pooling + IAM auth, no password in Lambda) between Lambda and RDS.
    Not available on AWS free plan accounts: set false there, and Lambda connects to RDS
    directly with a password in its environment. Bump db_password_version when changing this.
  EOT
  type        = bool
  default     = true
}

variable "deletion_protection" {
  description = "Protect the DB from accidental deletion. Set true for prod."
  type        = bool
  default     = false
}

# ---------- Lambda / API ----------

variable "lambda_memory_mb" {
  description = "Lambda memory size."
  type        = number
  default     = 512
}

variable "lambda_timeout_s" {
  description = "Lambda timeout in seconds (API Gateway caps integrations at 29s by default)."
  type        = number
  default     = 15
}

variable "api_throttle_rate" {
  description = "Steady-state requests per second for the API stage."
  type        = number
  default     = 50
}

variable "api_throttle_burst" {
  description = "Burst limit for the API stage."
  type        = number
  default     = 100
}

variable "log_retention_days" {
  description = "CloudWatch log retention."
  type        = number
  default     = 14
}

# ---------- Attachments ----------

variable "attachment_max_bytes" {
  description = "Max image size. Enforced by the presigned POST policy and re-checked after upload."
  type        = number
  default     = 2097152 # 2 MB
}

variable "attachments_per_item" {
  description = "Max images per item."
  type        = number
  default     = 10
}

variable "extra_upload_origins" {
  description = "Extra origins allowed to upload directly to S3 (e.g. local Vite dev server)."
  type        = list(string)
  default     = ["http://localhost:5173"]
}

# ---------- Frontend ----------

variable "cloudfront_price_class" {
  description = "PriceClass_100 (NA+EU), PriceClass_200, or PriceClass_All."
  type        = string
  default     = "PriceClass_100"
}

variable "force_destroy_bucket" {
  description = "Allow terraform destroy to delete non-empty buckets (web + attachments). False for prod."
  type        = bool
  default     = true
}
