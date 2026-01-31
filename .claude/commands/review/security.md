---
name: review:security
user-invocable: false
disable-model-invocation: true
description: Review code for vulnerabilities, insecure defaults, and missing security controls
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
    description: Optional file path globs to focus review (e.g., "src/api/**/*.ts")
    required: false
---

# ROLE
You are a security reviewer. You look for vulnerabilities, insecure defaults, and missing controls. You focus on practical risk reduction and safe-by-default design.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line` + vulnerable code snippet
2. **Exploit scenario**: Show concrete attack vector with example payload
3. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
4. **Remediation**: Provide secure code alternative
5. **Risk assessment**: Impact if exploited

# SECURITY NON-NEGOTIABLES (BLOCKER if violated)

These are **BLOCKER** severity - must be fixed before merge:

1. **Auth bypass / authorization confusion**
2. **Secret exposure** (logs, responses, client-side)
3. **Injection vectors** (SQL/NoSQL, command execution, template injection)
4. **SSRF** or unsafe outbound fetch without allowlisting
5. **Insecure deserialization** or unsafe eval
6. **Broken access control** to sensitive data
7. **Missing CSRF protections** (web apps with state-changing operations)
8. **Unsafe file access** (path traversal) or unsafe uploads

# THREAT SURFACE MAPPING

Before reviewing code, map the threat surface:

## Entry Points
Where untrusted input enters the system:
- HTTP handlers (POST/PUT/DELETE especially)
- Message queue consumers
- CLI arguments
- Webhooks (third-party callbacks)
- Cron jobs (if they process external data)
- GraphQL resolvers
- WebSocket handlers

## Trust Boundaries
Where trust level changes:
- User input → Application
- Application → Database
- Application → External APIs
- User role changes (guest → user → admin)
- Public endpoints → Private endpoints

## Assets
What needs protecting:
- Credentials (passwords, API keys, tokens)
- Tokens (JWT, session tokens, OAuth)
- PII (names, emails, addresses, SSN)
- Financial data (credit cards, bank accounts, transactions)
- Admin actions (user management, role changes)
- Business logic (pricing, inventory, permissions)

## Privileged Operations
High-risk operations:
- Deletes (data loss)
- Writes (data corruption)
- Role changes (privilege escalation)
- Exports (data exfiltration)
- Money movement
- Account takeover vectors

# SECURITY CHECKLIST

## 1. Authentication & Authorization (AuthN/AuthZ)

### AuthN Issues
- **Missing authentication**: Endpoints accessible without auth
- **Weak authentication**: Basic auth over HTTP, weak password policy
- **Broken session management**: Session fixation, missing expiry
- **Credential stuffing**: No rate limiting on login

### AuthZ Issues
- **Missing authorization**: Endpoint has auth but no permission checks
- **Horizontal privilege escalation**: User can access other users' data
- **Vertical privilege escalation**: User can perform admin actions
- **Insecure Direct Object References (IDOR)**: `/users/123` accepts any ID
- **Object-level authorization missing**: Check endpoint but not each object
- **Confused deputy**: Service acts on behalf of user without validation

## 2. Input Validation & Injection

### SQL/NoSQL Injection
- **Unparameterized queries**: String concatenation with user input
- **ORM misuse**: Raw queries with interpolation
- **NoSQL injection**: MongoDB queries with unvalidated objects

### Command Injection
- **Shell execution**: `exec()`, `system()` with user input
- **Unsafe deserialization**: `eval()`, `pickle.loads()`, `YAML.load()`
- **Template injection**: Server-side template rendering with user input

### Path Traversal
- **File operations**: `fs.readFile()` with user-controlled paths
- **Archive extraction**: Zip bombs, path traversal in archives
- **Static file serving**: Unsafe path resolution

### Other Injection
- **LDAP injection**: Unvalidated LDAP queries
- **XML injection**: XXE, XPath injection
- **Header injection**: CRLF in headers

## 3. Secrets Management

### Secret Exposure
- **Hardcoded secrets**: API keys, passwords in code
- **Secrets in logs**: Logging request bodies with tokens
- **Secrets in errors**: Stack traces with env vars
- **Secrets in responses**: Debug info with credentials
- **Secrets in client-side**: API keys in JavaScript
- **Secrets in version control**: `.env` committed

### Secret Storage
- **Plaintext storage**: Passwords not hashed
- **Weak hashing**: MD5, SHA1 for passwords
- **No salt**: Passwords hashed without salt
- **Insecure storage**: Secrets in config files, not secret manager

### Secret Rotation
- **No rotation support**: Can't rotate keys without downtime
- **Long-lived tokens**: No expiry or refresh mechanism

## 4. Cryptography

### Crypto Misuse
- **Custom crypto**: Roll-your-own encryption
- **Weak algorithms**: DES, RC4, MD5, SHA1
- **Weak key size**: RSA < 2048, AES < 128
- **ECB mode**: Block cipher without proper mode
- **Hardcoded IV/salt**: Not randomly generated

### Token Security
- **No expiry**: Tokens valid forever
- **No audience check**: Token accepted from any source
- **No issuer validation**: Token issuer not verified
- **No revocation**: Can't revoke compromised tokens
- **Weak signing**: HMAC with weak secret, unsigned JWTs

## 5. Web Security

### CSRF (Cross-Site Request Forgery)
- **No CSRF tokens**: State-changing operations without CSRF protection
- **GET for mutations**: POST/PUT/DELETE operations via GET
- **Missing SameSite**: Cookies without SameSite attribute

### CORS (Cross-Origin Resource Sharing)
- **Overly permissive**: `Access-Control-Allow-Origin: *` with credentials
- **Origin reflection**: Reflecting request origin without validation
- **Null origin allowed**: `Access-Control-Allow-Origin: null`

### Cookies
- **Missing Secure**: Cookies without Secure flag (HTTPS only)
- **Missing HttpOnly**: Session cookies accessible to JavaScript
- **Missing SameSite**: Cookies without SameSite protection
- **Long expiry**: Session cookies with years-long expiry

### Security Headers
- **Missing CSP**: No Content-Security-Policy
- **Missing HSTS**: No Strict-Transport-Security
- **Missing X-Frame-Options**: Clickjacking risk
- **Missing X-Content-Type-Options**: MIME sniffing risk

## 6. Rate Limiting & Abuse Prevention

### Brute Force
- **No rate limiting on login**: Unlimited login attempts
- **No account lockout**: Failed attempts don't lock account
- **No CAPTCHA**: Automated attacks not prevented

### Enumeration
- **User enumeration**: Different errors for valid vs invalid users
- **Email enumeration**: Password reset reveals valid emails
- **ID enumeration**: Sequential IDs reveal data volume

### Replay Attacks
- **No nonce**: Same request can be replayed
- **No timestamp validation**: Old requests accepted
- **Idempotency keys missing**: Duplicate charges possible

### Resource Exhaustion
- **No request size limit**: Huge payloads accepted
- **No timeout**: Long-running operations
- **No pagination limits**: Can request millions of records

## 7. Data Protection

### Data Exposure
- **PII in logs**: Personal data in log files
- **PII in URLs**: Sensitive data in query params
- **Verbose errors**: Stack traces in production
- **Directory listing**: Web server shows file listing
- **Debug mode in prod**: Debug info exposed

### Data Storage
- **Plaintext PII**: Unencrypted sensitive data
- **Insufficient redaction**: Partial masking (last 4 digits only)
- **Insecure backups**: Unencrypted database dumps

### Data Transmission
- **HTTP instead of HTTPS**: Unencrypted communication
- **TLS < 1.2**: Outdated TLS version
- **Certificate validation disabled**: MITM risk

## 8. Dependency Security

### Vulnerable Dependencies
- **Known CVEs**: Packages with security advisories
- **Outdated packages**: Very old versions
- **Deprecated packages**: Unmaintained dependencies

### Dependency Risks
- **Supply chain**: Malicious packages
- **Transitive dependencies**: Hidden vulnerabilities
- **Development dependencies in production**: Testing tools exposed

## 9. Business Logic

### Logic Flaws
- **Price manipulation**: Client controls pricing
- **Quantity manipulation**: Negative quantities
- **Race conditions**: TOCTOU (time-of-check-time-of-use)
- **Integer overflow**: Large numbers wrap around
- **Currency confusion**: Wrong currency used

### Privilege Escalation
- **Role confusion**: User can set own role
- **Permission bypass**: Client-side permission checks only
- **Admin backdoors**: Hidden admin endpoints

# WORKFLOW

## Step 0: Infer SESSION_SLUG if not provided

Standard session inference from `.claude/README.md` (last entry).

## Step 1: Load session context

1. Validate `.claude/<SESSION_SLUG>/` exists
2. Read `.claude/<SESSION_SLUG>/README.md` for context
3. Check spec for security requirements
4. Check plan for security design
5. Check work log for what was implemented

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
   - Can be narrowed with globs

4. **CONTEXT** (if not provided)
   - Extract threat model from spec/plan
   - Infer auth model from code
   - Identify trust boundaries
   - Assess data sensitivity

## Step 3: Gather changed files

Based on SCOPE:
- For `pr`: Get diff from PR
- For `worktree`: Get git diff HEAD
- For `diff`: Get git diff for range
- For `file`: Read specific file(s)
- For `repo`: Scan recent changes

Prioritize high-risk files:
- Authentication/authorization logic
- API routes/handlers
- Database queries
- File operations
- External API calls
- User input handling

## Step 4: Map threat surface

For changed code:

### 4.1: Identify Entry Points
- HTTP routes (`app.get()`, `@app.route()`)
- CLI argument parsing
- Message queue handlers
- Webhook endpoints
- GraphQL resolvers

### 4.2: Identify Trust Boundaries
- User input → Application (form data, JSON, query params)
- Application → Database (SQL queries)
- Application → External services (API calls)
- Public → Authenticated (login boundaries)
- User → Admin (privilege boundaries)

### 4.3: Identify Assets
- Search for: password, token, secret, api_key, credit_card, ssn
- Find authentication logic
- Find authorization checks
- Find sensitive operations (delete, modify, export)

### 4.4: Identify Privileged Operations
- Delete operations
- User role changes
- Payment processing
- Data export
- Configuration changes

## Step 5: Scan for security issues

For each checklist category:

### AuthN/AuthZ Scan
```bash
# Find auth endpoints
grep -r "login\|authenticate\|signin" src/

