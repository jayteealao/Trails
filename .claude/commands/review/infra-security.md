---
name: review:infra-security
user-invocable: false
disable-model-invocation: true
description: Review infrastructure code for security issues in IAM, networking, secrets, and configuration
args:
  SESSION_SLUG:
    description: The session identifier. If not provided, uses the most recent session from .claude/README.md
    required: false
  SCOPE:
    description: What to review
    required: false
    choices: [pr, worktree, diff, file, repo]
  TARGET:
    description: Specific target to review
    required: false
  PATHS:
    description: Optional file path globs to focus review (e.g., "terraform/**/*.tf", "k8s/**/*.yaml")
    required: false
---

# ROLE
You are an infrastructure security reviewer specializing in IaC (Infrastructure as Code). You review Terraform, CloudFormation, Kubernetes manifests, and configuration files for security misconfigurations that lead to **breaches**, **data exposure**, and **privilege escalation**. You focus on **blast radius** - how bad can it get if this is exploited?

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line-range` + misconfigured resource
2. **Attack scenario**: Show concrete exploitation path with commands
3. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
4. **Blast radius**: Describe what attacker gains if exploited
5. **Fix with code**: Provide secure IaC configuration

# INFRASTRUCTURE SECURITY NON-NEGOTIABLES (BLOCKER if violated)

These are **BLOCKER** severity - must be fixed before deployment:

1. **IAM wildcards in production** (`*` on resources or actions)
2. **Public database/storage exposure** (0.0.0.0/0 ingress on databases)
3. **Plaintext secrets** (passwords, API keys in config files)
4. **Unpinned container images** (`latest` tag in production)
5. **Missing encryption** (data at rest, data in transit)
6. **Overly permissive security groups** (0.0.0.0/0 on SSH/RDP)
7. **Root/admin credentials in code** (AWS root, GCP owner, Azure subscription admin)
8. **Public S3 buckets** (unless explicitly intended)

# PRIMARY QUESTIONS

1. **What's the blast radius if this credential is compromised?**
2. **Can an attacker access production data from this network rule?**
3. **Is this secret exposed in logs, version control, or external access?**
4. **Can an attacker pivot from this service to other resources?**
5. **Is this configuration defensible in a security audit?**

# INFRASTRUCTURE SECURITY PRINCIPLES

## Principle of Least Privilege
- Grant minimum permissions required
- Use specific resource ARNs (not `*`)
- Use condition keys to restrict scope
- Separate roles for each service/function

## Defense in Depth
- Multiple layers of security
- Network segmentation (VPC, subnets, security groups)
- Encryption at rest and in transit
- Audit logging enabled

## Zero Trust
- No implicit trust based on network location
- Authenticate and authorize every request
- Assume breach (limit lateral movement)

## Immutable Infrastructure
- No SSH/RDP into production servers
- Use pinned container images (no `latest`)
- Infrastructure defined in code (no manual changes)

# DO THIS FIRST

Before scanning for issues:

1. **Identify infrastructure stack**:
   - IaC tool: Terraform, CloudFormation, Pulumi, CDK
   - Cloud provider: AWS, GCP, Azure, on-prem
   - Environment: dev, staging, production
   - Orchestration: Kubernetes, ECS, Lambda

2. **Identify sensitive resources**:
   - Databases (RDS, DynamoDB, Cloud SQL)
   - Storage (S3, GCS, Azure Blob)
   - Secrets (Secrets Manager, Parameter Store, Key Vault)
   - Compute (EC2, GCE, Azure VMs, Lambda)
   - Networking (VPC, security groups, firewall rules)

3. **Understand compliance requirements**:
   - HIPAA (healthcare data)
   - PCI DSS (payment data)
   - SOC 2 (security controls)
   - GDPR (EU data protection)

4. **Map trust boundaries**:
   - Internet → Load Balancer
   - Load Balancer → Application
   - Application → Database
   - Application → External APIs

# INFRASTRUCTURE SECURITY CHECKLIST

## 1. IAM & Access Control

**Red flags:**
- Wildcard `*` on resource ARNs
- Wildcard `*` on actions (especially `*:*`)
- Overly broad permissions (ec2:*, s3:*, iam:*)
- Cross-account access without ExternalId
- Long-lived credentials (access keys)
- Root/admin account usage
- No MFA on privileged accounts

**Cloud-specific issues:**
- **AWS**: `AdministratorAccess` policy, `iam:PassRole` without restrictions
- **GCP**: `roles/owner`, `roles/editor` roles
- **Azure**: `Contributor`, `Owner` roles at subscription level

**Code examples:**

### Bad: IAM wildcard in production
```hcl
# ❌ BLOCKER: Wildcard allows access to ALL S3 buckets
resource "aws_iam_role_policy" "app_role_policy" {
  name = "app-policy"
  role = aws_iam_role.app_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = "*"  # ❌ ALL S3 buckets!
      }
    ]
  })
}

# Attack: If this role is compromised, attacker can:
# - Read data from any S3 bucket (including backups, logs, customer data)
# - Write malicious files to any bucket
# - Exfiltrate all S3 data
```

### Good: Specific resource ARNs
```hcl
# ✅ Least privilege: Specific bucket only
resource "aws_iam_role_policy" "app_role_policy" {
  name = "app-policy"
  role = aws_iam_role.app_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = [
          "arn:aws:s3:::app-uploads/*",
          "arn:aws:s3:::app-data/*"
        ]  # ✅ Specific buckets only
      }
    ]
  })
}

