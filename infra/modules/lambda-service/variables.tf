variable "name" {
  description = "Function name (also used for the role and log group)."
  type        = string
}

variable "source_dir" {
  description = "Directory with the built handler (index.js)."
  type        = string
}

variable "handler" {
  type    = string
  default = "index.handler"
}

variable "runtime" {
  type    = string
  default = "nodejs22.x"
}

variable "memory_mb" {
  type    = number
  default = 512
}

variable "timeout_s" {
  type    = number
  default = 15
}

variable "environment" {
  description = "Environment variables."
  type        = map(string)
  default     = {}
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "policy_json" {
  description = "Inline IAM policy with the service's own permissions (least privilege). null for none."
  type        = string
  default     = null
}

variable "log_retention_days" {
  type    = number
  default = 14
}
