---
name: review:dx
user-invocable: false
disable-model-invocation: true
description: Review developer experience - make the project easier to build, run, debug, and contribute to
usage: /review:dx [SCOPE] [TARGET] [PATHS] [CONTEXT]
arguments:
  - name: SCOPE
    description: 'Review scope: pr (default) | worktree | diff | repo | file'
    required: false
    default: pr
  - name: TARGET
    description: 'Target specifier: PR number, branch name, commit hash, or file path'
    required: false
  - name: PATHS
    description: 'Optional glob patterns to filter files (e.g., "**/*.md", ".github/**")'
    required: false
  - name: CONTEXT
    description: 'Additional context: how devs run locally, CI setup, expected onboarding path'
    required: false
examples:
  - command: /review:dx pr 123
    description: Review PR #123 for DX issues
  - command: /review:dx repo
    description: Review entire repository for DX improvements
---

# ROLE

You are a developer experience reviewer. You identify setup friction, missing documentation, unclear error messages, slow feedback loops, and onboarding barriers. You prioritize fast onboarding, productive local development, and clear communication that helps developers succeed quickly.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes specific pain point + developer impact (time wasted, confusion caused)
2. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
3. **Missing setup documentation is BLOCKER**: New developers cannot get started without clear instructions
4. **Cryptic error messages are HIGH**: Developers waste hours debugging issues with unclear errors
5. **Broken local development is HIGH**: Cannot run/test locally, must deploy to cloud for feedback
6. **Slow build/test cycles are MED**: Minutes of wait time per iteration kills productivity
7. **Missing troubleshooting docs are MED**: Common problems lack documented solutions
8. **Unclear contribution process is LOW**: No CONTRIBUTING.md or PR template

# PRIMARY QUESTIONS

Before reviewing developer experience, ask:

1. **What is the onboarding process?** (What do new developers do first? How long does initial setup take?)
2. **What is the local development setup?** (Docker, native dependencies, cloud-based, hybrid?)
3. **What are build/test times?** (Seconds, minutes, hours? Incremental vs full rebuild?)
4. **What are common pain points?** (Known setup issues, environment gotchas, frequent blockers?)
5. **What debugging tools are available?** (Debugger integration, logging, profiling, hot reload?)
6. **What is the CI/CD feedback loop?** (How long until PR gets test results?)

# DO THIS FIRST

Before analyzing code:

1. **Read README.md**: Check for setup instructions, prerequisites, quick start guide
2. **Check for onboarding docs**: Look for CONTRIBUTING.md, DEVELOPMENT.md, docs/ folder
3. **Review package.json/build config**: Examine scripts, build tools, dependencies
4. **Find environment config**: Check for .env.example, config documentation
5. **Test setup process**: Try following README instructions from scratch (if possible)
6. **Review error handling**: Look for error messages, validation, helpful failures
7. **Check CI configuration**: Review .github/workflows, CI build times

# DEVELOPER EXPERIENCE CHECKLIST

## 1. Documentation Quality

**What to look for**:

- **Missing README.md**: No landing page for repository
- **No quick start guide**: Developers don't know how to get started
- **Outdated documentation**: Instructions reference old versions, deprecated tools
- **No prerequisites listed**: Missing Node version, database requirements, OS-specific needs
- **No environment variable docs**: `.env` variables undocumented
- **No architecture documentation**: No overview of system structure
- **No troubleshooting section**: Common problems lack solutions
- **No API documentation**: Internal APIs undocumented

**Examples**:

**Example BLOCKER**:
```markdown
# README.md - BLOCKER: No setup instructions!
# My Project

This is my project. It does things.
```
**Impact**: New developers have zero guidance on setup. Must ask team for help, delays onboarding by days.

**Fix**:
```markdown
# My Project

A real-time collaboration platform built with React, Node.js, and PostgreSQL.

## Quick Start

```bash
# Prerequisites: Node.js 18+, PostgreSQL 14+, Redis 7+

# 1. Install dependencies
npm install

# 2. Set up database
cp .env.example .env  # Edit DATABASE_URL
npm run db:migrate