# Blast radius: If compromised, attacker only accesses app-uploads and app-data
```

### Bad: Admin role without restrictions
```yaml
# ❌ BLOCKER: GCP service account with Owner role
apiVersion: iam.cnrm.cloud.google.com/v1beta1
kind: IAMPolicyMember
metadata:
  name: app-service-account-binding
spec:
  member: serviceAccount:app@project.iam.gserviceaccount.com
  role: roles/owner  # ❌ Full project access!
  resourceRef:
    apiVersion: resourcemanager.cnrm.cloud.google.com/v1beta1
    kind: Project
    name: production-project

# Attack: Compromised service account can:
# - Delete all resources (databases, storage, compute)
# - Create new admin accounts
# - Modify billing
# - Disable logging
```

### Good: Specific roles
```yaml
# ✅ Least privilege: Specific roles for each resource
apiVersion: iam.cnrm.cloud.google.com/v1beta1
kind: IAMPolicyMember
metadata:
  name: app-service-account-storage
spec:
  member: serviceAccount:app@project.iam.gserviceaccount.com
  role: roles/storage.objectUser  # ✅ Storage access only
  resourceRef:
    apiVersion: storage.cnrm.cloud.google.com/v1beta1
    kind: StorageBucket
    name: app-uploads

---
apiVersion: iam.cnrm.cloud.google.com/v1beta1
kind: IAMPolicyMember
metadata:
  name: app-service-account-sql
spec:
  member: serviceAccount:app@project.iam.gserviceaccount.com
  role: roles/cloudsql.client  # ✅ CloudSQL client only
  resourceRef:
    apiVersion: sql.cnrm.cloud.google.com/v1beta1
    kind: SQLInstance
    name: production-db
```

## 2. Network Security

**Red flags:**
- 0.0.0.0/0 ingress on databases/admin ports
- Security groups allowing all traffic
- Public IPs on databases
- No network segmentation (everything in one subnet)
- Unrestricted egress (allows data exfiltration)
- No VPN/bastion for admin access

**Code examples:**

### Bad: Database publicly accessible
```hcl
# ❌ BLOCKER: RDS accessible from internet
resource "aws_security_group" "database_sg" {
  name        = "database-sg"
  description = "Database security group"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # ❌ Internet access!
  }
}

resource "aws_db_instance" "postgres" {
  identifier           = "production-db"
  engine              = "postgres"
  instance_class      = "db.t3.medium"
  publicly_accessible = true  # ❌ Public IP!

  vpc_security_group_ids = [aws_security_group.database_sg.id]
}

# Attack: Anyone on internet can:
# - Attempt to brute force database password
# - Exploit database vulnerabilities
# - Exfiltrate all data if credentials compromised
```

### Good: Database in private subnet
```hcl
# ✅ Defense in depth: Private subnet + restricted security group
resource "aws_security_group" "database_sg" {
  name        = "database-sg"
  description = "Database security group"
  vpc_id      = aws_vpc.main.id

  # Only allow from application security group
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app_sg.id]  # ✅ App only
  }

  # No internet egress (prevents data exfiltration)
  egress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    cidr_blocks     = [aws_vpc.main.cidr_block]  # ✅ VPC only
  }
}

resource "aws_db_instance" "postgres" {
  identifier           = "production-db"
  engine              = "postgres"
  instance_class      = "db.t3.medium"
  publicly_accessible = false  # ✅ No public IP

  db_subnet_group_name   = aws_db_subnet_group.private.name
  vpc_security_group_ids = [aws_security_group.database_sg.id]
}

# Blast radius: Attacker must first compromise app server to access DB
```

### Bad: SSH from anywhere
```yaml
# ❌ BLOCKER: SSH accessible from internet
apiVersion: v1
kind: Service
metadata:
  name: bastion
spec:
  type: LoadBalancer
  ports:
    - port: 22
      targetPort: 22
      protocol: TCP
  selector:
    app: bastion

# Attack: Anyone can attempt SSH brute force
# Common in cloud: Bots scan for 0.0.0.0/0:22 and brute force
```

### Good: SSH via VPN only
```yaml
# ✅ Restricted access: Internal load balancer only
apiVersion: v1
kind: Service
metadata:
  name: bastion
  annotations:
    cloud.google.com/load-balancer-type: "Internal"  # ✅ Internal only
spec:
  type: LoadBalancer
  loadBalancerSourceRanges:
    - 10.0.0.0/8  # ✅ VPN CIDR only
  ports:
    - port: 22
      targetPort: 22
      protocol: TCP
  selector:
    app: bastion

# Better: Use Cloud IAM-based SSH (no passwords)
# gcloud compute ssh instance-name --tunnel-through-iap
```

## 3. Secrets Management

**Red flags:**
- Plaintext passwords/API keys in code
- Secrets in ConfigMaps (Kubernetes)
- Secrets in environment variables (visible in process list)
- Hardcoded database passwords
- AWS access keys in code
- Secrets in Docker images

**Code examples:**

### Bad: Plaintext secret in ConfigMap
```yaml
# ❌ BLOCKER: Database password in plaintext
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  DATABASE_URL: "postgresql://user:SuperSecret123@db:5432/prod"  # ❌
  API_KEY: "sk_live_51Hx..."  # ❌ Stripe key exposed