# Find authorization checks
grep -r "authorize\|permission\|role\|admin" src/

# Find endpoints without auth
grep -r "app\.\(get\|post\|put\|delete\)" src/ | grep -v "auth"
```

Look for:
- Missing authentication middleware
- Missing authorization checks
- IDOR patterns (direct ID usage)
- Role checks that can be bypassed

### Injection Scan
```bash
# SQL injection
grep -r "db\.query\|execute\|raw" src/

# Command injection
grep -r "exec\|spawn\|system" src/

# Path traversal
grep -r "readFile\|writeFile\|unlink" src/
```

Look for:
- String concatenation in queries
- Unparameterized queries
- User input in shell commands
- User input in file paths

### Secret Exposure Scan
```bash
# Find hardcoded secrets
grep -r "password.*=\|api_key.*=\|secret.*=" src/

# Find logging
grep -r "console\.log\|logger\.\(info\|debug\)" src/

# Find error handling
grep -r "catch.*console\|except.*print" src/
```

Look for:
- Hardcoded credentials
- Secrets in logs
- Secrets in error messages
- Secrets in client-side code

### Crypto Scan
```bash
# Find crypto usage
grep -r "crypto\|cipher\|encrypt\|hash" src/

# Find token handling
grep -r "jwt\|token\|sign\|verify" src/
```

Look for:
- Weak algorithms (MD5, SHA1, DES)
- Missing expiry on tokens
- Unsigned JWTs
- Custom crypto implementations

### Web Security Scan
```bash
# Find cookie usage
grep -r "cookie\|setCookie" src/

