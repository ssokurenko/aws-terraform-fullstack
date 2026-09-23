# Serverless CRUD on AWS (Terraform)

> [!IMPORTANT]
> **This is a demo project.** It shows how quickly you can scaffold a full-stack serverless app and provision the AWS resources it needs. It is not a production-ready product: see the [Production checklist](#production-checklist) before using it for anything real.
>
> The main idea is that the whole stack is easy to **set up, deploy and destroy** when you need it, one script per step:
>
> | Step | Command | What it does |
> |------|---------|--------------|
> | Run locally | `./scripts/dev.sh` | Whole app on your machine with Docker, no AWS account |
> | Check | `./scripts/check.sh` | Tests, builds, Terraform validate and offline plan tests |
> | Deploy | `./scripts/deploy.sh` | Builds everything, provisions AWS with Terraform, publishes the SPA |
> | Destroy | `./scripts/destroy.sh` | Empties buckets and removes every AWS resource the stack created |
>
> Deployed resources cost money while they exist (mostly RDS), so destroy the stack when you're done. See [Cost](#cost-dev-defaults-rough).

A full-stack serverless scaffold: a React SPA on S3 + CloudFront, a REST API on API Gateway, two Lambda services (**items** and **attachments**) and PostgreSQL on RDS behind RDS Proxy. Items can carry image attachments (JPEG, PNG, GIF or WebP, 2 MB max) that are uploaded directly to S3 and served through CloudFront.

- [Architecture](#architecture)
- [Image upload flow](#image-upload-flow)
- [Repository layout](#repository-layout)
- [Local development (no AWS account)](#local-development-no-aws-account)
- [Deploy from your machine](#deploy-from-your-machine)
- [Day-to-day changes](#day-to-day-changes)
- [Tear down](#tear-down)
- [Troubleshooting](#troubleshooting)
- [CI/CD roadmap](#cicd-roadmap)
- [Production checklist](#production-checklist)

## Architecture

```mermaid
flowchart LR
    user(["Browser<br/>React SPA"])

    subgraph edge["CloudFront (one domain, HTTPS)"]
        cf["Distribution<br/>+ SPA rewrite function"]
    end

    subgraph region["AWS region"]
        web[("S3: web<br/>SPA build")]
        files[("S3: attachments<br/>incoming/ · files/")]
        apigw["API Gateway<br/>REST · stage prod"]
        sm["Secrets Manager<br/>DB credentials"]

        subgraph vpc["VPC: private subnets only, no NAT"]
            items["λ items service"]
            att["λ attachments service"]
            proxy["RDS Proxy<br/>IAM auth · TLS"]
            db[("RDS PostgreSQL 17")]
            s3ep["S3 gateway endpoint"]
        end
    end

    user -->|"HTTPS"| cf
    cf -->|"/*"| web
    cf -->|"/files/*"| files
    cf -->|"/api/*"| apigw
    apigw -->|"/api/items..."| items
    apigw -->|"/api/.../attachments"| att
    items -->|"IAM token"| proxy
    att -->|"IAM token"| proxy
    proxy --> db
    proxy -.->|"reads creds"| sm
    user -.->|"presigned POST<br/>≤ 2 MB image"| files
    files -.->|"ObjectCreated incoming/"| att
    att -->|"validate, copy to files/"| s3ep
    s3ep --> files
```

| Path | Served by | Caching |
|------|-----------|---------|
| `/*` | S3 web bucket via Origin Access Control | Managed-CachingOptimized, SPA deep links rewritten to `/index.html` |
| `/api/*` | API Gateway → Lambda | Disabled |
| `/files/*` | S3 attachments bucket (`files/` prefix only) | Optimized; keys are immutable UUIDs |

### Services

| Service | Lambda | Routes |
|---------|--------|--------|
| items | `<project>-<env>-items` | `GET/POST /api/items`, `GET/PUT/DELETE /api/items/{id}` |
| attachments | `<project>-<env>-attachments` | `GET/POST /api/items/{id}/attachments`, `GET/DELETE /api/attachments/{attachmentId}`, plus the S3 `ObjectCreated` trigger |

Each service has its own IAM role (least privilege) and its own zip, built from `backend/src/<service>.mjs`. Both share `backend/src/shared/` (DB pool, HTTP helpers) and the same VPC, RDS Proxy and database.

## Image upload flow

File bytes never pass through API Gateway or Lambda: the browser uploads straight to S3, and S3 itself enforces the rules signed into the upload policy.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant A as attachments λ
    participant DB as PostgreSQL
    participant S3 as S3 attachments
    participant CF as CloudFront

    B->>A: POST /api/items/{id}/attachments {fileName, contentType, size}
    A->>A: type in JPEG/PNG/GIF/WebP? size ≤ 2 MB? item exists? < 10 images?
    A->>DB: INSERT attachment (status = pending)
    A-->>B: 201 {attachment, upload: {url, fields}} (valid 5 min)
    B->>S3: POST multipart form to incoming/{item}/{id}.{ext}
    Note over S3: Policy enforces exact key, exact Content-Type,<br/>content-length-range 1..2,097,152 bytes
    S3-->>B: 204
    S3->>A: ObjectCreated event (incoming/)
    A->>S3: HEAD + GET bytes 0-15
    A->>A: size ok? magic bytes match declared type?
    alt valid image
        A->>S3: Copy to files/{item}/{id}.{ext}, delete incoming
        A->>DB: status = ready
    else invalid
        A->>S3: delete incoming object
        A->>DB: status = rejected
    end
    loop until ready or rejected
        B->>A: GET /api/attachments/{id}
    end
    B->>CF: GET /files/{item}/{id}.{ext}
    CF->>S3: fetch via OAC (files/ only)
```

Why this shape:

- **Three layers of the 2 MB / image-only rule.** The UI checks first for fast feedback, S3 rejects anything outside the signed policy, and the validator checks real file signatures so a renamed `.exe` never gets published.
- **SVG is not allowed.** SVG can carry script; raster formats cannot.
- **Nothing unvalidated is ever served.** CloudFront can read only `files/`. Anything left in `incoming/` expires after one day through a lifecycle rule.
- **Still no NAT gateway.** Lambda reaches S3 through a free gateway endpoint. Presigned POSTs are signed locally, with no network call.

## Repository layout

```
infra/
  versions.tf         Terraform/provider versions, default tags, optional S3 backend
  variables.tf        All inputs with defaults
  network.tf          VPC, private subnets, security groups
  database.tf         RDS PostgreSQL, Secrets Manager, RDS Proxy
  services.tf         items + attachments Lambda services and their triggers
  attachments.tf      Attachments bucket, CORS, lifecycle, S3 gateway endpoint
  api.tf              API Gateway REST resources, methods, stage
  frontend.tf         Web bucket, CloudFront (3 origins), SPA rewrite function
  outputs.tf
  modules/lambda-service/   zip + IAM role + log group + VPC Lambda
  tests/offline.tftest.hcl  `terraform test` with mocked providers (no AWS needed)
backend/
  src/items.mjs         items service handler
  src/attachments.mjs   attachments service handler (API + S3 validator)
  src/shared/           DB pool (IAM auth in AWS, password locally), image rules, HTTP helpers
  dev/server.mjs        local API Gateway + /files + S3-event emulator running the real handlers
  dev/local.env         local settings
  test/                 unit tests (node --test)
frontend/               Vite + React 19 SPA (relative /api and /files URLs)
local/compose.yaml      Postgres 17 + MinIO (S3 emulator) for local development
scripts/dev.sh          run everything locally
scripts/check.sh        all offline checks: tests, builds, terraform fmt/validate/test, linters
scripts/deploy.sh       build → terraform apply → upload SPA → invalidate
scripts/destroy.sh      empty buckets → terraform destroy → clean leftovers
.github/workflows/ci-cd.yml.example   starter pipeline (see roadmap)
```

## Local development (no AWS account)

Build and test the whole app on your machine before creating any cloud resources. The Lambda handlers run unchanged; only the services around them are swapped for local stand-ins.

```mermaid
flowchart LR
    vite["Vite dev server<br/>:5173 (hot reload)"]
    dev["backend/dev/server.mjs<br/>:3001"]
    subgraph docker["Docker (local/compose.yaml)"]
        pg[("Postgres 17<br/>:5432")]
        minio[("MinIO S3 API<br/>:9000")]
    end
    vite -->|"/api/*, /files/*"| dev
    vite -.->|"presigned POST"| minio
    dev -->|"items / attachments handlers"| pg
    dev -->|"polls incoming/,<br/>serves files/"| minio
```

| In AWS | Locally | Notes |
|--------|---------|-------|
| CloudFront `/api/*`, `/files/*` | Vite proxy → dev server | Same relative URLs in the frontend |
| API Gateway (AWS_PROXY) | `backend/dev/server.mjs` | Same routes and event shape as `infra/api.tf` |
| Lambda | Same handler code, in-process | Restarts on file changes (`node --watch`) |
| RDS Proxy + IAM auth | Direct connection with `DB_PASSWORD` | Only when `DB_PASSWORD` is set |
| S3 + presigned POST | MinIO | Enforces the same POST policy (2 MB, exact Content-Type) |
| S3 `ObjectCreated` trigger | Dev server polls `incoming/` every second | Same event shape the handler gets from S3 |

### Prerequisites

- Node.js 22
- Docker Desktop (or Docker Engine with the Compose plugin)
- Terraform ≥ 1.11, only for the infrastructure checks

### Run the app

```bash
./scripts/dev.sh
```

Open http://localhost:5173. The script starts Postgres and MinIO in Docker, installs dependencies on first run, starts the API dev server on :3001 and Vite on :5173. Tables are created on the first request.

Useful extras:

- API directly: `curl -s localhost:3001/api/items`
- Stored files: MinIO console at http://localhost:9001 (user `localdev`, password `localdev-secret`)

The passwords and keys in `local/compose.yaml` and `backend/dev/local.env` are **not real secrets**. They are fixed placeholders for local containers bound to `127.0.0.1`, and they are committed on purpose so the app runs without any setup. Real credentials never go in these files. In AWS, the DB password is generated by Terraform and Lambda uses IAM roles, not access keys.
- Database: `docker compose -f local/compose.yaml exec postgres psql -U app_admin app`
- Stop containers: `docker compose -f local/compose.yaml down` (add `-v` to wipe data)

Try the attachment rules: upload a 3 MB photo (blocked in the browser; with the check bypassed, MinIO rejects it with HTTP 400), or rename a PDF to `.png` (the upload succeeds, then the validator deletes it and the UI reports it isn't a valid image).

### Run the checks

```bash
./scripts/check.sh
```

| Check | What it proves |
|-------|----------------|
| `npm test` (backend) | Image type allowlist, 2 MB boundary, file-signature detection |
| `npm run build` (backend, frontend) | Both Lambda bundles and the SPA compile |
| `terraform fmt -check`, `terraform validate` | HCL is formatted, references and types are valid |
| `terraform test` | Plans the full stack against mocked AWS providers and asserts the rules: private DB, TLS proxy, 9 routes, locked-down buckets, POST-only CORS, prod hardening flags |
| `tflint`, `trivy config` (if installed) | Provider-specific lint and security misconfigurations (trivy reports; decide per finding) |

`terraform test` needs no credentials: `infra/tests/offline.tftest.hcl` mocks the AWS and archive providers. A real `terraform plan` does need AWS credentials, because it reads your account, region and availability zones.

### What local mode doesn't cover

Verify these on the first real deploy: IAM policies and IAM database auth, RDS Proxy behavior, CloudFront routing and caching, VPC networking and security groups, and real S3 event timing. Keep the dev stack small and short-lived (`./scripts/destroy.sh`) and it stays cheap.

## Deploy from your machine

### 1. Install the tools

| Tool | Version | Check |
|------|---------|-------|
| Terraform | ≥ 1.11 (write-only arguments) | `terraform version` |
| Node.js | 22 | `node -v` |
| AWS CLI | v2 | `aws --version` |
| Bash | any (macOS, Linux, WSL or Git Bash on Windows) | |

macOS: `brew install hashicorp/tap/terraform node@22 awscli`. Windows: use WSL2 and the Linux instructions.

### 2. Sign in to AWS

Use IAM Identity Center (SSO) instead of long-lived access keys, and never the root user.

1. In the AWS console, open **IAM Identity Center**, enable it, create a user for yourself and assign it to your account with the `AdministratorAccess` permission set. The stack creates IAM roles, so `PowerUserAccess` is not enough.
2. Configure the CLI profile and sign in:

```bash
aws configure sso                 # name the profile e.g. "crud-dev", region ca-central-1
aws sso login --profile crud-dev
export AWS_PROFILE=crud-dev
aws sts get-caller-identity       # should print your account ID
```

3. Recommended: in **Billing → Budgets**, create a monthly cost budget with an email alert.

### 3. Configure the stack

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
```

Edit `infra/terraform.tfvars`: `project`, `environment`, `aws_region` at minimum. Every other variable in `infra/variables.tf` has a working default.

Optional but recommended: turn on remote state before the first apply. Create an S3 bucket for state once:

```bash
aws s3api create-bucket --bucket <your-tf-state-bucket> --region ca-central-1 \
  --create-bucket-configuration LocationConstraint=ca-central-1
aws s3api put-bucket-versioning --bucket <your-tf-state-bucket> \
  --versioning-configuration Status=Enabled
```

Then uncomment the `backend "s3"` block in `infra/versions.tf` and set the bucket name. Local state works for a solo sandbox, but CI/CD needs remote state.

### 4. Deploy

Run `./scripts/check.sh` first; it catches most mistakes before anything is created.

```bash
./scripts/deploy.sh                # review the plan, type "yes"
# or: ./scripts/deploy.sh -auto-approve
```

What happens:

1. `backend/` installs and bundles both services with esbuild into `backend/dist/items/` and `backend/dist/attachments/`.
2. `terraform apply` creates about 60 resources. The first run takes around 15 minutes, mostly RDS, RDS Proxy and CloudFront.
3. `frontend/` builds, uploads to the web bucket, and CloudFront invalidates `index.html`.
4. The app URL is printed at the end.

The first `npm install` creates `package-lock.json` files. Commit them so later installs (and CI) use `npm ci`.

### 5. Verify

```bash
cd infra
APP=$(terraform output -raw app_url)

curl -s -X POST "$APP/api/items" -H 'Content-Type: application/json' \
  -d '{"name":"First item","description":"hello"}'
curl -s "$APP/api/items"
```

Open the app URL, add an item, click **Images** and upload a picture. It appears within a second or two once validation finishes.

Logs:

```bash
aws logs tail /aws/lambda/crud-app-dev-items --follow
aws logs tail /aws/lambda/crud-app-dev-attachments --follow
```

### 6. Run the frontend locally against the deployed API

```bash
cd frontend
VITE_API_ORIGIN=$(terraform -chdir=../infra output -raw app_url) npm run dev
```

Vite proxies `/api` and `/files` to CloudFront. Direct uploads from `http://localhost:5173` are allowed by the bucket CORS rule (`extra_upload_origins`).

## Day-to-day changes

| You changed | Run | Time |
|-------------|-----|------|
| Lambda code (`backend/src`) | `./scripts/deploy.sh` (Terraform sees the new zip hash and updates only the function) | ~1 min |
| Frontend (`frontend/src`) | `./scripts/deploy.sh`, or build + `aws s3 sync` + invalidation only | ~1 min |
| Infrastructure (`infra/`) | `./scripts/deploy.sh` and read the plan carefully | varies |
| DB password rotation | bump `db_password_version` in tfvars, deploy | ~2 min |

## Tear down

```bash
./scripts/destroy.sh               # pass -auto-approve to skip the prompt
```

Empties both buckets, runs `terraform destroy`, then removes the RDS log group that RDS creates outside Terraform. Takes 15-30 minutes, mostly RDS deletion and the release of Lambda's VPC network interfaces. It refuses to run while RDS deletion protection is on, and it tells you about any manual snapshots left behind (created when `environment = "prod"`).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Unsupported argument "password_wo"` | Terraform older than 1.11 | Upgrade Terraform |
| `archive_file ... no such file or directory` | Backend not built | `cd backend && npm install && npm run build` |
| Access denied during apply on a new account | Free-plan service limits | Upgrade the account to the paid plan (remaining credits still apply) |
| `FreeTierRestrictionError` on RDS backup retention or RDS Proxy | AWS free plan account | Set `db_proxy_enabled = false` and `db_backup_retention_days = 1` in `terraform.tfvars`. Lambda then connects to RDS directly with a password (kept in state and the Lambda environment). After upgrading, remove both and bump `db_password_version` |
| API returns 500 right after the first deploy | RDS Proxy target still registering | Wait 1-2 minutes and retry |
| Upload fails with HTTP 403 from S3 | Presigned POST expired (5 min) or wrong origin | Retry; for a new domain add it to CORS |
| Upload fails with HTTP 400 from S3 | File over 2 MB or Content-Type mismatch | Expected behavior |
| Image stays "processing" | Validator error | `aws logs tail /aws/lambda/<name>-attachments` |
| Destroy hangs on subnets or security groups | Lambda network interfaces releasing | Wait; it finishes on its own (up to ~20 min) |

## CI/CD roadmap

The goal is for every code change to go through a pull request with a reviewed Terraform plan, and merges to deploy automatically, with no long-lived AWS keys anywhere. A starter pipeline is in `.github/workflows/ci-cd.yml.example`.

```mermaid
flowchart LR
    pr["Pull request"] --> build["Build + unit tests<br/>backend + frontend"]
    build --> checks["terraform fmt / validate<br/>tflint · checkov"]
    checks --> plan["terraform plan<br/>posted as PR comment"]
    plan --> review{"Code review"}
    review -->|merge to main| dev["Apply to dev<br/>publish SPA · smoke test"]
    dev --> stg["Staging<br/>auto after dev is green"]
    stg --> gate{"Manual approval"}
    gate --> prod["Production<br/>canary Lambda alias"]
```

### Phase 1: Foundations (do before enabling the pipeline)

- **Remote state** per environment: S3 backend with `use_lockfile = true`, one state key per environment (`crud/dev.tfstate`, `crud/prod.tfstate`).
- **GitHub OIDC deploy role** per AWS account, so CI gets short-lived credentials instead of stored keys. Create it once, for example in a small `bootstrap/` Terraform stack:

```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "deploy" {
  name = "github-deploy-crud"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = "repo:<org>/<repo>:*" }
      }
    }]
  })
}
# Attach AdministratorAccess to start; narrow it once the resource set is stable.
```

- Store the role ARN as the repo variable `AWS_DEPLOY_ROLE_ARN`, create a GitHub environment `dev`, commit the `package-lock.json` files, then rename `ci-cd.yml.example` to `ci-cd.yml`.

### Phase 2: Pull request checks

- Build both services and the SPA; add unit tests (Vitest for the frontend, `node --test` for the handlers).
- `terraform fmt -check`, `terraform validate`, [tflint](https://github.com/terraform-linters/tflint) and [checkov](https://www.checkov.io/) or trivy for security misconfigurations.
- `terraform plan` posted as a PR comment so reviewers see infrastructure changes next to code changes.

### Phase 3: Continuous deployment to dev

- On merge to `main`: apply the saved plan (the one reviewers saw), publish the SPA, invalidate `index.html`, run a smoke test against `/api/items`.
- Use a `concurrency` group so two applies never run at once (already in the example).

### Phase 4: Multiple environments

- Same Terraform, different `*.tfvars` and state keys; ideally separate AWS accounts per environment (AWS Organizations).
- Promotion: dev (auto) → staging (auto after dev is green) → prod (GitHub environment with required reviewers).
- Prod settings: `db_multi_az = true`, `deletion_protection = true`, `force_destroy_bucket = false`, larger instance class.

### Phase 5: Faster, safer releases

- **Path filters** so frontend-only changes skip Terraform, and backend-only changes update just the affected Lambda.
- **Lambda versions + aliases with CodeDeploy canary** (for example 10% for 5 minutes) and automatic rollback on CloudWatch alarms.
- **Database migrations as a pipeline step** (node-pg-migrate or Flyway) run before the new code ships, replacing the scaffold's `CREATE TABLE IF NOT EXISTS` on cold start.
- **Preview environments per PR** for the frontend (a separate prefix or distribution) if the team wants visual review.

### Phase 6: Operability

- CloudWatch alarms on Lambda errors/throttles, API 5xx, RDS CPU and free storage; notifications to Slack or email via SNS.
- API Gateway access logs and AWS X-Ray tracing.
- Drift detection: a scheduled `terraform plan` that alerts when it is not empty.
- Dependabot or Renovate for npm packages, the Terraform provider and GitHub Actions versions.

## Production checklist

- Authentication: Cognito user pool authorizer on API methods; tie attachments to the owner.
- AWS WAF on the CloudFront distribution (managed rule groups + rate limiting).
- Block direct API Gateway access (a secret origin header checked by a resource policy or the Lambda).
- Custom domain: ACM certificate in `us-east-1`, `aliases`, Route 53 alias record. Add the domain to the attachments CORS origins.
- Orphaned files: deleting an item cascades its attachment rows, but files under `files/<item>/` remain. Add an async cleanup (EventBridge or SQS message from the items service to the attachments service).
- Image processing: generate thumbnails and strip EXIF metadata (GPS) in the validator, for example with `sharp` in a Lambda layer.
- Malware scanning if uploads are shared between users (GuardDuty Malware Protection for S3).

## Cost (dev defaults, rough)

RDS db.t4g.micro about $15/month, RDS Proxy about $22/month (billed on the DB's vCPUs, 2 minimum), Secrets Manager $0.40/month. Lambda, API Gateway, CloudFront, S3 and the S3 gateway endpoint cost close to nothing at low traffic. Run `./scripts/destroy.sh` when you're not using the stack.