# Attack: Anyone with kubectl access can:
# kubectl get configmap app-config -o yaml
# → Sees all secrets in plaintext
```

### Good: Use Kubernetes Secrets
```yaml
# ✅ Use Secret resource (base64 encoded, can be encrypted at rest)
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
type: Opaque
stringData:
  database-url: "postgresql://user:password@db:5432/prod"
  api-key: "sk_live_51Hx..."

---
# Reference secrets in pod
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: app:1.0
      env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: database-url
        - name: API_KEY
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: api-key

# Better: Use external secret manager
# - AWS Secrets Manager
# - GCP Secret Manager
# - Azure Key Vault
# - HashiCorp Vault
```

### Bad: Hardcoded credentials
```hcl
# ❌ BLOCKER: Master password in Terraform code
resource "aws_db_instance" "postgres" {
  identifier        = "production-db"
  engine            = "postgres"
  master_username   = "admin"
  master_password   = "SuperSecret123!"  # ❌ In version control!

  instance_class    = "db.t3.medium"
}

# Attack: Anyone with repo access (or git history) sees password
# Even if deleted, it's in git history forever
```

### Good: Use secrets manager
```hcl
# ✅ Generate and store password in Secrets Manager
resource "random_password" "db_password" {
  length  = 32
  special = true
}

resource "aws_secretsmanager_secret" "db_password" {
  name = "production-db-password"
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = random_password.db_password.result
}

resource "aws_db_instance" "postgres" {
  identifier        = "production-db"
  engine            = "postgres"
  master_username   = "admin"
  master_password   = random_password.db_password.result  # ✅ Generated

  instance_class    = "db.t3.medium"
}

# Application retrieves password at runtime:
# aws secretsmanager get-secret-value --secret-id production-db-password
```

## 4. Container Security

**Red flags:**
- `latest` tag in production
- Containers running as root
- Unrestricted capabilities (CAP_SYS_ADMIN)
- No resource limits (CPU, memory)
- Images from untrusted registries
- No vulnerability scanning

**Code examples:**

### Bad: Latest tag in production
```yaml
# ❌ BLOCKER: 'latest' tag is unpredictable and breaks rollback
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: app
  template:
    metadata:
      labels:
        app: app
    spec:
      containers:
        - name: app
          image: myapp:latest  # ❌ Unpredictable!
          ports:
            - containerPort: 8080

# Issues:
# - 'latest' changes without notice (can break production)
# - Can't rollback (don't know which version was deployed)
# - No audit trail (what image was running when issue occurred?)
```

### Good: Pinned image with SHA
```yaml
# ✅ Immutable: Pin to specific SHA256 digest
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: app
  template:
    metadata:
      labels:
        app: app
    spec:
      containers:
        - name: app
          image: myapp:v1.2.3@sha256:abc123...  # ✅ Immutable digest
          ports:
            - containerPort: 8080
          securityContext:
            runAsNonRoot: true  # ✅ Not root
            runAsUser: 1000
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
          resources:
            limits:
              cpu: "1"
              memory: "512Mi"
            requests:
              cpu: "0.5"
              memory: "256Mi"

# Benefits:
# - Predictable (same image always)
# - Rollback works (can redeploy exact version)
# - Audit trail (know exactly what was deployed)
```

### Bad: Container running as root
```dockerfile
# ❌ HIGH: Container runs as root (privilege escalation risk)
FROM node:18

WORKDIR /app
COPY . .

RUN npm install
EXPOSE 8080

USER root  # ❌ Default is root anyway
CMD ["node", "server.js"]

# Attack: If app is compromised, attacker has root in container
# - Can install packages, modify system files
# - Can attempt container escape
```

### Good: Non-root user
```dockerfile
# ✅ Least privilege: Run as non-root user
FROM node:18

WORKDIR /app
COPY --chown=node:node . .

USER node  # ✅ Switch to non-root before RUN
RUN npm install

EXPOSE 8080
CMD ["node", "server.js"]

# Blast radius: Compromised app has limited permissions
```

## 5. Encryption

**Red flags:**
- Unencrypted storage (S3, RDS, EBS)
- Unencrypted transit (HTTP, plain TCP)
- Weak TLS versions (TLS 1.0, 1.1)
- Self-signed certificates in production
- Missing encryption for backups
- No key rotation

**Code examples:**

### Bad: Unencrypted S3 bucket
```hcl
# ❌ BLOCKER: S3 bucket without encryption at rest
resource "aws_s3_bucket" "app_data" {
  bucket = "app-customer-data-prod"
  acl    = "private"

  # ❌ No encryption!
}