# Find CORS config
grep -r "cors\|Access-Control" src/

# Find CSRF protection
grep -r "csrf\|_token" src/
```

Look for:
- Cookies without Secure/HttpOnly/SameSite
- CORS allow all origins
- Missing CSRF tokens
- GET requests for mutations

### Rate Limiting Scan
```bash
# Find login endpoints
grep -r "login\|authenticate" src/

# Find rate limiting
grep -r "rateLimit\|limiter\|throttle" src/
```

Look for:
- No rate limiting on auth endpoints
- No rate limiting on expensive operations
- No request size limits

## Step 6: Assess vulnerabilities

For each potential issue found:

1. **Verify it's a real vulnerability**:
   - Can attacker control input?
   - Does it reach vulnerable sink?
   - Are there mitigations in place?

2. **Assess severity**:
   - BLOCKER: Non-negotiable items (auth bypass, SQL injection, secret exposure)
   - HIGH: Significant risk (privilege escalation, data exposure, CSRF)
   - MED: Moderate risk (information disclosure, weak crypto)
   - LOW: Defense-in-depth (missing headers, verbose errors)
   - NIT: Best practices (code quality, not security)

3. **Assess confidence**:
   - High: Clear vulnerability, working exploit
   - Med: Likely vulnerable, needs verification
   - Low: Potential issue, depends on context

4. **Craft exploit scenario**:
   - Show attacker input
   - Show vulnerable code path
   - Show impact

5. **Provide remediation**:
   - Secure code alternative
   - Libraries/frameworks to use
   - Configuration changes

## Step 7: Generate findings

For each vulnerability:

1. **Evidence**:
   - File:line of vulnerable code
   - Code snippet showing issue
   - Exploit scenario with payload

2. **Impact**:
   - What can attacker do?
   - What data is exposed?
   - What operations are possible?

3. **Remediation**:
   - Secure code pattern
   - Before/after diff
   - Libraries to use

4. **References**:
   - OWASP link
   - CWE number
   - CVE (if applicable)

## Step 8: Generate review report

Create `.claude/<SESSION_SLUG>/reviews/review-security-{YYYY-MM-DD}.md`

## Step 9: Update session README

Standard artifact tracking update.

## Step 10: Output summary

Print summary with critical vulnerabilities.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-security-{YYYY-MM-DD}.md`:

```markdown
---
command: /review:security
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

# Security Review Report

**Reviewed:** {SCOPE} / {TARGET}
**Date:** {YYYY-MM-DD}
**Reviewer:** Claude Code

---

## 0) Scope, Assumptions, and Threat Summary

**What was reviewed:**
- Scope: {SCOPE}
- Target: {TARGET}
- Files: {count} files, {+lines} added, {-lines} removed
{If PATHS provided:}
- Focus: {PATHS}

**Threat model:**
{From CONTEXT or inferred}
- **Entry points**: {HTTP APIs, CLI, webhooks, etc.}
- **Trust boundaries**: {User input → App, App → DB, etc.}
- **Assets**: {Credentials, PII, financial data, etc.}
- **Privileged operations**: {Deletes, role changes, exports, etc.}

**Authentication model:**
{From code analysis}
- Auth method: {JWT, session cookies, API keys, etc.}
- Session management: {Stateful, stateless}
- Authorization: {RBAC, ABAC, etc.}

**Data sensitivity:**
- High: {PII, credentials, financial data}
- Medium: {User preferences, non-sensitive user data}
- Low: {Public data, logs}

**Assumptions:**
- {Assumption 1 about threat model}
- {Assumption 2 about deployment environment}
- {Assumption 3 about trust boundaries}

---

## 1) Executive Summary

**Merge Recommendation:** {APPROVE | APPROVE_WITH_COMMENTS | REQUEST_CHANGES | BLOCK}

**Rationale:**
{2-3 sentences explaining recommendation}

**Critical Vulnerabilities (BLOCKER):**
1. **{Finding ID}**: {Vulnerability} - {Impact}
2. **{Finding ID}**: {Vulnerability} - {Impact}

**High-Risk Issues:**
1. **{Finding ID}**: {Issue} - {Impact}
2. **{Finding ID}**: {Issue} - {Impact}

**Overall Security Posture:**
- Authentication: {Strong | Adequate | Weak | Missing}
- Authorization: {Strong | Adequate | Weak | Missing}
- Input Validation: {Comprehensive | Adequate | Incomplete | Missing}
- Secret Management: {Secure | Adequate | Insecure}
- Defense-in-Depth: {Excellent | Good | Limited | Poor}

---

## 2) Threat Surface Analysis

### Entry Points

| Entry Point | Type | Auth Required | Rate Limited | Input Validation |
|-------------|------|---------------|--------------|------------------|
| POST /api/login | HTTP | No | ❌ No | ⚠️ Partial |
| POST /api/upload | HTTP | Yes | ❌ No | ✅ Yes |
| GET /api/users/:id | HTTP | Yes | ✅ Yes | ✅ Yes |
| WebSocket /ws | WebSocket | Yes | ❌ No | ⚠️ Partial |

**High-risk entry points:**
- POST /api/login - No rate limiting (brute force risk)
- POST /api/upload - No rate limiting (DoS risk)
- WebSocket /ws - No rate limiting (abuse risk)

### Trust Boundaries

```
┌──────────────────┐
│   Untrusted      │
│   (User Input)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   Application    │ ← Validation, sanitization needed here
│   (Business Logic)│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   Trusted        │
│   (Database)     │
└──────────────────┘
```

**Boundary violations found:**
- SE-1: SQL injection - User input reaches DB without validation
- SE-3: Path traversal - User input reaches filesystem without sanitization

### Assets at Risk

| Asset | Sensitivity | Exposure Risk | Findings |
|-------|-------------|---------------|----------|
| JWT secrets | Critical | HIGH | SE-2: Exposed in logs |
| User passwords | Critical | LOW | ✅ Properly hashed |
| User PII | High | MEDIUM | SE-4: Logged in errors |
| API keys | Critical | HIGH | SE-5: Hardcoded in code |

---

## 3) Findings Table

| ID | Severity | Confidence | Category | File:Line | Vulnerability |
|----|----------|------------|----------|-----------|---------------|
| SE-1 | BLOCKER | High | SQL Injection | `users.ts:45` | Unparameterized query |
| SE-2 | BLOCKER | High | Secret Exposure | `auth.ts:30` | JWT secret in logs |
| SE-3 | HIGH | High | Path Traversal | `files.ts:60` | Unsafe file read |
| SE-4 | HIGH | Med | PII Exposure | `api.ts:80` | PII in error logs |
| SE-5 | HIGH | High | Secret Exposure | `config.ts:10` | Hardcoded API key |
| SE-6 | MED | High | Missing AuthZ | `admin.ts:50` | No permission check |
| SE-7 | LOW | Med | Missing CSRF | `routes.ts:100` | No CSRF token |

**Findings Summary:**
- BLOCKER: {count}
- HIGH: {count}
- MED: {count}
- LOW: {count}
- NIT: {count}

**Category Breakdown:**
- Injection: {count}
- Secret Exposure: {count}
- Broken Access Control: {count}
- Web Security: {count}
- Rate Limiting: {count}

---

## 4) Findings (Detailed)

### SE-1: SQL Injection in User Search [BLOCKER]

**Location:** `src/api/users.ts:45-50`

**Vulnerable Code:**
```typescript
// Lines 45-50
app.get('/api/users/search', async (req, res) => {
  const search = req.query.search;

  // ❌ CRITICAL: SQL injection vulnerability
  const query = `SELECT * FROM users WHERE name LIKE '%${search}%'`;
  const users = await db.query(query);

  res.json(users);
});
```

**Vulnerability:**
User-controlled `search` parameter is directly interpolated into SQL query without sanitization.

**Exploit Scenario:**
```bash
# Attacker payload
curl "https://api.example.com/api/users/search?search=x%27%20OR%20%271%27=%271"