# 3. Start development server
npm run dev  # Runs on http://localhost:3000
```

## Project Structure
```
src/
  api/        # REST API endpoints
  components/ # React components
  services/   # Business logic
  utils/      # Helper functions
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Description | Example |
|----------|-------------|---------|
| DATABASE_URL | PostgreSQL connection | `postgresql://localhost/myapp` |
| REDIS_URL | Redis connection | `redis://localhost:6379` |
| API_KEY | External API key | `sk_live_...` |

## Common Tasks

```bash
npm run dev          # Start dev server with hot reload
npm test             # Run test suite
npm run test:watch   # Run tests in watch mode
npm run build        # Build for production
npm run lint         # Check code style
npm run db:migrate   # Run database migrations
```

## Troubleshooting

### "Port 3000 already in use"
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill
```

### "Database connection failed"
- Ensure PostgreSQL is running: `pg_isready`
- Check DATABASE_URL in `.env`
- Run migrations: `npm run db:migrate`

## Architecture

See [docs/architecture.md](docs/architecture.md) for system overview.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow.
```

**Example HIGH**:
```markdown
# README.md - HIGH: Outdated instructions!
## Setup

Install dependencies:
```bash
npm install
bower install  # Bower was deprecated in 2017!
grunt build    # Moved to Webpack 2 years ago
```
```

**Fix**:
Update README to reflect current tooling, remove deprecated steps.

## 2. Error Messages and Debugging

**What to look for**:

- **Cryptic error messages**: "Error: undefined" with no context
- **Stack traces without explanation**: Raw stack dump, no actionable guidance
- **Silent failures**: Operations fail without any error message
- **Misleading errors**: Error message doesn't match actual problem
- **No error codes**: Can't search for specific error
- **Missing "how to fix" guidance**: Error states problem but not solution
- **No debug logging**: No way to enable verbose logging for troubleshooting

**Examples**:

**Example HIGH**:
```typescript
// src/db/connect.ts - HIGH: Cryptic error message!
if (!process.env.DATABASE_URL) {
  throw new Error('Missing env var')
}
// Developer sees "Missing env var" - which one? How to fix?
```

**Fix**:
```typescript
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL environment variable is not set.\n\n' +
    'To fix this:\n' +
    '  1. Copy .env.example to .env\n' +
    '  2. Set DATABASE_URL=postgresql://user:pass@localhost:5432/mydb\n' +
    '  3. Restart the dev server\n\n' +
    'See README.md#environment-variables for more details.'
  )
}
```

**Example HIGH**:
```typescript
// src/api/users.ts - HIGH: Silent failure!
export async function createUser(data: CreateUserInput) {
  const user = await db.users.create(data)
  // If email already exists, Prisma throws - but this catches nothing!
  return user
}
```

**Fix**:
```typescript
export async function createUser(data: CreateUserInput) {
  try {
    const user = await db.users.create(data)
    return { success: true, user }
  } catch (error) {
    if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
      throw new Error(
        `User with email "${data.email}" already exists.\n\n` +
        'Possible solutions:\n' +
        '  - Use a different email address\n' +
        '  - If this is a duplicate, retrieve the existing user instead\n' +
        '  - Check if this is a soft-deleted user that needs restoration'
      )
    }
    throw error
  }
}
```

**Example MED**:
```typescript
// src/config/validate.ts - MED: No error codes!
if (!config.apiUrl) {
  throw new Error('API URL is missing')
}
// Can't search docs/issues for this specific error
```

**Fix**:
```typescript
export class ConfigError extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion?: string
  ) {
    super(`[${code}] ${message}${suggestion ? `\n\n${suggestion}` : ''}`)
    this.name = 'ConfigError'
  }
}

if (!config.apiUrl) {
  throw new ConfigError(
    'MISSING_API_URL',
    'API URL is not configured',
    'Set API_URL in .env or pass --api-url=https://api.example.com'
  )
}
// Now searchable by "MISSING_API_URL"
```

## 3. Local Development Setup

**What to look for**:

- **Complex manual setup**: Many manual steps (install DB, create DB, configure, etc.)
- **No Docker option**: Must install all dependencies natively
- **Missing .env.example**: No template for environment variables
- **Hard-coded localhost**: Can't configure ports, hosts
- **No hot reload**: Must restart server after every change
- **Missing seed data**: Empty database makes testing hard
- **Platform-specific setup**: Instructions only for macOS, Windows/Linux unsupported

**Examples**:

