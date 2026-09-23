output "app_url" {
  description = "Open this in a browser."
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "api_url_via_cloudfront" {
  value = "https://${aws_cloudfront_distribution.main.domain_name}/api/items"
}

output "api_invoke_url_direct" {
  description = "Direct API Gateway URL (bypasses CloudFront; handy for debugging)."
  value       = "${aws_api_gateway_stage.prod.invoke_url}/api/items"
}

output "web_bucket" {
  value = aws_s3_bucket.web.id
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}

output "db_proxy_endpoint" {
  description = "null when db_proxy_enabled = false."
  value       = one(aws_db_proxy.main[*].endpoint)
}

output "attachments_bucket" {
  value = aws_s3_bucket.attachments.id
}

output "lambda_functions" {
  value = {
    items       = module.items.function_name
    attachments = module.attachments.function_name
  }
}

output "resource_group_url" {
  description = "Console page listing this stack's resources (matched by Project + Environment tags)."
  value       = "https://${local.region}.console.aws.amazon.com/resource-groups/group/${aws_resourcegroups_group.stack.name}?region=${local.region}"
}

output "stack_tag_filter" {
  description = "Tags that identify this stack's resources (for Tag Editor / Resource Explorer searches)."
  value       = "Project=${var.project}, Environment=${var.environment}"
}