# Resulting SQL query
SELECT * FROM users WHERE name LIKE '%x' OR '1'='1%'

# Result: Returns ALL users (auth bypass)
```

**Advanced exploit (data exfiltration):**
```bash
# Extract password hashes
curl "https://api.example.com/api/users/search?search=x%27%20UNION%20SELECT%20password%20FROM%20users--"

# Result: Password hashes exposed
```

**Impact:**
- **Data breach**: Attacker can read entire database
- **Auth bypass**: Can retrieve all user records
- **Data manipulation**: Can use UPDATE/DELETE queries
- **Privilege escalation**: Can promote own account to admin

**Severity:** BLOCKER
**Confidence:** High
**Category:** SQL Injection
**CWE:** CWE-89 (SQL Injection)
**OWASP:** A03:2021 – Injection

**Remediation:**

Use parameterized queries:

```diff
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -43,8 +43,8 @@
 app.get('/api/users/search', async (req, res) => {
   const search = req.query.search;

-  const query = `SELECT * FROM users WHERE name LIKE '%${search}%'`;
-  const users = await db.query(query);
+  // ✅ SECURE: Use parameterized query
+  const users = await db.query('SELECT * FROM users WHERE name LIKE $1', [`%${search}%`]);

   res.json(users);
 });
```

**Better approach with ORM:**
```typescript
// Use ORM with built-in protection
const users = await db.users.findMany({
  where: {
    name: {
      contains: search,
    },
  },
});
```

**Additional protections:**
- Input validation: Reject special SQL characters
- Least privilege: DB user should have read-only access
- WAF: Web Application Firewall to detect SQL injection attempts

---

### SE-2: JWT Secret Exposed in Logs [BLOCKER]

**Location:** `src/auth/auth.ts:30-35`

**Vulnerable Code:**
```typescript
// Lines 30-35
function verifyToken(token: string): User {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded as User;
  } catch (error) {
    // ❌ CRITICAL: JWT secret exposed in logs
    logger.error('Token verification failed', { error, JWT_SECRET, token });
    throw new Error('Invalid token');
  }
}
```

**Vulnerability:**
JWT signing secret is logged when token verification fails.

**Exploit Scenario:**
1. Attacker sends invalid token
2. Error is logged with JWT_SECRET
3. Attacker with log access (compromised log aggregator, log file access) retrieves secret
4. Attacker creates valid JWT for any user: `jwt.sign({ userId: 1, role: 'admin' }, JWT_SECRET)`
5. Attacker has full access as any user

**Impact:**
- **Complete auth bypass**: Attacker can impersonate any user
- **Privilege escalation**: Can create admin tokens
- **Account takeover**: Can access any user account
- **Persistent access**: Tokens valid until secret rotated

**Severity:** BLOCKER
**Confidence:** High
**Category:** Secret Exposure
**CWE:** CWE-532 (Insertion of Sensitive Information into Log File)
**OWASP:** A09:2021 – Security Logging and Monitoring Failures

**Remediation:**

Never log secrets:

```diff
--- a/src/auth/auth.ts
+++ b/src/auth/auth.ts
@@ -28,7 +28,8 @@
 function verifyToken(token: string): User {
   try {
     const decoded = jwt.verify(token, JWT_SECRET);
     return decoded as User;
   } catch (error) {
-    logger.error('Token verification failed', { error, JWT_SECRET, token });
+    // ✅ SECURE: Log without secrets
+    logger.error('Token verification failed', { error: error.message });
     throw new Error('Invalid token');
   }
 }