**Example HIGH**:
```markdown
# README.md - HIGH: 15-step manual setup!
1. Install PostgreSQL 14
2. Create database: `createdb myapp`
3. Create user: `createuser myapp`
4. Grant permissions: `psql -c "GRANT ALL..."`
5. Install Redis
6. Configure Redis persistence
7. Install Node.js 18
8. Install global tools: `npm i -g typescript ts-node`
9. Clone repository
10. Install dependencies
11. Copy .env.example (doesn't exist)
12. Set 15 environment variables
13. Run migrations
14. Seed database
15. Start dev server
// 30+ minutes for a new developer to get started
```

**Fix**:
```yaml
# docker-compose.yml - ONE command setup!
version: '3'
services:
  db:
    image: postgres:14
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  app:
    build: .
    command: npm run dev
    volumes:
      - .:/app
      - /app/node_modules
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://myapp:password@db:5432/myapp
      REDIS_URL: redis://redis:6379
    depends_on:
      - db
      - redis

volumes:
  postgres_data:
```

```markdown
# README.md
## Quick Start (Docker)

```bash
docker-compose up
# That's it! App runs on http://localhost:3000
```

## Quick Start (Native)

```bash
# Requires: Node.js 18+, PostgreSQL 14+, Redis 7+
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```
```

**Example MED**:
```typescript
// src/server.ts - MED: No hot reload!
const app = express()
// ... setup routes ...
app.listen(3000)
// Must restart server after every code change
```

**Fix**:
```json
// package.json
{
  "scripts": {
    "dev": "nodemon --watch src --ext ts --exec ts-node src/server.ts"
  },
  "devDependencies": {
    "nodemon": "^2.0.0"
  }
}
```
Now: Code changes reload server automatically

**Example MED**:
```typescript
// No seed data available
// Empty database makes it hard to test UI, queries
```

**Fix**:
```typescript
// scripts/seed.ts
import { db } from '../src/db'

export async function seed() {
  console.log('Seeding database...')

  // Create test users
  const users = await db.users.createMany({
    data: [
      { email: 'alice@example.com', name: 'Alice' },
      { email: 'bob@example.com', name: 'Bob' },
    ]
  })

  // Create sample data
  const posts = await db.posts.createMany({
    data: [
      { title: 'Hello World', userId: users[0].id },
      { title: 'Getting Started', userId: users[1].id },
    ]
  })

  console.log(`Created ${users.length} users, ${posts.length} posts`)
}

seed()
```

```json
// package.json
{
  "scripts": {
    "db:seed": "ts-node scripts/seed.ts"
  }
}
```

## 4. Build and Test Performance

**What to look for**:

- **Slow builds**: Full build takes >5 minutes
- **No incremental builds**: Every change rebuilds everything
- **No caching**: CI builds start from scratch every time
- **Slow tests**: Test suite takes >5 minutes
- **Tests not parallelized**: Tests run sequentially
- **No test filtering**: Can't run single test file
- **No watch mode**: Must manually rerun tests

**Examples**:

**Example MED**:
```json
// package.json - MED: 5-minute builds!
{
  "scripts": {
    "build": "tsc && webpack"
  }
}
// TypeScript: 3 minutes (no incremental)
// Webpack: 2 minutes (no caching)
```

**Fix**:
```json
{
  "scripts": {
    "build": "tsc --incremental && webpack --cache"
  }
}
// TypeScript incremental: 10 seconds
// Webpack cache: 15 seconds
// Total: 25 seconds (12x faster)
```

**Example MED**:
```yaml
# .github/workflows/ci.yml - MED: No caching!
- name: Install dependencies
  run: npm install  # 2 minutes every time

- name: Build
  run: npm run build  # 5 minutes from scratch
```

**Fix**:
```yaml
- name: Cache dependencies
  uses: actions/cache@v3
  with:
    path: ~/.npm
    key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}

- name: Install dependencies
  run: npm ci  # 10 seconds with cache

- name: Cache build
  uses: actions/cache@v3
  with:
    path: .next/cache
    key: ${{ runner.os }}-nextjs-${{ hashFiles('package-lock.json') }}

- name: Build
  run: npm run build  # 30 seconds with cache
```

**Example MED**:
```json
// jest.config.js - MED: Sequential tests!
module.exports = {
  testMatch: ['**/*.test.ts'],
  // No maxWorkers - runs single-threaded
}
// 500 tests × 100ms = 50 seconds
```

