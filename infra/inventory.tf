# Tag-based Resource Group: one console page listing everything this stack created
# (every resource carries the provider's default tags). Free. deploy.sh prints its link.
# Regional: global services such as CloudFront and IAM are not listed here.

resource "aws_resourcegroups_group" "stack" {
  name = local.name
  # Allowed characters: letters, digits, spaces, _ . - (no commas)
  description = "All resources of ${local.name} matched by Project and Environment tags"

  resource_query {
    query = jsonencode({
      ResourceTypeFilters = ["AWS::AllSupported"]
      TagFilters = [
        { Key = "Project", Values = [var.project] },
        { Key = "Environment", Values = [var.environment] },
      ]
    })
  }
}