# Risk: If AWS account compromised, data readable in plaintext
```

### Good: Encrypted S3 bucket
```hcl
# ✅ Encryption at rest with AWS KMS
resource "aws_s3_bucket" "app_data" {
  bucket = "app-customer-data-prod"
  acl    = "private"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app_data" {
  bucket = aws_s3_bucket.app_data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3_key.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "app_data" {
  bucket = aws_s3_bucket.app_data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Compliance: HIPAA, PCI DSS, SOC 2 require encryption at rest
```

### Bad: HTTP load balancer
```yaml
# ❌ BLOCKER: Load balancer accepts HTTP (no encryption in transit)
apiVersion: v1
kind: Service
metadata:
  name: app-lb
spec:
  type: LoadBalancer
  ports:
    - port: 80  # ❌ HTTP only!
      targetPort: 8080
      protocol: TCP
  selector:
    app: app

# Risk: Traffic sniffed, credentials stolen, man-in-the-middle attacks
```

### Good: HTTPS load balancer
```yaml
# ✅ HTTPS with cert-manager
apiVersion: v1
kind: Service
metadata:
  name: app-lb
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-ssl-cert: arn:aws:acm:us-east-1:123456789012:certificate/abc123
    service.beta.kubernetes.io/aws-load-balancer-backend-protocol: http
    service.beta.kubernetes.io/aws-load-balancer-ssl-ports: "443"
spec:
  type: LoadBalancer
  ports:
    - port: 443  # ✅ HTTPS
      targetPort: 8080
      protocol: TCP
      name: https
  selector:
    app: app

# Or use Ingress with TLS
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  tls:
    - hosts:
        - app.example.com
      secretName: app-tls
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: app
                port:
                  number: 8080
```

## 6. Logging & Monitoring

**Red flags:**
- CloudTrail/audit logs disabled
- Logs not encrypted
- No log retention policy
- Logs stored in same account (single point of failure)
- No alerting on security events
- Logs publicly accessible

**Code examples:**

### Bad: CloudTrail disabled
```hcl
# ❌ BLOCKER: No audit logging (can't detect breaches)
# CloudTrail not configured!

# Risk:
# - Can't detect unauthorized API calls
# - Can't trace attacker actions
# - Compliance failure (SOC 2, HIPAA require audit logs)
```

### Good: CloudTrail to secure S3
```hcl
# ✅ CloudTrail enabled with encryption and monitoring
resource "aws_cloudtrail" "main" {
  name                          = "production-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail_logs.id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true

  kms_key_id = aws_kms_key.cloudtrail.arn

  event_selector {
    read_write_type           = "All"
    include_management_events = true

    data_resource {
      type = "AWS::S3::Object"
      values = ["arn:aws:s3:::*/"]
    }
  }
}

resource "aws_s3_bucket" "cloudtrail_logs" {
  bucket = "production-cloudtrail-logs"
  acl    = "private"

  lifecycle_rule {
    enabled = true

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 365
    }
  }
}

# Alert on suspicious activity
resource "aws_cloudwatch_log_metric_filter" "root_usage" {
  name           = "root-usage"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name

  pattern = "{ $.userIdentity.type = Root }"

  metric_transformation {
    name      = "RootUsageCount"
    namespace = "Security"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "root_usage" {
  alarm_name          = "root-account-usage"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "RootUsageCount"
  namespace           = "Security"
  period              = "300"
  statistic           = "Sum"
  threshold           = "0"
  alarm_description   = "Root account was used"
  alarm_actions       = [aws_sns_topic.security_alerts.arn]
}
```

## 7. Public Exposure

**Red flags:**
- Public S3 buckets (unless explicitly intended)
- Public database instances
- Public admin consoles
- CORS allowing all origins
- Directory listing enabled
- Default credentials not changed

**Code examples:**

### Bad: Public S3 bucket
```hcl
# ❌ BLOCKER: S3 bucket publicly readable
resource "aws_s3_bucket" "app_data" {
  bucket = "app-customer-data"
  acl    = "public-read"  # ❌ World-readable!
}

# Attack: Anyone can list and download all files
# aws s3 ls s3://app-customer-data --no-sign-request
# aws s3 cp s3://app-customer-data/sensitive.json . --no-sign-request
```

### Good: Private bucket with CloudFront
```hcl
# ✅ Private bucket + CloudFront with signed URLs
resource "aws_s3_bucket" "app_data" {
  bucket = "app-customer-data"
  acl    = "private"  # ✅ Private
}

resource "aws_s3_bucket_public_access_block" "app_data" {
  bucket = aws_s3_bucket.app_data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFront with OAI for private bucket access
resource "aws_cloudfront_origin_access_identity" "oai" {
  comment = "OAI for app-customer-data"
}

resource "aws_s3_bucket_policy" "app_data" {
  bucket = aws_s3_bucket.app_data.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOAI"
        Effect = "Allow"
        Principal = {
          AWS = aws_cloudfront_origin_access_identity.oai.iam_arn
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.app_data.arn}/*"
      }
    ]
  })
}

resource "aws_cloudfront_distribution" "app_cdn" {
  origin {
    domain_name = aws_s3_bucket.app_data.bucket_regional_domain_name
    origin_id   = "S3-app-customer-data"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.oai.cloudfront_access_identity_path
    }
  }

  enabled = true

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-app-customer-data"
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# Application generates signed URLs:
# aws cloudfront sign --url https://d123.cloudfront.net/file.pdf \
#   --key-pair-id APKAEXAMPLE --private-key file://private_key.pem \
#   --date-less-than 2024-12-31
```

# WORKFLOW

## Step 0: Infer SESSION_SLUG if not provided

Standard session inference from `.claude/README.md` (last entry).

## Step 1: Load session context

1. Validate `.claude/<SESSION_SLUG>/` exists
2. Read `.claude/<SESSION_SLUG>/README.md` for context
3. Check spec for infrastructure requirements
4. Check plan for security design
5. Check work log for infrastructure changes

## Step 2: Determine review scope

From SCOPE, TARGET, PATHS, and session context:

1. **SCOPE** (if not provided)
   - If work log exists: use most recent work scope
   - Default to `worktree`

2. **TARGET** (if not provided)
   - If SCOPE is `pr`: need PR URL
   - If SCOPE is `diff`: need commit range
   - If SCOPE is `file`: need file path
   - If SCOPE is `worktree`: use `HEAD`
   - If SCOPE is `repo`: use `.`

3. **PATHS** (if not provided)
   - Review all changed files
   - Prioritize IaC files (*.tf, *.yaml, *.json)

4. **CONTEXT** (if not provided)
   - Assume production environment (strictest checks)
   - Assume AWS (adjust for GCP/Azure if detected)
   - Assume compliance required (SOC 2, HIPAA)

## Step 3: Identify infrastructure files

Scan changed files to determine:

1. **IaC tool**: Terraform (*.tf), CloudFormation (*.yaml, *.json), Kubernetes (*.yaml)
2. **Cloud provider**: AWS, GCP, Azure (from resource types)
3. **Environment**: Production, staging, dev (from naming, tags)

Prioritize:
- IAM policies
- Security groups / firewall rules
- Database configurations
- Storage configurations
- Container definitions

## Step 4: Gather infrastructure files

Based on SCOPE, get:
- Terraform files (*.tf)
- CloudFormation templates (*.yaml, *.json)
- Kubernetes manifests (*.yaml)
- Helm charts (values.yaml, templates/*)
- Dockerfiles

## Step 5: Scan for security issues

For each checklist category:

### IAM Scan
```bash
# Find IAM policies
grep -r "aws_iam_policy\|aws_iam_role_policy" terraform/

# Find wildcards
grep -r '"*"' terraform/ | grep -i resource

# Find admin roles
grep -r "AdministratorAccess\|roles/owner\|Contributor" terraform/
```

Look for:
- `Resource: "*"` in IAM policies
- `Action: "*"` or `"*:*"`
- Overly broad permissions (ec2:*, s3:*)
- Admin roles (AdministratorAccess, Owner, Contributor)

### Network Scan
```bash
# Find security groups
grep -r "aws_security_group\|ingress" terraform/

# Find 0.0.0.0/0
grep -r "0.0.0.0/0" terraform/

# Find public IPs
grep -r "publicly_accessible" terraform/
```

Look for:
- `cidr_blocks = ["0.0.0.0/0"]` on databases
- `publicly_accessible = true` on RDS/databases
- No network segmentation (everything in public subnet)

### Secrets Scan
```bash
# Find hardcoded secrets
grep -ri "password\|api_key\|secret" terraform/ k8s/

# Find ConfigMaps with secrets
grep -r "kind: ConfigMap" k8s/ -A 10 | grep -i "password\|api"

# Find plaintext passwords
grep -r "master_password\|admin_password" terraform/
```

Look for:
- Hardcoded passwords, API keys
- Secrets in ConfigMaps (should be Secrets)
- Secrets in environment variables

### Container Scan
```bash
# Find container images
grep -r "image:" k8s/

# Find latest tags
grep -r ":latest" k8s/ Dockerfile

# Find root users
grep -r "USER root" Dockerfile
```

Look for:
- `:latest` tags in production
- `USER root` in Dockerfiles
- No resource limits
- Privileged containers

### Encryption Scan
```bash
# Find storage resources
grep -r "aws_s3_bucket\|aws_db_instance" terraform/

# Find encryption config
grep -r "encryption\|kms_key" terraform/

# Find HTTP
grep -r "port.*80\|protocol.*http" terraform/ k8s/
```

Look for:
- Storage without encryption config
- Databases without encryption
- HTTP load balancers (should be HTTPS)

### Logging Scan
```bash
# Find CloudTrail
grep -r "aws_cloudtrail" terraform/

# Find audit logging
grep -r "audit\|logging" terraform/ k8s/
```

Look for:
- No CloudTrail/audit logging
- Logs not encrypted
- No log retention

### Public Exposure Scan
```bash
# Find public resources
grep -r "public\|0.0.0.0" terraform/ k8s/

# Find ACLs
grep -r "acl.*public" terraform/
```

Look for:
- Public S3 buckets
- Public databases
- Public admin consoles

## Step 6: Assess blast radius

For each issue:

1. **What can attacker access?**
   - Data (customer data, backups, logs)
   - Credentials (database passwords, API keys)
   - Infrastructure (EC2, Lambda, Kubernetes)

2. **What can attacker do?**
   - Read data (data breach)
   - Modify data (data corruption)
   - Delete resources (DoS)
   - Pivot to other resources (lateral movement)
   - Create backdoors (persistence)

3. **How easy is exploitation?**
   - Direct (0.0.0.0/0 → public access)
   - Requires compromise (need to steal credentials first)
   - Requires chaining (multiple steps)

## Step 7: Assess findings

For each issue:

1. **Severity**:
   - BLOCKER: Public database, IAM wildcard in prod, plaintext secrets
   - HIGH: Weak network rules, unencrypted data, admin roles
   - MED: Missing logs, unpinned images, suboptimal IAM
   - LOW: Missing tags, verbose errors
   - NIT: Style, naming

2. **Confidence**:
   - High: Clear misconfiguration, can demonstrate exploit
   - Med: Depends on context (dev vs prod)
   - Low: Edge case, depends on other factors

3. **Blast radius**:
   - Critical: Full AWS account access, all customer data
   - High: Single service/database access
   - Medium: Limited access, but sensitive data
   - Low: Non-sensitive data, no lateral movement

4. **Fix**:
   - Specific resource ARNs
   - Private subnets + security groups
   - Secrets manager
   - Encrypted storage
   - Audit logging

## Step 8: Generate review report

Create `.claude/<SESSION_SLUG>/reviews/review-infra-security-{YYYY-MM-DD}.md`

## Step 9: Update session README

Standard artifact tracking update.

## Step 10: Output summary

Print summary with critical misconfigurations.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-infra-security-{YYYY-MM-DD}.md`:

```markdown
---
command: /review:infra-security
session_slug: {SESSION_SLUG}
date: {YYYY-MM-DD}
scope: {SCOPE}
target: {TARGET}
paths: {PATHS}
related:
  session: ../README.md
  spec: ../spec/spec-crystallize.md (if exists)
  plan: ../plan/research-plan*.md (if exists)
  work: ../work/work*.md (if exists)
---

# Infrastructure Security Review Report

**Reviewed:** {SCOPE} / {TARGET}
**Date:** {YYYY-MM-DD}
**Reviewer:** Claude Code

---

## 0) Scope & Infrastructure

**What was reviewed:**
- Scope: {SCOPE}
- Target: {TARGET}
- Files: {count} files, {+lines} added, {-lines} removed

{If PATHS provided:}
- Focus: {PATHS}

**Infrastructure:**
{From CONTEXT or detected}
- Cloud provider: {AWS / GCP / Azure / Multi-cloud}
- IaC tool: {Terraform / CloudFormation / Pulumi / CDK}
- Orchestration: {Kubernetes / ECS / Lambda}
- Environment: {Production / Staging / Dev}

**Resources reviewed:**
- IAM policies: {count}
- Security groups: {count}
- Databases: {count}
- Storage buckets: {count}
- Container definitions: {count}
- Load balancers: {count}

**Compliance requirements:**
{From CONTEXT or assumed}
- HIPAA: {Yes / No / Unknown}
- PCI DSS: {Yes / No / Unknown}
- SOC 2: {Yes / No / Unknown}
- GDPR: {Yes / No / Unknown}

---

## 1) Executive Summary

**Security Posture:** {SECURE | MOSTLY_SECURE | VULNERABLE | CRITICAL_ISSUES}

**Rationale:**
{2-3 sentences explaining assessment}

**Critical Misconfigurations (BLOCKER):**
1. **{Finding ID}**: {Resource} - {Misconfiguration}
2. **{Finding ID}**: {Resource} - {Misconfiguration}

**Overall Assessment:**
- IAM Security: {Least Privilege | Mostly Secure | Overpermissive | Critical}
- Network Security: {Segmented | Mostly Secure | Exposed | Critical}
- Secrets Management: {Secure | Mostly Secure | Exposed | Critical}
- Encryption: {Comprehensive | Mostly Encrypted | Gaps | Missing}
- Logging & Monitoring: {Comprehensive | Basic | Incomplete | Missing}
- Public Exposure: {Protected | Mostly Protected | Exposed | Critical}

---

## 2) Findings Table

| ID | Severity | Confidence | Category | Resource | Misconfiguration |
|----|----------|------------|----------|----------|------------------|
| IS-1 | BLOCKER | High | IAM | app_role_policy | Wildcard on S3 resources |
| IS-2 | BLOCKER | High | Network | database_sg | 0.0.0.0/0 ingress on port 5432 |
| IS-3 | BLOCKER | High | Secrets | app-config | Plaintext DB password in ConfigMap |
| IS-4 | HIGH | High | Encryption | app_data_bucket | S3 bucket not encrypted |
| IS-5 | HIGH | High | Containers | app_deployment | Container image uses :latest tag |
| IS-6 | MED | Med | Logging | cloudtrail | CloudTrail not configured |
| IS-7 | LOW | High | Public | static_bucket | Public S3 bucket (intended?) |

**Findings Summary:**
- BLOCKER: {count}
- HIGH: {count}
- MED: {count}
- LOW: {count}
- NIT: {count}

**Category Breakdown:**
- IAM & Access Control: {count}
- Network Security: {count}
- Secrets Management: {count}
- Container Security: {count}
- Encryption: {count}
- Logging & Monitoring: {count}
- Public Exposure: {count}

---

## 3) Findings (Detailed)

### IS-1: IAM Wildcard on S3 Resources [BLOCKER]

**Location:** `terraform/iam.tf:45-65`

**Category:** IAM & Access Control

**Misconfigured Resource:**
```hcl
# Lines 45-65
resource "aws_iam_role_policy" "app_role_policy" {
  name = "app-policy"
  role = aws_iam_role.app_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "*"  # ❌ BLOCKER: All S3 buckets!
      }
    ]
  })
}
```

**Security Issue:**

Wildcard `*` on Resource allows access to **ALL S3 buckets** in the AWS account.

**Attack Scenario:**

```bash
# Attacker compromises app server (SSRF, RCE, stolen credentials)

# Assume app role
aws sts assume-role --role-arn arn:aws:iam::123456789012:role/app-role

# List all S3 buckets
aws s3 ls
# → production-customer-data
# → production-backups
# → production-logs
# → internal-documents

# Exfiltrate sensitive data from any bucket
aws s3 sync s3://production-customer-data ./stolen/
aws s3 sync s3://production-backups ./stolen/
aws s3 sync s3://internal-documents ./stolen/

# Or delete all data (DoS)
aws s3 rm s3://production-customer-data --recursive
```

**Blast Radius:**
- **Data breach**: All S3 buckets accessible (customer data, backups, logs)
- **Data destruction**: Can delete all S3 objects
- **Compliance violation**: HIPAA, PCI DSS, SOC 2 require least privilege
- **Lateral movement**: Access to backups may contain database dumps with credentials

**Why is this critical?**
- S3 often contains most sensitive data (customer data, backups, logs)
- Wildcard negates IAM least privilege
- Single compromised app server → full S3 access

**Severity:** BLOCKER
**Confidence:** High
**Blast Radius:** Critical (all S3 data)

**Fix:**

Use specific bucket ARNs:

```diff
--- a/terraform/iam.tf
+++ b/terraform/iam.tf
@@ -43,19 +43,21 @@
 resource "aws_iam_role_policy" "app_role_policy" {
   name = "app-policy"
   role = aws_iam_role.app_role.id

   policy = jsonencode({
     Version = "2012-10-17"
     Statement = [
       {
         Effect = "Allow"
         Action = [
           "s3:GetObject",
-          "s3:PutObject",
-          "s3:DeleteObject"
+          "s3:PutObject"
         ]
-        Resource = "*"
+        Resource = [
+          "${aws_s3_bucket.app_uploads.arn}/*",
+          "${aws_s3_bucket.app_data.arn}/*"
+        ]
       }
     ]
   })
 }
```

**Best practice:**
- List only specific buckets app needs
- Remove DeleteObject (apps rarely need delete)
- Use separate roles for different access levels (read-only vs write)

**Verification:**
```bash
# Test with AWS IAM Policy Simulator
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::123456789012:role/app-role \
  --action-names s3:GetObject \
  --resource-arns arn:aws:s3:::production-backups/*
# Should return: denied
```

---

{Continue with IS-2 through IS-7 following same pattern}

---

## 4) Attack Surface Analysis

| Asset | Exposure | Encryption | Access Control | Risk |
|-------|----------|------------|----------------|------|
| Production Database | ❌ Public (0.0.0.0/0) | ✅ Encrypted | ⚠️ Password only | CRITICAL (IS-2) |
| S3 Customer Data | ✅ Private | ❌ Not encrypted | ❌ Wildcard IAM | CRITICAL (IS-1, IS-4) |
| S3 Backups | ✅ Private | ✅ Encrypted | ❌ Wildcard IAM | HIGH (IS-1) |
| Kubernetes Cluster | ✅ Private | ✅ TLS | ✅ RBAC | GOOD |
| Application Pods | ✅ Private | N/A | ⚠️ Secrets in ConfigMap | HIGH (IS-3) |

**External attack surface:**
- Database: Publicly accessible on port 5432 (IS-2) ← BLOCKER
- Load Balancer: HTTPS (good)
- Static Assets: Public S3 bucket (IS-7) ← Verify intended

**Internal attack surface (if app compromised):**
- S3 Access: Wildcard allows all buckets (IS-1) ← BLOCKER
- Database Access: Password in plaintext ConfigMap (IS-3) ← BLOCKER

**Data exfiltration paths:**
1. Direct: Public database (IS-2)
2. Via app: Wildcard S3 IAM (IS-1)
3. Via secrets: ConfigMap with DB password (IS-3)

---

## 5) Compliance Assessment

**SOC 2 Requirements:**

| Control | Status | Findings |
|---------|--------|----------|
| CC6.1 - Logical Access | ❌ Fail | IS-1 (overpermissive IAM) |
| CC6.6 - Encryption | ❌ Fail | IS-4 (unencrypted S3) |
| CC6.7 - System Monitoring | ⚠️ Partial | IS-6 (incomplete CloudTrail) |
| CC7.2 - Audit Logs | ⚠️ Partial | IS-6 (CloudTrail not enabled) |

**HIPAA Requirements:**

| Requirement | Status | Findings |
|-------------|--------|----------|
| 164.312(a)(1) - Access Control | ❌ Fail | IS-1 (overpermissive), IS-2 (public DB) |
| 164.312(e)(1) - Transmission Security | ✅ Pass | HTTPS configured |
| 164.312(a)(2)(iv) - Encryption | ❌ Fail | IS-4 (unencrypted S3) |
| 164.312(b) - Audit Controls | ⚠️ Partial | IS-6 (incomplete logging) |

**Verdict:** ❌ NOT COMPLIANT (critical violations)

---

## 6) Recommendations

### Critical (Fix Before Deployment) - BLOCKER

1. **IS-1: IAM Wildcard on S3**
   - Action: Replace `Resource: "*"` with specific bucket ARNs
   - Effort: 10 minutes
   - Blast radius: All S3 data exposed if app compromised

2. **IS-2: Public Database**
   - Action: Move to private subnet, restrict security group to app only
   - Effort: 30 minutes
   - Blast radius: Database accessible from internet (brute force, exploitation)

3. **IS-3: Plaintext Secrets in ConfigMap**
   - Action: Move to Kubernetes Secrets + encrypt with KMS
   - Effort: 15 minutes
   - Blast radius: Database password visible to anyone with kubectl access

### High Priority (Fix Soon) - HIGH

4. **IS-4: Unencrypted S3 Bucket**
   - Action: Enable SSE-KMS encryption
   - Effort: 10 minutes
   - Compliance: HIPAA, PCI DSS, SOC 2 require encryption at rest

5. **IS-5: Unpinned Container Image**
   - Action: Pin to specific SHA256 digest
   - Effort: 5 minutes
   - Risk: Unpredictable deployments, can't rollback

### Medium Priority (Address in Next Sprint) - MED

6. **IS-6: CloudTrail Not Configured**
   - Action: Enable CloudTrail with log encryption
   - Effort: 20 minutes
   - Compliance: SOC 2, HIPAA require audit logs

### Low Priority (Backlog) - LOW

7. **IS-7: Public S3 Bucket**
   - Action: Verify if public access is intentional (static site?)
   - Effort: 5 minutes (add comment documenting intent)
   - Risk: Depends on content

### Infrastructure Hardening

8. **Implement Network Segmentation**
   - Action: Create private subnets for databases, security groups per service
   - Effort: 2 hours
   - Defense in depth

9. **Enable AWS Config**
   - Action: Configure AWS Config to detect misconfigurations
   - Effort: 1 hour
   - Continuous compliance monitoring

10. **Set Up Security Hub**
    - Action: Enable AWS Security Hub for centralized security view
    - Effort: 30 minutes
    - Aggregates findings from GuardDuty, Inspector, etc.

---

## 7) False Positives & Disagreements Welcome

**Where I might be wrong:**

1. **IS-7 (Public S3 bucket)**: If this is for static site hosting, public access is intentional
2. **IS-2 (Public database)**: If this is dev/staging environment, might be acceptable (but document)
3. IAM wildcards might be acceptable in dev (but never in production)

**How to override my findings:**
- Show this is dev/staging environment (not production)
- Show AWS Config rules that monitor for misconfigurations
- Show compensating controls (WAF, network ACLs, GuardDuty)
- Document exceptions with business justification

I'm optimizing for **secure-by-default production**. If there's a good reason for a configuration, let's document it!

---

*Review completed: {YYYY-MM-DD}*
*Session: [{SESSION_SLUG}](../README.md)*
```

# SUMMARY OUTPUT

After creating review, print:

```markdown
# Infrastructure Security Review Complete

## Review Location
Saved to: `.claude/{SESSION_SLUG}/reviews/review-infra-security-{YYYY-MM-DD}.md`

## Security Posture
**{SECURE | MOSTLY_SECURE | VULNERABLE | CRITICAL_ISSUES}**

## Critical Misconfigurations (BLOCKER)
1. **{Finding ID}**: {Resource} - {Misconfiguration}
2. **{Finding ID}**: {Resource} - {Misconfiguration}

## Statistics
- Resources reviewed: {count}
- Findings: BLOCKER: {X}, HIGH: {X}, MED: {X}, LOW: {X}
- Compliance: {PASS | FAIL} (SOC 2, HIPAA, PCI DSS)

## Security Posture by Category
- IAM Security: {Least Privilege | Overpermissive | Critical}
- Network Security: {Segmented | Exposed | Critical}
- Secrets Management: {Secure | Exposed | Critical}
- Encryption: {Comprehensive | Gaps | Missing}

## Immediate Actions Required
{If BLOCKER findings:}
1. {Finding ID}: {Fix description} ({estimated time})
2. {Finding ID}: {Fix description} ({estimated time})

**DO NOT DEPLOY** until critical misconfigurations fixed.

## Blast Radius Summary
{Most critical issue}:
- Attacker gains: {What access}
- Can exfiltrate: {What data}
- Can destroy: {What resources}

## Compliance Status
- SOC 2: {PASS | FAIL} ({X} violations)
- HIPAA: {PASS | FAIL} ({X} violations)
- PCI DSS: {PASS | FAIL} ({X} violations)

## Next Steps
1. Fix BLOCKER misconfigurations (IS-1, IS-2, IS-3)
2. Enable CloudTrail and audit logging
3. Run AWS Config for continuous monitoring
4. Schedule pen test after fixes

## Resources
- AWS Security Best Practices: https://aws.amazon.com/security/best-practices/
- CIS Benchmarks: https://www.cisecurity.org/cis-benchmarks/
- OWASP Cloud Security: https://owasp.org/www-project-cloud-security/
```

# IMPORTANT: Think Like an Attacker

This review should:
- **Show attack paths**: Concrete exploitation steps
- **Assess blast radius**: What attacker gains if compromised
- **Prioritize by impact**: Public database > missing logs
- **Fix with least privilege**: Specific ARNs, private subnets, encryption
- **Consider compliance**: HIPAA, SOC 2, PCI DSS requirements

The goal is to catch **"one misconfiguration = full breach"** issues before production.

# WHEN TO USE

Run `/review:infra-security` when:
- Before production deployments (catch misconfigurations)
- After infrastructure changes (IAM, networking, storage)
- Before security audits (SOC 2, pen tests)
- After security incidents (verify fixes)
- For compliance reviews (HIPAA, PCI DSS)

This should be in the default review chain for all infrastructure work types.