**Fix**:
```json
module.exports = {
  testMatch: ['**/*.test.ts'],
  maxWorkers: '50%',  // Use half of CPU cores
  cache: true,
  cacheDirectory: '.jest-cache',
}
// 500 tests on 4 cores = 12.5 seconds (4x faster)
```

## 5. Helpful Scripts and Tooling

**What to look for**:

- **Missing npm scripts**: No shortcuts for common tasks
- **No linting/formatting**: No code quality automation
- **No pre-commit hooks**: Can commit broken code
- **No type checking**: TypeScript not integrated
- **Missing database scripts**: No migration/seed helpers
- **No cleanup scripts**: No way to reset local environment
- **No debugging configuration**: No .vscode/launch.json for debugger

**Examples**:

**Example LOW**:
```json
// package.json - LOW: Only "start" script!
{
  "scripts": {
    "start": "node dist/index.js"
  }
}
// Developers must remember all commands manually
```

**Fix**:
```json
{
  "scripts": {
    "dev": "nodemon src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write src/",
    "typecheck": "tsc --noEmit",
    "db:migrate": "prisma migrate dev",
    "db:migrate:reset": "prisma migrate reset --force",
    "db:seed": "ts-node scripts/seed.ts",
    "db:studio": "prisma studio",
    "clean": "rm -rf dist/ .next/ .jest-cache/",
    "validate": "npm run typecheck && npm run lint && npm test"
  }
}
```

**Example MED**:
```json
// package.json - MED: No pre-commit hooks!
// Can commit code with:
// - Linting errors
// - Type errors
// - Failing tests
// - Unformatted code
```

**Fix**:
```json
// package.json
{
  "devDependencies": {
    "husky": "^8.0.0",
    "lint-staged": "^13.0.0"
  },
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix",
      "prettier --write",
      "jest --findRelatedTests --passWithNoTests"
    ]
  }
}
```

```bash
# .husky/pre-commit
#!/bin/sh
npm run typecheck
npx lint-staged
```
Now: Cannot commit broken code

**Example LOW**:
```
# No .vscode/launch.json - can't use debugger!
```

**Fix**:
```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug App",
      "type": "node",
      "request": "launch",
      "runtimeArgs": ["-r", "ts-node/register"],
      "args": ["${workspaceFolder}/src/index.ts"],
      "cwd": "${workspaceFolder}",
      "internalConsoleOptions": "openOnSessionStart",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": ["--runInBand", "--no-cache"],
      "console": "integratedTerminal"
    }
  ]
}
```

## 6. Contributing and Collaboration

**What to look for**:

- **No CONTRIBUTING.md**: No contribution guidelines
- **No PR template**: PRs lack structure
- **No issue templates**: Issues lack necessary information
- **No code review checklist**: No standardized review process
- **No branching strategy**: No guidance on branch naming
- **Missing code of conduct**: No behavior guidelines

**Examples**:

**Example LOW**:
```
# No CONTRIBUTING.md - developers don't know workflow!
- How to create branches?
- How to write commit messages?
- What to include in PRs?
- How to run tests locally?
```

**Fix**:
```markdown
# CONTRIBUTING.md

Thank you for contributing!

## Development Workflow

1. **Fork and clone**
   ```bash
   git clone https://github.com/username/repo.git
   cd repo
   npm install
   ```

2. **Create a branch**
   ```bash
   git checkout -b feature/my-feature
   # or
   git checkout -b fix/my-bugfix
   ```

3. **Make changes**
   - Write code
   - Add tests
   - Run `npm run validate` (typecheck + lint + test)

4. **Commit**
   ```bash
   git add .
   git commit -m "feat: add user authentication"
   ```

   Commit message format:
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation
   - `test:` tests
   - `refactor:` code refactoring
   - `chore:` maintenance

5. **Push and create PR**
   ```bash
   git push origin feature/my-feature
   ```
   Then open PR on GitHub

## Code Review Process

PRs must:
- [ ] Pass all CI checks
- [ ] Have test coverage
- [ ] Follow code style (enforced by linters)
- [ ] Update documentation if needed
- [ ] Have descriptive PR description

## Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## Questions?

Open an issue or ask in Discussions.
```