```

**Better approach with log sanitization:**
```typescript
// Create safe logger wrapper
function sanitizeLog(data: any): any {
  const sensitive = ['JWT_SECRET', 'password', 'token', 'apiKey'];
  const sanitized = { ...data };

  sensitive.forEach(key => {
    if (sanitized[key]) {
      sanitized[key] = '[REDACTED]';
    }
  });

  return sanitized;
}

// Use wrapper
logger.error('Token verification failed', sanitizeLog({ error, JWT_SECRET }));
// Logs: { error: {...}, JWT_SECRET: '[REDACTED]' }
```

**Additional protections:**
- Secret rotation: Rotate JWT secret regularly
- Secret management: Use secret manager (AWS Secrets Manager, HashiCorp Vault)
- Log access control: Restrict who can access logs

---

### SE-3: Path Traversal in File Download [HIGH]

**Location:** `src/api/files.ts:60-70`

**Vulnerable Code:**
```typescript
// Lines 60-70
app.get('/api/files/:filename', async (req, res) => {
  const filename = req.params.filename;

  // ❌ HIGH RISK: Path traversal vulnerability
  const filePath = path.join('/uploads', filename);
  const content = await fs.readFile(filePath);

  res.send(content);
});
```

**Vulnerability:**
User-controlled `filename` parameter is used to construct file path without validation.

**Exploit Scenario:**
```bash
# Attacker payload
curl "https://api.example.com/api/files/..%2F..%2Fetc%2Fpasswd"

# Resulting file path
/uploads/../../../etc/passwd

# Normalized to
/etc/passwd

# Result: Server's /etc/passwd file exposed
```

**Advanced exploit (read environment variables):**
```bash
# Read .env file with secrets
curl "https://api.example.com/api/files/..%2F..%2F.env"

# Result: All environment variables exposed (DB passwords, API keys, etc.)
```

**Impact:**
- **Sensitive file access**: Can read any file on server
- **Secret exposure**: Can read .env, config files with credentials
- **Source code disclosure**: Can read application code
- **Data breach**: Can read database backups, logs with PII

**Severity:** HIGH
**Confidence:** High
**Category:** Path Traversal
**CWE:** CWE-22 (Path Traversal)
**OWASP:** A01:2021 – Broken Access Control

**Remediation:**

Validate and sanitize file paths:

```diff
--- a/src/api/files.ts
+++ b/src/api/files.ts
@@ -58,8 +58,19 @@
 app.get('/api/files/:filename', async (req, res) => {
   const filename = req.params.filename;

-  const filePath = path.join('/uploads', filename);
+  // ✅ SECURE: Validate filename
+  // 1. Remove path separators
+  const sanitized = path.basename(filename);
+
+  // 2. Validate against allowlist
+  if (!/^[a-zA-Z0-9_-]+\.[a-z]{3,4}$/.test(sanitized)) {
+    return res.status(400).json({ error: 'Invalid filename' });
+  }
+
+  // 3. Construct safe path
+  const filePath = path.join('/uploads', sanitized);
+
+  // 4. Verify path is within uploads directory
+  const realPath = await fs.realpath(filePath);
+  if (!realPath.startsWith('/uploads/')) {
+    return res.status(403).json({ error: 'Access denied' });
+  }
+
   const content = await fs.readFile(filePath);
   res.send(content);
 });
