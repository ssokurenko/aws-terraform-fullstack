# REST API (API Gateway v1). Paths live under /api so CloudFront can route
# /api/* here on the same domain as the SPA: no CORS in production.
#
#   Items service
#     GET    /api/items                          list
#     POST   /api/items                          create
#     GET    /api/items/{id}                     read
#     PUT    /api/items/{id}                     update
#     DELETE /api/items/{id}                     delete
#   Attachments service
#     GET    /api/items/{id}/attachments         list ready images
#     POST   /api/items/{id}/attachments         get presigned upload
#     GET    /api/attachments/{attachmentId}     status (pending/ready/rejected)
#     DELETE /api/attachments/{attachmentId}     delete

resource "aws_api_gateway_rest_api" "main" {
  name = "${local.name}-api"

  endpoint_configuration {
    types = ["REGIONAL"] # CloudFront sits in front, so no edge-optimized double hop
  }
}

resource "aws_api_gateway_resource" "api" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "api"
}

resource "aws_api_gateway_resource" "items" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.api.id
  path_part   = "items"
}

resource "aws_api_gateway_resource" "item" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.items.id
  path_part   = "{id}"
}

resource "aws_api_gateway_resource" "item_attachments" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.item.id
  path_part   = "attachments"
}

resource "aws_api_gateway_resource" "attachments" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.api.id
  path_part   = "attachments"
}

resource "aws_api_gateway_resource" "attachment" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.attachments.id
  path_part   = "{attachmentId}"
}

locals {
  service_invoke_arn = {
    items       = module.items.invoke_arn
    attachments = module.attachments.invoke_arn
  }

  routes = {
    items_list         = { resource_id = aws_api_gateway_resource.items.id, method = "GET", service = "items" }
    items_create       = { resource_id = aws_api_gateway_resource.items.id, method = "POST", service = "items" }
    items_read         = { resource_id = aws_api_gateway_resource.item.id, method = "GET", service = "items" }
    items_update       = { resource_id = aws_api_gateway_resource.item.id, method = "PUT", service = "items" }
    items_delete       = { resource_id = aws_api_gateway_resource.item.id, method = "DELETE", service = "items" }
    attachments_list   = { resource_id = aws_api_gateway_resource.item_attachments.id, method = "GET", service = "attachments" }
    attachments_create = { resource_id = aws_api_gateway_resource.item_attachments.id, method = "POST", service = "attachments" }
    attachments_read   = { resource_id = aws_api_gateway_resource.attachment.id, method = "GET", service = "attachments" }
    attachments_delete = { resource_id = aws_api_gateway_resource.attachment.id, method = "DELETE", service = "attachments" }
  }
}

resource "aws_api_gateway_method" "route" {
  for_each = local.routes

  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = each.value.resource_id
  http_method   = each.value.method
  authorization = "NONE" # swap for COGNITO_USER_POOLS when you add auth
}

resource "aws_api_gateway_integration" "route" {
  for_each = local.routes

  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = each.value.resource_id
  http_method             = aws_api_gateway_method.route[each.key].http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST" # Lambda is always invoked with POST
  uri                     = local.service_invoke_arn[each.value.service]
}

resource "aws_api_gateway_deployment" "main" {
  rest_api_id = aws_api_gateway_rest_api.main.id

  # Redeploy whenever routes or integrations change
  triggers = {
    redeployment = sha1(jsonencode([
      local.routes,
      [for k, m in aws_api_gateway_method.route : m.id],
      [for k, i in aws_api_gateway_integration.route : [i.id, i.uri]],
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "prod" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  deployment_id = aws_api_gateway_deployment.main.id
  stage_name    = "prod"
}

resource "aws_api_gateway_method_settings" "all" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  stage_name  = aws_api_gateway_stage.prod.stage_name
  method_path = "*/*"

  settings {
    throttling_rate_limit  = var.api_throttle_rate
    throttling_burst_limit = var.api_throttle_burst
    metrics_enabled        = true
  }
}