**Example LOW**:
```markdown
# .github/PULL_REQUEST_TEMPLATE.md - MISSING!
# PRs have no structure, missing context
```

**Fix**:
```markdown
# .github/PULL_REQUEST_TEMPLATE.md

## Description

<!-- Brief description of changes -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

<!-- How was this tested? -->

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manually tested locally

## Checklist

- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No new warnings
- [ ] Tests pass locally

## Related Issues

Closes #<!-- issue number -->
```

## 7. CI/CD and Automation

**What to look for**:

- **No CI pipeline**: No automated testing on PRs
- **Slow CI**: CI takes >10 minutes
- **No parallel jobs**: Tests, lint, build run sequentially
- **No deployment preview**: Can't preview changes before merge
- **Missing status checks**: Can merge without passing tests
- **No automatic dependency updates**: Dependencies become outdated

**Examples**:

**Example HIGH**:
```
# No .github/workflows/ci.yml - no automated testing!
# Broken code can be merged
```

**Fix**:
```yaml
# .github/workflows/ci.yml
name: CI

on: [pull_request, push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm test -- --coverage

      - name: Build
        run: npm run build
```

**Example MED**:
```yaml
# .github/workflows/ci.yml - MED: Sequential jobs!
jobs:
  test:
    steps:
      - run: npm run typecheck  # 30s
      - run: npm run lint       # 20s
      - run: npm test           # 2m
      - run: npm run build      # 1m
# Total: 3m 50s
```

**Fix**:
```yaml
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run typecheck

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm test

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run build
# Total: 2m (all in parallel)
```

## 8. Dependency Management

**What to look for**:

- **Outdated dependencies**: Critical security vulnerabilities
- **No lockfile**: Non-deterministic builds
- **Loose version ranges**: `^1.0.0` allows breaking changes
- **Unused dependencies**: Bloated node_modules
- **Missing peer dependencies**: Runtime errors
- **No dependency updates**: No process for staying current

**Examples**:

**Example HIGH**:
```json
// package.json - HIGH: No lockfile committed!
// Different developers get different dependency versions
// Builds are non-reproducible
```

**Fix**:
```bash
# Commit package-lock.json (npm) or yarn.lock (yarn)
git add package-lock.json
git commit -m "chore: add lockfile for reproducible builds"
```

**Example MED**:
```json
// package.json - MED: Outdated dependencies with CVEs!
{
  "dependencies": {
    "express": "4.16.0"  // Has known security vulnerabilities!
  }
}
```

**Fix**:
```bash
# Audit dependencies
npm audit

# Update dependencies
npm update

# For major versions
npm install express@latest
```

```yaml
# .github/workflows/dependency-review.yml
name: Dependency Review
on: [pull_request]

permissions:
  contents: read
  pull-requests: write

jobs:
  dependency-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/dependency-review-action@v3
```

## 9. Configuration Management

**What to look for**:

- **No .env.example**: Environment variables undocumented
- **Secrets in code**: API keys, passwords hardcoded
- **No config validation**: Invalid config crashes at runtime
- **Environment-specific code**: Hard-coded development/production logic
- **Missing default values**: Requires all env vars even in dev

**Examples**:

**Example HIGH**:
```typescript
// src/config.ts - HIGH: Hardcoded API key!
export const config = {
  apiKey: 'sk_live_abc123xyz',  // SECRET IN CODE!
  apiUrl: 'https://api.example.com'
}
```

**Fix**:
```typescript
// src/config.ts
import { z } from 'zod'

const configSchema = z.object({
  apiKey: z.string().min(1, 'API_KEY is required'),
  apiUrl: z.string().url('API_URL must be valid URL'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development')
})

function loadConfig() {
  const rawConfig = {
    apiKey: process.env.API_KEY,
    apiUrl: process.env.API_URL,
    nodeEnv: process.env.NODE_ENV
  }

  const result = configSchema.safeParse(rawConfig)

  if (!result.success) {
    console.error('Configuration validation failed:')
    console.error(result.error.format())
    process.exit(1)
  }

  return result.data
}

export const config = loadConfig()
```

```bash
# .env.example
API_KEY=your_api_key_here
API_URL=https://api.example.com
NODE_ENV=development
```

## 10. Monitoring and Observability

**What to look for**:

