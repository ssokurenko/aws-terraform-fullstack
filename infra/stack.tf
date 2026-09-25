# One stack = one deployed instance of this app = "<project>-<environment>".
# Every stack has its own Terraform state, kept in a workspace with the same name, and its
# own settings file, infra/stacks/<stack>.tfvars. scripts/deploy.sh and destroy.sh take the
# stack name and select both, so stacks never share or overwrite each other's state.
#
# Guard: changing `project` or `environment` in a stack's tfvars would otherwise rename
# (replace) every resource of the deployed stack. The plan stops here instead.
# The "default" workspace is only for `terraform validate` / `terraform test`.

resource "terraform_data" "stack_guard" {
  input = local.name

  lifecycle {
    precondition {
      condition     = terraform.workspace == "default" || terraform.workspace == local.name
      error_message = "Workspace \"${terraform.workspace}\" holds the state of stack \"${terraform.workspace}\", but project-environment is \"${local.name}\". To deploy a new, separate stack, create infra/stacks/${local.name}.tfvars and run ./scripts/deploy.sh ${local.name}. Never change project or environment of an existing stack."
    }
  }
}