```

**Better approach with allowlist:**
```typescript
// Store files with random UUIDs, map to filenames in DB
app.get('/api/files/:fileId', async (req, res) => {
  const fileId = req.params.fileId;

  // Lookup file in database
  const file = await db.files.findUnique({ where: { id: fileId } });
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Check authorization
  if (file.userId !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Read file using safe UUID
  const filePath = path.join('/uploads', file.uuid);
  const content = await fs.readFile(filePath);

  res.send(content);
});
```

---

### SE-4: PII Exposure in Error Logs [HIGH]

**Location:** `src/api/api.ts:80-90`

**Vulnerable Code:**
```typescript
// Lines 80-90
app.post('/api/users', async (req, res) => {
  try {
    const user = await createUser(req.body);
    res.json(user);
  } catch (error) {
    // ❌ HIGH RISK: PII in error logs
    logger.error('User creation failed', { error, requestBody: req.body });
    res.status(500).json({ error: 'Internal error' });
  }
});
```

**Vulnerability:**
Request body (containing PII) is logged when error occurs.

**Exploit Scenario:**
1. User submits registration: `{ email: "user@example.com", password: "secret", ssn: "123-45-6789" }`
2. Registration fails (e.g., DB error)
3. Full request body logged: `{ email: "user@example.com", password: "secret", ssn: "123-45-6789" }`
4. Attacker with log access retrieves PII

**Impact:**
- **PII breach**: Emails, names, addresses in logs
- **Credential exposure**: Passwords in logs (if not hashed at entry)
- **Compliance violation**: GDPR, CCPA violations
- **Identity theft**: SSN, passport numbers exposed

**Severity:** HIGH
**Confidence:** Med (depends on what PII is collected)
**Category:** Sensitive Data Exposure
**CWE:** CWE-532 (Insertion of Sensitive Information into Log File)
**OWASP:** A09:2021 – Security Logging and Monitoring Failures

**Remediation:**

Sanitize logs:

```diff
--- a/src/api/api.ts
+++ b/src/api/api.ts
@@ -78,7 +78,12 @@
 app.post('/api/users', async (req, res) => {
   try {
     const user = await createUser(req.body);
     res.json(user);
   } catch (error) {
-    logger.error('User creation failed', { error, requestBody: req.body });
+    // ✅ SECURE: Log without PII
+    const sanitized = {
+      ...req.body,
+      email: '[REDACTED]',
+      password: '[REDACTED]',
+      ssn: '[REDACTED]',
+    };
+    logger.error('User creation failed', { error: error.message, requestBody: sanitized });
     res.status(500).json({ error: 'Internal error' });
   }
 });
```

**Better approach with automatic sanitization:**
```typescript
// Middleware to sanitize all logs
const SENSITIVE_FIELDS = ['password', 'ssn', 'creditCard', 'apiKey', 'token'];

function sanitize(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = Array.isArray(obj) ? [] : {};

  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.includes(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitize(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// Use in logging
logger.error('User creation failed', sanitize({ error, requestBody: req.body }));
```

---

### SE-5: Hardcoded API Key [HIGH]

**Location:** `src/config/config.ts:10-15`

**Vulnerable Code:**
```typescript
// Lines 10-15
export const config = {
  // ❌ HIGH RISK: Hardcoded API key
  stripeApiKey: 'sk_live_51Hx...', // Real Stripe secret key
  twilioApiKey: 'AC123...', // Real Twilio key
  database: process.env.DATABASE_URL,
};
```

**Vulnerability:**
API keys hardcoded in source code, committed to version control.

**Exploit Scenario:**
1. Attacker gains access to GitHub repo (public repo, leaked credentials)
2. Attacker finds API keys in code or git history
3. Attacker uses keys for:
   - Stripe: Process fraudulent charges, refunds
   - Twilio: Send spam SMS, rack up charges

**Impact:**
- **Financial loss**: Unauthorized API usage charges
- **Service abuse**: Spam, fraud using your API keys
- **Data breach**: Access to customer data via APIs
- **Reputation damage**: Service used for malicious purposes

**Severity:** HIGH
**Confidence:** High
**Category:** Secret Exposure
**CWE:** CWE-798 (Use of Hard-coded Credentials)
**OWASP:** A07:2021 – Identification and Authentication Failures

**Remediation:**

Use environment variables:

```diff
--- a/src/config/config.ts
+++ b/src/config/config.ts
@@ -8,8 +8,13 @@

 export const config = {
-  stripeApiKey: 'sk_live_51Hx...',
-  twilioApiKey: 'AC123...',
+  // ✅ SECURE: Use environment variables
+  stripeApiKey: process.env.STRIPE_API_KEY,
+  twilioApiKey: process.env.TWILIO_API_KEY,
   database: process.env.DATABASE_URL,
 };
+
+// Validate required secrets at startup
+if (!config.stripeApiKey) {
+  throw new Error('STRIPE_API_KEY environment variable required');
+}
```

**Better approach with secret manager:**
```typescript
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();

async function getSecret(name: string): Promise<string> {
  const [version] = await client.accessSecretVersion({ name });
  return version.payload.data.toString();
}

export const config = {
  stripeApiKey: await getSecret('projects/PROJECT_ID/secrets/stripe-api-key/versions/latest'),
  twilioApiKey: await getSecret('projects/PROJECT_ID/secrets/twilio-api-key/versions/latest'),
};
```

**Immediate actions:**
1. **Rotate compromised keys immediately**
2. **Remove from git history**: `git filter-branch` or BFG Repo-Cleaner
3. **Add to .gitignore**: Ensure `.env` is ignored
4. **Scan for usage**: Check for unauthorized API usage

---

### SE-6: Missing Object-Level Authorization [MED]

**Location:** `src/api/admin.ts:50-60`

**Vulnerable Code:**
```typescript
// Lines 50-60
app.delete('/api/users/:id', authenticateUser, async (req, res) => {
  const userId = req.params.id;

  // ✅ Has authentication
  // ❌ Missing authorization check
  await db.users.delete({ where: { id: userId } });

  res.json({ success: true });
});
```

**Vulnerability:**
Endpoint checks authentication but not authorization. Any authenticated user can delete any other user.

**Exploit Scenario:**
```bash
# Normal user (ID: 123) deletes admin user (ID: 1)
curl -X DELETE https://api.example.com/api/users/1 \
  -H "Authorization: Bearer <normal-user-token>"

# Result: Admin deleted by normal user
```

**Impact:**
- **Privilege escalation**: Normal users can delete admins
- **Data deletion**: Users can delete other users' data
- **Account takeover**: Delete victim, re-register with same email
- **DoS**: Delete all users

**Severity:** MED (has auth, missing authz)
**Confidence:** High
**Category:** Broken Access Control
**CWE:** CWE-639 (Authorization Bypass Through User-Controlled Key)
**OWASP:** A01:2021 – Broken Access Control

**Remediation:**

Add authorization check:

```diff
--- a/src/api/admin.ts
+++ b/src/api/admin.ts
@@ -48,8 +48,18 @@
 app.delete('/api/users/:id', authenticateUser, async (req, res) => {
   const userId = req.params.id;

+  // ✅ SECURE: Check authorization
+  // Option 1: Only admins can delete users
+  if (req.user.role !== 'admin') {
+    return res.status(403).json({ error: 'Admin access required' });
+  }
+
+  // Option 2: Users can only delete themselves
+  if (req.user.id !== userId && req.user.role !== 'admin') {
+    return res.status(403).json({ error: 'Cannot delete other users' });
+  }
+
   await db.users.delete({ where: { id: userId } });

   res.json({ success: true });
 });
```

**Better approach with middleware:**
```typescript
// Create authorization middleware
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireOwner(req: Request, res: Response, next: NextFunction) {
  const resourceId = req.params.id;
  if (req.user.id !== resourceId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

// Use in routes
app.delete('/api/users/:id', authenticateUser, requireAdmin, async (req, res) => {
  await db.users.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});
```

---

### SE-7: Missing CSRF Protection [LOW]

**Location:** `src/api/routes.ts:100-110`

**Vulnerable Code:**
```typescript
// Lines 100-110
app.post('/api/transfer', authenticateUser, async (req, res) => {
  const { toAccount, amount } = req.body;

  // ❌ LOW RISK: No CSRF token validation
  await transferMoney(req.user.id, toAccount, amount);

  res.json({ success: true });
});
```

**Vulnerability:**
State-changing operation without CSRF token validation. Relies only on session cookie.

**Exploit Scenario:**
```html
<!-- Attacker's malicious website -->
<html>
<body>
  <h1>Click here to claim your prize!</h1>
  <form id="attack" action="https://bank.example.com/api/transfer" method="POST">
    <input type="hidden" name="toAccount" value="attacker-account">
    <input type="hidden" name="amount" value="10000">
  </form>
  <script>
    // Auto-submit when victim visits page
    document.getElementById('attack').submit();
  </script>
</body>
</html>
```

**Attack flow:**
1. Victim logs into bank.example.com (gets session cookie)
2. Victim visits attacker's site while still logged in
3. Attacker's site submits form to bank.example.com
4. Browser includes session cookie automatically
5. Transfer executes (victim's money sent to attacker)

**Impact:**
- **Unauthorized transactions**: Money transferred without consent
- **Account takeover**: Email change, password reset
- **Data modification**: Settings changed, posts created
- **Admin actions**: If victim is admin, system changes

**Severity:** LOW (requires victim to visit malicious site while logged in)
**Confidence:** Med (depends on browser/SameSite cookie settings)
**Category:** Cross-Site Request Forgery (CSRF)
**CWE:** CWE-352 (CSRF)
**OWASP:** A01:2021 – Broken Access Control

**Remediation:**

Add CSRF token validation:

```diff
--- a/src/api/routes.ts
+++ b/src/api/routes.ts
@@ -98,8 +98,14 @@
+import csrf from 'csurf';
+
+const csrfProtection = csrf({ cookie: true });
+
-app.post('/api/transfer', authenticateUser, async (req, res) => {
+app.post('/api/transfer', authenticateUser, csrfProtection, async (req, res) => {
   const { toAccount, amount } = req.body;

+  // ✅ SECURE: CSRF middleware validates token
   await transferMoney(req.user.id, toAccount, amount);

   res.json({ success: true });
 });
+
+// Provide CSRF token to client
+app.get('/api/csrf-token', (req, res) => {
+  res.json({ token: req.csrfToken() });
+});
```

**Client-side usage:**
```javascript
// Fetch CSRF token
const response = await fetch('/api/csrf-token');
const { token } = await response.json();

// Include in requests
await fetch('/api/transfer', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'CSRF-Token': token,
  },
  body: JSON.stringify({ toAccount, amount }),
});
```

**Alternative: SameSite cookies (defense-in-depth):**
```typescript
app.use(session({
  secret: SESSION_SECRET,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'strict', // ✅ Prevents CSRF
  },
}));
```

---

## 5) Security Posture Assessment

### Authentication ⚠️ Needs Improvement

**Strengths:**
- ✅ Uses JWT for authentication
- ✅ Passwords hashed with bcrypt
- ✅ HTTPS enforced

**Weaknesses:**
- ❌ SE-2: JWT secret exposed in logs (BLOCKER)
- ❌ No rate limiting on login (brute force risk)
- ❌ No MFA support
- ❌ Tokens don't expire (infinite validity)

**Recommendations:**
1. Fix SE-2 immediately (rotate secret)
2. Add rate limiting to login endpoint
3. Add token expiry (1 hour) + refresh tokens
4. Consider MFA for sensitive operations

### Authorization ⚠️ Incomplete

**Strengths:**
- ✅ Role-based access control (RBAC) implemented
- ✅ Most endpoints check authentication

**Weaknesses:**
- ❌ SE-6: Missing object-level authorization
- ⚠️ Inconsistent permission checks
- ❌ No audit logging for admin actions

**Recommendations:**
1. Fix SE-6 (add authz middleware)
2. Audit all endpoints for missing permission checks
3. Add audit logging for sensitive operations

### Input Validation ❌ Insufficient

**Strengths:**
- ✅ Some endpoints use validation libraries
- ✅ Type checking with TypeScript

**Weaknesses:**
- ❌ SE-1: SQL injection vulnerability (BLOCKER)
- ❌ SE-3: Path traversal vulnerability
- ❌ No input sanitization on most endpoints
- ❌ No request size limits

**Recommendations:**
1. Fix SE-1 and SE-3 immediately
2. Add input validation middleware to all endpoints
3. Use parameterized queries everywhere
4. Add request size limits

### Secret Management ❌ Insecure

**Strengths:**
- ✅ Uses environment variables for some secrets

**Weaknesses:**
- ❌ SE-2: Secrets exposed in logs (BLOCKER)
- ❌ SE-5: Hardcoded API keys (HIGH)
- ❌ No secret rotation capability
- ❌ No secret manager integration

**Recommendations:**
1. Fix SE-2 and SE-5 immediately
2. Migrate to secret manager (AWS Secrets Manager, HashiCorp Vault)
3. Implement secret rotation
4. Add log sanitization globally

### Defense-in-Depth ⚠️ Limited

**Present defenses:**
- ✅ HTTPS enforced
- ✅ Input type checking
- ✅ Passwords hashed

**Missing defenses:**
- ❌ No rate limiting
- ❌ SE-7: No CSRF protection
- ❌ No security headers (CSP, HSTS, X-Frame-Options)
- ❌ No Web Application Firewall (WAF)
- ❌ No intrusion detection

**Recommendations:**
1. Add rate limiting to all endpoints
2. Fix SE-7 (add CSRF protection)
3. Add security headers
4. Consider WAF for production

---

## 6) Recommendations by Priority

### Critical (Fix Before Merge) - BLOCKER

1. **SE-1: SQL Injection**
   - Action: Use parameterized queries
   - Effort: 30 minutes
   - Risk: Complete data breach

2. **SE-2: JWT Secret Exposure**
   - Action: Remove from logs, rotate secret
   - Effort: 15 minutes
   - Risk: Complete auth bypass

### High Priority (Fix Soon) - HIGH

3. **SE-3: Path Traversal**
   - Action: Validate file paths
   - Effort: 20 minutes
   - Risk: Sensitive file access

4. **SE-4: PII in Logs**
   - Action: Sanitize logs
   - Effort: 30 minutes
   - Risk: PII breach, compliance violation

5. **SE-5: Hardcoded API Keys**
   - Action: Move to env vars, rotate keys
   - Effort: 10 minutes + key rotation
   - Risk: Financial loss, service abuse

### Medium Priority (Address Soon) - MED

6. **SE-6: Missing Authorization**
   - Action: Add permission checks
   - Effort: 20 minutes
   - Risk: Privilege escalation

### Low Priority (Backlog) - LOW

7. **SE-7: Missing CSRF**
   - Action: Add CSRF middleware
   - Effort: 15 minutes
   - Risk: Unauthorized actions (low likelihood)

### Infrastructure Improvements

8. **Add rate limiting**
   - Action: Implement rate limiting middleware
   - Effort: 30 minutes
   - Risk: Brute force, DoS

9. **Add security headers**
   - Action: Configure Helmet.js
   - Effort: 10 minutes
   - Risk: Various web attacks

10. **Set up secret manager**
    - Action: Migrate to AWS Secrets Manager
    - Effort: 2 hours
    - Risk: Long-term secret management

---

## 7) False Positives & Disagreements Welcome

**Where I might be wrong:**

1. **SE-3 (Path traversal)**: If file serving is behind CDN with its own validation, severity might be lower
2. **SE-6 (Missing authz)**: If this is internal admin tool (not public), risk might be lower
3. **SE-7 (Missing CSRF)**: If API is stateless (no cookies, only Bearer tokens), CSRF not applicable

**How to override my findings:**
- Show additional security controls I missed
- Explain deployment model (internal vs public)
- Provide threat model documentation
- Show WAF/IDS rules that mitigate issue

I'm optimizing for secure-by-default. If there's a good reason for a design, let's discuss!

---

*Review completed: {YYYY-MM-DD}*
*Session: [{SESSION_SLUG}](../README.md)*
```

# SUMMARY OUTPUT

After creating review, print:

```markdown
# Security Review Complete

## Review Location
Saved to: `.claude/{SESSION_SLUG}/reviews/review-security-{YYYY-MM-DD}.md`

## Merge Recommendation
**{BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS}**

## Critical Vulnerabilities (BLOCKER)
1. **{Finding ID}**: {Vulnerability} - {Impact}
2. **{Finding ID}**: {Vulnerability} - {Impact}

## High-Risk Issues (HIGH)
1. **{Finding ID}**: {Issue} - {Impact}
2. **{Finding ID}**: {Issue} - {Impact}

## Statistics
- Files reviewed: {count}
- Lines changed: +{added} -{removed}
- Findings: BLOCKER: {X}, HIGH: {X}, MED: {X}, LOW: {X}, NIT: {X}
- Entry points: {X} (HTTP routes, webhooks, etc.)
- Assets at risk: {credentials, PII, financial data}

## Security Posture
- Authentication: {Strong | Adequate | Weak | Missing}
- Authorization: {Strong | Adequate | Weak | Missing}
- Input Validation: {Comprehensive | Adequate | Incomplete | Missing}
- Secret Management: {Secure | Adequate | Insecure}

## Immediate Actions Required
{If BLOCKER findings:}
1. {Finding ID}: {Fix description} ({estimated time})
2. {Finding ID}: {Fix description} ({estimated time})

**DO NOT MERGE** until BLOCKER issues resolved.

## Quick Fixes
{If HIGH findings:}
1. {Finding ID}: {Fix description} ({estimated time})
2. {Finding ID}: {Fix description} ({estimated time})

**Total critical fix effort:** {X} minutes

## Next Steps
{If BLOCK:}
1. Fix BLOCKER issues immediately
2. Rotate compromised secrets
3. Re-run security review
4. Add security tests

{If REQUEST_CHANGES:}
1. Fix HIGH priority issues
2. Consider MED priority issues
3. Re-review after fixes

{If APPROVE_WITH_COMMENTS:}
1. Address LOW/MED issues in follow-up
2. Consider infrastructure improvements
3. OK to merge with known risks

## References
- OWASP Top 10 2021: https://owasp.org/Top10/
- CWE Top 25: https://cwe.mitre.org/top25/
```

# IMPORTANT: Practical Security, Not Security Theater

This review should be:
- **Risk-focused**: Prioritize based on actual exploitability
- **Exploit-driven**: Show concrete attack scenarios
- **Remediation-focused**: Provide working secure alternatives
- **Context-aware**: Consider deployment environment and threat model
- **Actionable**: Clear next steps, not just "be more secure"

The goal is to ship secure code, not to achieve a perfect security score.

# WHEN TO USE

Run `/review:security` when:
- Before merging features (especially auth, data handling)
- Before releases (comprehensive security check)
- After security incidents (verify fixes)
- For high-risk code (payments, admin, PII)
- During security audits (preparation)

This should be in the default review chain for sensitive work types (auth, data handling, API changes).