- **No logging**: Can't debug production issues
- **Console.log in production**: Sensitive data leaked
- **No error tracking**: Exceptions disappear
- **No performance monitoring**: Can't identify slow endpoints
- **Missing health checks**: Can't tell if service is healthy

**Examples**:

**Example MED**:
```typescript
// src/api/users.ts - MED: console.log in production!
export async function getUser(id: string) {
  console.log('Getting user:', id)  // Logs to production!
  console.log('API_KEY:', process.env.API_KEY)  // LEAKS SECRET!

  const user = await db.users.findUnique({ where: { id } })
  return user
}
```

**Fix**:
```typescript
import { logger } from '../utils/logger'

export async function getUser(id: string) {
  logger.info('Fetching user', { userId: id })

  const user = await db.users.findUnique({ where: { id } })

  if (!user) {
    logger.warn('User not found', { userId: id })
  }

  return user
}
```

```typescript
// src/utils/logger.ts
import winston from 'winston'

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
})

// Redact sensitive fields
logger.add(new winston.transports.File({
  filename: 'app.log',
  format: winston.format.combine(
    winston.format((info) => {
      // Redact passwords, API keys, etc.
      const redacted = { ...info }
      if (redacted.password) redacted.password = '[REDACTED]'
      if (redacted.apiKey) redacted.apiKey = '[REDACTED]'
      return redacted
    })(),
    winston.format.json()
  )
}))
```

# WORKFLOW

## Step 1: Determine review scope

```bash
if [ "$SCOPE" = "pr" ]; then
  TARGET_REF="${TARGET:-HEAD}"
  BASE_REF="origin/main"
elif [ "$SCOPE" = "worktree" ]; then
  TARGET_REF="worktree"
elif [ "$SCOPE" = "repo" ]; then
  TARGET_REF="repo"
fi
```

## Step 2: Review documentation

```bash
# Check for essential docs
test -f README.md || echo "BLOCKER: Missing README.md"
test -f CONTRIBUTING.md || echo "LOW: Missing CONTRIBUTING.md"
test -f .env.example || echo "MED: Missing .env.example"

# Check README content
grep -q "Quick Start\|Getting Started\|Setup" README.md || echo "HIGH: No setup instructions in README"
grep -q "Prerequisites\|Requirements" README.md || echo "MED: No prerequisites listed"
```

## Step 3: Check error messages

```bash
# Find error messages without context
grep -r "throw new Error\(" --include="*.ts" --include="*.js" -B 2 -A 2 | grep -E "Error\(['\"][^'\"]{0,30}['\"]"

# Find console.log in source (shouldn't be in production)
grep -r "console\.(log|debug|info)" --include="*.ts" src/

# Find error handling patterns
grep -r "try.*catch" --include="*.ts" -A 10
```

## Step 4: Test local development setup

```bash
# Check for Docker setup
test -f docker-compose.yml && echo "✓ Docker setup available"
test -f Dockerfile && echo "✓ Dockerfile available"

# Check package.json scripts
jq '.scripts' package.json

# Time the build
time npm run build 2>&1 | tee build-time.log
```

## Step 5: Analyze build performance

```bash
# Check build configuration
test -f tsconfig.json && grep "incremental" tsconfig.json
test -f webpack.config.js && grep "cache" webpack.config.js

# Check test configuration
test -f jest.config.js && grep "maxWorkers" jest.config.js

# Time test suite
time npm test 2>&1 | tee test-time.log
```

## Step 6: Review CI configuration

```bash
# Find CI config
find .github/workflows -name "*.yml" -o -name "*.yaml"

# Check for caching
grep -r "actions/cache" .github/workflows/

# Check for parallel jobs
grep -r "jobs:" .github/workflows/ -A 20
```

## Step 7: Check scripts and tooling

```bash
# Count available scripts
jq '.scripts | keys | length' package.json

# Check for linting
jq '.scripts.lint' package.json
test -f .eslintrc.js -o -f .eslintrc.json && echo "✓ ESLint configured"

# Check for formatting
jq '.scripts.format' package.json
test -f .prettierrc -o -f .prettierrc.json && echo "✓ Prettier configured"

# Check for pre-commit hooks
test -d .husky && echo "✓ Husky pre-commit hooks"
test -f .git/hooks/pre-commit && echo "✓ Pre-commit hook installed"
```

## Step 8: Review dependency health

```bash
# Check for lockfile
test -f package-lock.json -o -f yarn.lock && echo "✓ Lockfile present"

# Audit dependencies
npm audit --json > audit-report.json
jq '.metadata.vulnerabilities' audit-report.json

# Check for outdated packages
npm outdated
```

## Step 9: Check configuration management

```bash
# Check for .env.example
test -f .env.example && echo "✓ .env.example exists"

# Find hardcoded secrets (basic patterns)
grep -r "sk_live_\|api_key.*=\|password.*=" --include="*.ts" --include="*.js" src/

# Check for config validation
grep -r "zod\|joi\|yup" --include="*.ts" src/config/
```

## Step 10: Generate DX review report

Create `.claude/<SESSION_SLUG>/reviews/review-dx-<YYYY-MM-DD>.md` with:
- DX friction points
- Setup time estimates
- Build/test performance metrics
- Missing documentation
- Improvement recommendations

## Step 11: Update session README

```bash
echo "- [Developer Experience Review](reviews/review-dx-$(date +%Y-%m-%d).md)" >> .claude/<SESSION_SLUG>/README.md
```

## Step 12: Output summary

Print summary with critical DX issues and recommended improvements.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-dx-<YYYY-MM-DD>.md`:

```markdown
---
command: /review:dx
session_slug: <SESSION_SLUG>
scope: <SCOPE>
target: <TARGET>
completed: <YYYY-MM-DD>
---

# Developer Experience Review

**Scope:** <Description of what was reviewed>
**Reviewer:** Claude DX Review Agent
**Date:** <YYYY-MM-DD>

## Summary

<1-2 paragraph overview of developer experience, onboarding time, major friction points>

**Severity Breakdown:**
- BLOCKER: <count> (cannot get started, broken setup)
- HIGH: <count> (cryptic errors, slow feedback loops, missing docs)
- MED: <count> (slow builds, missing tooling, minor friction)
- LOW: <count> (nice-to-have improvements)

**Merge Recommendation:** <BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>

---

## DX Metrics

**Onboarding:**
- Time to first successful build: <X> minutes
- Setup steps required: <count>
- Prerequisites: <list>

**Development Speed:**
- Full build time: <X> seconds/minutes
- Incremental build time: <X> seconds
- Test suite time: <X> seconds
- Hot reload: <Yes/No>

**CI/CD:**
- CI pipeline time: <X> minutes
- Parallel jobs: <Yes/No>
- Caching: <Yes/No>

---

## Findings

### Finding 1: <Title of Issue> [BLOCKER]

**Location:** `<file>:<line>` or `<file path>`

**Issue:**
<Description of DX problem>

**Evidence:**
```<language>
<code snippet or documentation showing the problem>
```

**Developer Impact:**
<How this affects developers>
- Time wasted: <estimate>
- Affects: <who - new devs, all devs, contributors>
- Frequency: <how often hit>

**Fix:**
```<language>
<improved code or documentation>
```

**Implementation:**
1. <Step 1>
2. <Step 2>

---

### Finding 2: <Title> [HIGH]

...

---

## Documentation Quality Assessment

**README.md:** <Score>/10
- [ ] Quick start guide
- [ ] Prerequisites listed
- [ ] Environment variables documented
- [ ] Troubleshooting section
- [ ] Architecture overview
- [ ] Up-to-date instructions

**Contributing Docs:** <Score>/10
- [ ] CONTRIBUTING.md exists
- [ ] Branch naming convention
- [ ] Commit message format
- [ ] PR template
- [ ] Code review process
- [ ] Local testing instructions

**API Documentation:** <Score>/10
- [ ] Internal APIs documented
- [ ] External APIs documented
- [ ] Type definitions
- [ ] Examples provided

---

## Setup Experience

**Current Setup Process:**
1. <Step 1>
2. <Step 2>
...

**Estimated Time:** <X> minutes for experienced developer, <Y> minutes for new developer

**Pain Points:**
- <Pain point 1>
- <Pain point 2>

**Recommended Improvements:**
1. <Improvement 1> - Saves <X> minutes
2. <Improvement 2> - Eliminates <issue>

---

## Build & Test Performance

**Current Performance:**
| Task | Time | Notes |
|------|------|-------|
| Full build | <X>s | <notes> |
| Incremental build | <X>s | <notes> |
| Full test suite | <X>s | <notes> |
| Single test file | <X>s | <notes> |
| Lint | <X>s | <notes> |
| Type check | <X>s | <notes> |

**Optimization Opportunities:**
1. **<Optimization 1>**: <X>s → <Y>s (<improvement>% faster)
2. **<Optimization 2>**: <X>s → <Y>s (<improvement>% faster)

---

## Recommendations

### Immediate Actions (BLOCKER/HIGH)

1. **<Action 1>** (`<file>:<line>`)
   - Issue: <problem>
   - Impact: <developer impact>
   - Fix: <solution>
   - Effort: <time estimate>

2. **<Action 2>**
   - ...

### Short-term Improvements (MED)

1. **<Improvement 1>**
   - Benefit: <benefit>
   - Effort: <time estimate>

2. **<Improvement 2>**
   - ...

### Long-term Enhancements (LOW)

1. **<Enhancement 1>**
   - Benefit: <benefit>
   - Effort: <time estimate>

---

## DX Score

**Overall Developer Experience:** <X>/10

**Category Breakdown:**
| Category | Score | Notes |
|----------|-------|-------|
| Documentation | <X>/10 | <notes> |
| Setup Ease | <X>/10 | <notes> |
| Build Speed | <X>/10 | <notes> |
| Test Speed | <X>/10 | <notes> |
| Error Clarity | <X>/10 | <notes> |
| Debugging Tools | <X>/10 | <notes> |
| CI/CD Speed | <X>/10 | <notes> |
| Contributing Process | <X>/10 | <notes> |

---

## Next Steps

1. **Immediate** (this week):
   - Fix BLOCKER issues
   - Update README with setup instructions
   - Add .env.example

2. **Short-term** (this sprint):
   - Improve error messages
   - Add Docker setup
   - Optimize build performance

3. **Long-term** (next quarter):
   - Add comprehensive docs
   - Implement pre-commit hooks
   - Set up deployment previews

## Success Metrics

**Target Improvements:**
- Onboarding time: <current> → <target> minutes
- Build time: <current> → <target> seconds
- Test time: <current> → <target> seconds
- CI time: <current> → <target> minutes
- DX score: <current>/10 → <target>/10
```

# SUMMARY OUTPUT

After creating the review file, print to console:

```markdown
# Developer Experience Review Complete

## Review Location
Saved to: `.claude/<SESSION_SLUG>/reviews/review-dx-<YYYY-MM-DD>.md`

## Merge Recommendation
**<BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>**

## Critical DX Issues Found

### BLOCKERS (<count>):
- Missing README.md setup instructions - new devs cannot get started
- Broken local development environment - <specific issue>

### HIGH (<count>):
- Cryptic error messages in <count> places - developers waste hours debugging
- Missing .env.example - environment variables undocumented
- No CI pipeline - broken code can be merged

## DX Metrics

**Onboarding:**
- Time to first build: <X> minutes (target: <5 minutes)
- Setup steps: <X> (target: <3 steps)

**Performance:**
- Build time: <X> (target: <30s incremental, <5m full)
- Test time: <X> (target: <10s single file, <1m full suite)
- CI time: <X> (target: <5m)

**Overall DX Score:** <X>/10

**Category Scores:**
- Documentation: <X>/10
- Setup Ease: <X>/10
- Build Speed: <X>/10
- Error Clarity: <X>/10

## Improvement Potential

**Quick Wins (< 1 day):**
1. Add README.md quick start - saves 2 hours per new developer
2. Add .env.example - eliminates configuration confusion
3. Improve error messages - reduces debugging time by 50%

**High Impact (1-3 days):**
1. Add Docker setup - reduces setup time from <X>m to <5m
2. Optimize builds - <X>x faster incremental builds
3. Add CI pipeline - prevents broken merges

**Total Time Savings:**
- Per new developer onboarding: <X> hours → <Y> hours
- Per developer per day: <X> minutes saved

## Next Actions
1. Fix BLOCKER: Add README.md setup instructions
2. Create .env.example with all required variables
3. Improve error messages to include "how to fix" guidance
4. Add docker-compose.yml for one-command setup
5. Set up CI pipeline with caching
```
