---
name: write-docs
description: Generate comprehensive user-facing documentation from codebase analysis and docs review
args:
  SESSION_SLUG:
    description: The session identifier. If not provided, uses the most recent session from .claude/README.md
    required: false
  AUDIENCE:
    description: Primary audience for documentation
    required: false
    choices: [developers, end-users, operators, contributors]
  SCOPE:
    description: What to document
    required: false
    choices: [full, readme-only, api-only, guides-only]
  UPDATE_EXISTING:
    description: Update existing docs (true) or create new (false)
    required: false
---

# ROLE
You are a technical documentation writer. You analyze codebases and generate clear, accurate, user-facing documentation that helps readers accomplish tasks.

# PHILOSOPHY

**Documentation is for readers who didn't write the code.**

Key principles:
1. **Task-oriented**: Help users accomplish goals, not just describe code
2. **Examples first**: Show working examples before explaining details
3. **Progressive disclosure**: Start simple, add complexity gradually
4. **Accurate**: Docs must match actual code behavior
5. **Complete**: Cover setup, usage, configuration, errors, troubleshooting
6. **Maintainable**: Docs should be easy to keep up-to-date

# WORKFLOW

## Step 0: Infer SESSION_SLUG if not provided

Standard session inference from `.claude/README.md` (last entry).

## Step 1: Load session context

1. Validate `.claude/<SESSION_SLUG>/` exists
2. Read `.claude/<SESSION_SLUG>/README.md` for context
3. Check spec for user-facing features
4. Check plan for architecture and design decisions
5. Check work log for what was implemented
6. **Check for docs review**: Read latest `reviews/review-docs-*.md` if exists

## Step 2: Determine documentation scope

From AUDIENCE, SCOPE, and context:

1. **AUDIENCE** (if not provided):
   - From spec: Look for "user persona" or "target users"
   - From work type:
     - `new_feature` → developers (library/API users)
     - `greenfield_app` → end-users (application users)
   - Default: developers

2. **SCOPE** (if not provided):
   - From docs review: Focus on gaps identified
   - From work log: Document what was built
   - Default: full

3. **UPDATE_EXISTING** (if not provided):
   - If README.md exists: true (update)
   - If no README.md: false (create new)

## Step 3: Analyze existing documentation

1. **Find existing docs**:
   - README.md
   - docs/**/*.md
   - CHANGELOG.md
   - API.md / api-docs/
   - examples/

2. **Read docs review** (if exists):
   - What's missing? (coverage gaps)
   - What's wrong? (accuracy issues)
   - What examples need fixing?
   - What sections need updating?

3. **Assess documentation structure**:
   - What sections exist?
   - What style/tone?
   - What level of detail?
   - What examples exist?

## Step 4: Analyze codebase

### 4.1: Identify Project Type

Determine what kind of project this is:

**Indicators:**
- `package.json` with `"main"` → Library/package
- `app.py` / `main.py` → Application
- `src/server.ts` → Server/API
- `src/components/` → Frontend app
- `cmd/` (Go) → CLI tool
- `Cargo.toml` with `[[bin]]` → CLI tool

**Project types:**
- **Library**: Provides functions/classes for other code
- **CLI tool**: Command-line application
- **Web API**: HTTP server with REST/GraphQL endpoints
- **Web app**: Frontend application (React, Vue, etc.)
- **Full-stack app**: Frontend + backend
- **Script/tool**: Utility script

### 4.2: Identify Public API

**For libraries:**
- Read `package.json` → `"main"`, `"exports"`
- Read `__init__.py` → exported names
- Read `lib.rs` / `mod.rs` → public modules
- Scan for `export` keyword (TS/JS)
- Scan for public classes/functions

**For CLI tools:**
- Read command definitions (Click, Commander, Cobra)
- Read `--help` output
- Scan for subcommands

**For APIs:**
- Scan for route definitions (`app.get()`, `@app.route()`)
- Read OpenAPI/Swagger specs if exists
- Scan for controller methods

**For web apps:**
- Read feature descriptions from spec
- Identify user-facing pages/components
- Read environment variables

### 4.3: Extract Configuration

**Environment variables:**
```bash
grep -r "process.env\." src/
grep -r "os.getenv\(" src/
grep -r "env::var\(" src/
```

**Config files:**
- `.env.example`
- `config/*.yaml`
- `settings.py`
- Configuration classes/objects

**Extract for each config:**
- Name
- Default value (if any)
- Required or optional
- Purpose (from comments or context)
- Type (string, number, boolean)

### 4.4: Extract Examples from Tests

Tests are excellent documentation sources:

**Read test files:**
- `tests/**/*.test.ts`
- `test_*.py`
- `*_test.go`

**Extract:**
- Function usage examples
- API request/response examples
- Common use cases
- Error handling patterns

### 4.5: Identify Key Features

**From spec** (if exists):
- Read acceptance criteria
- Extract user-facing features
- Identify main use cases

**From code:**
- Main entry points (exported functions, routes)
- Key classes/modules
- Core workflows

### 4.6: Identify Error Handling

**Error classes:**
```bash
grep -r "class.*Error" src/
grep -r "raise.*Error" src/
```

**Error codes:**
- HTTP status codes (400, 404, 500)
- Custom error codes
- Error messages

**Extract:**
- Error types
- When they occur
- How to handle them

## Step 5: Determine documentation structure

Based on project type and analysis:

**For Libraries:**
```
README.md
  - Installation
  - Quick Start
  - API Reference (brief)
  - Examples
  - Configuration
docs/
  - api.md (detailed API reference)
  - examples.md (comprehensive examples)
  - errors.md (error handling)
  - advanced.md (advanced usage)
```

**For CLI Tools:**
```
README.md
  - Installation
  - Quick Start
  - Commands Reference
  - Examples
  - Configuration
docs/
  - commands.md (detailed command reference)
  - examples.md (common workflows)
  - configuration.md
```

**For APIs:**
```
README.md
  - Getting Started
  - Quick Start
  - API Overview
  - Authentication
docs/
  - api.md (endpoint reference)
  - authentication.md
  - errors.md
  - examples.md (request/response examples)
```

**For Web Apps:**
```
README.md
  - Installation
  - Quick Start
  - Configuration
  - Deployment
docs/
  - setup.md (detailed setup)
  - configuration.md
  - deployment.md
  - troubleshooting.md
```

## Step 6: Generate documentation content

### 6.1: Generate README.md

**Sections to include** (adapt based on project type):

1. **Title and Description**
   - Project name
   - One-line description (what it does)
   - Badges (build status, coverage, version)

2. **Features** (3-5 key features)
   - Bullet list
   - User benefits, not technical details

3. **Installation**
   - Prerequisites (Node.js version, Python version, etc.)
   - Install command (`npm install`, `pip install`)
   - Quick verification

4. **Quick Start**
   - Minimal working example (5-10 lines)
   - Copy-pasteable
   - Covers most common use case

5. **Usage** (brief examples)
   - 2-3 common scenarios
   - Code examples with explanations
   - Link to detailed docs

6. **Configuration** (if applicable)
   - Environment variables
   - Config files
   - Common settings

7. **API Reference** (brief, for libraries)
   - Main functions/classes
   - Link to detailed API docs

8. **Examples** (links)
   - Link to examples/ directory
   - Link to docs/examples.md

9. **Documentation**
   - Link to docs/ directory
   - Link to API docs
   - Link to guides

10. **Contributing**
    - Link to CONTRIBUTING.md
    - Brief guidelines

11. **License**
    - License type
    - Link to LICENSE file

### 6.2: Generate docs/api.md (for libraries/APIs)

**Structure:**

```markdown
# API Reference

## Functions

### `functionName(param1, param2)`

Description of what the function does.

**Parameters:**
- `param1` (Type) - Description
- `param2` (Type, optional) - Description, default: value

**Returns:**
- Type - Description

**Throws:**
- ErrorType - When this error occurs

**Example:**
\`\`\`typescript
const result = functionName('value', { option: true });
// Result: ...
\`\`\`

## Classes

### `ClassName`

Description of the class.

#### Constructor

\`\`\`typescript
new ClassName(options)
\`\`\`

**Parameters:**
- `options` (object) - Configuration options

#### Methods

##### `.methodName(param)`

Description of method.

**Example:**
\`\`\`typescript
const instance = new ClassName({ opt: 'value' });
instance.methodName('param');
\`\`\`
```

### 6.3: Generate docs/configuration.md

**Structure:**

```markdown
# Configuration

## Environment Variables

### `VARIABLE_NAME`

Description of what this controls.

- **Required:** Yes/No
- **Default:** `value` (or "none")
- **Type:** string | number | boolean
- **Example:** `VARIABLE_NAME=production`

**Common values:**
- `development` - Development mode
- `production` - Production mode

**Gotchas:**
- Note about edge cases or common mistakes

## Config Files

### `config/app.yaml`

Example configuration file:

\`\`\`yaml
key: value
nested:
  key: value
\`\`\`

**Options:**
- `key` - Description
- `nested.key` - Description
```

### 6.4: Generate docs/examples.md

**Structure:**

```markdown
# Examples

## Basic Example

Description of what this example demonstrates.

\`\`\`typescript
// Complete, runnable example
import { func } from './lib';

const result = await func('input');
console.log(result);
\`\`\`

**Output:**
\`\`\`
result output
\`\`\`

## Advanced Example

More complex scenario.

\`\`\`typescript
// Multi-step example with error handling
try {
  const step1 = await func1();
  const step2 = await func2(step1);
  return step2;
} catch (error) {
  console.error('Error:', error);
}
\`\`\`
```

### 6.5: Generate docs/errors.md

**Structure:**

```markdown
# Error Handling

## Error Types

### `ErrorType`

When this error occurs and what to do.

**Example:**
\`\`\`typescript
try {
  await operation();
} catch (error) {
  if (error instanceof ErrorType) {
    // Handle this specific error
  }
}
\`\`\`

## Error Codes

| Code | Message | Cause | Solution |
|------|---------|-------|----------|
| `ERR_001` | "Description" | What causes this | How to fix |
```

### 6.6: Generate docs/troubleshooting.md

**Structure:**

```markdown
# Troubleshooting

## Common Issues

### Issue: Description of problem

**Symptoms:**
- What user sees

**Cause:**
- Why this happens

**Solution:**
\`\`\`bash
# Steps to fix
command1
command2
\`\`\`

### Issue: Another problem

...
```

## Step 7: Generate examples

For each major feature:

1. **Create example file** (if examples/ directory)
   - `examples/basic-usage.js`
   - `examples/with-error-handling.js`
   - `examples/advanced-config.js`

2. **Make examples complete**:
   - Include all imports
   - Include all setup
   - Add comments explaining each step
   - Show expected output

3. **Verify examples work**:
   - If possible, run examples
   - Check syntax
   - Verify against actual API

## Step 8: Update CHANGELOG.md

If CHANGELOG.md exists:

**Add new entry:**

```markdown
## [Unreleased]

### Added
- New feature: description
- Documentation: comprehensive user guides

### Changed
- Improved: description

### Fixed
- Bug: description

### Breaking Changes
- Change: description
  - Migration: how to adapt
```

## Step 9: Write documentation files

For each documentation file to create/update:

1. **Check if file exists**:
   - If UPDATE_EXISTING=true and file exists: Read existing
   - If UPDATE_EXISTING=false or file missing: Create new

2. **Preserve existing content** (if updating):
   - Keep custom sections
   - Keep manual edits
   - Update generated sections only

3. **Write file**:
   - Use Write tool for new files
   - Use Edit tool for updates
   - Maintain consistent formatting

4. **Add frontmatter** (if using):
   ```yaml
   ---
   generated_by: /write-docs
   session_slug: {SESSION_SLUG}
   date: {YYYY-MM-DD}
   audience: {AUDIENCE}
   ---
   ```

## Step 10: Create documentation manifest

Create `.claude/<SESSION_SLUG>/docs/manifest.md`:

```markdown
---
command: /write-docs
session_slug: {SESSION_SLUG}
date: {YYYY-MM-DD}
audience: {AUDIENCE}
scope: {SCOPE}
---

# Documentation Manifest

This file tracks generated documentation.

## Files Created/Updated

- [ ] README.md - Updated
- [x] docs/api.md - Created
- [x] docs/examples.md - Created
- [ ] docs/configuration.md - Updated
- [x] docs/errors.md - Created
- [ ] CHANGELOG.md - Updated

## Coverage

**Documented:**
- Public API: {X} functions, {Y} classes
- Endpoints: {X} routes
- Configuration: {X} env vars, {Y} config keys
- Examples: {X} working examples
- Errors: {X} error types

## Sources

**Analysis:**
- Codebase: {file count} files analyzed
- Tests: {test count} tests analyzed
- Spec: {yes/no}
- Docs review: {yes/no}

**Documentation structure:**
Based on project type: {library | cli | api | webapp}

## Next Steps

**Recommended additions:**
- Add architecture diagram for complex flows
- Add more examples for {feature}
- Add troubleshooting section for {common issue}

**Maintenance:**
- Keep examples in sync with code
- Update CHANGELOG on releases
- Review docs on API changes
```

## Step 11: Update session README

Add to session README:
- Documentation generated
- Files created/updated
- Link to manifest

## Step 12: Output summary

Print summary of generated docs.

# DOCUMENTATION TEMPLATES

## README Template (Library)

```markdown
# {Project Name}

> {One-line description of what this does}

[![Build Status](badge-url)](link)
[![npm version](badge-url)](link)

## Features

- ✨ **Feature 1**: Brief benefit
- 🚀 **Feature 2**: Brief benefit
- 🔒 **Feature 3**: Brief benefit
- 📦 **Feature 4**: Brief benefit

## Installation

**Prerequisites:**
- Node.js >= 18.0.0
- npm >= 9.0.0

**Install:**

\`\`\`bash
npm install {package-name}
\`\`\`

## Quick Start

\`\`\`javascript
import { mainFunction } from '{package-name}';

// Minimal working example
const result = await mainFunction({
  option1: 'value',
  option2: true
});

console.log(result);
// Output: { success: true, data: {...} }
\`\`\`

## Usage

### Basic Example

\`\`\`javascript
// Common use case
const result = await mainFunction('input');
\`\`\`

### With Error Handling

\`\`\`javascript
try {
  const result = await mainFunction('input');
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Invalid input:', error.message);
  }
}
\`\`\`

### Advanced Configuration

\`\`\`javascript
const result = await mainFunction({
  input: 'value',
  options: {
    maxSize: 1024,
    format: 'json'
  }
});
\`\`\`

## API Reference

See [API Documentation](docs/api.md) for complete reference.

**Main Functions:**

- [`mainFunction(input, options)`](docs/api.md#mainfunction) - Primary function
- [`helperFunction(param)`](docs/api.md#helperfunction) - Utility function

## Configuration

Configure via environment variables:

\`\`\`bash
export MAX_SIZE=10485760  # 10MB
export LOG_LEVEL=info
\`\`\`

See [Configuration Guide](docs/configuration.md) for all options.

## Examples

Check out [examples/](examples/) for complete, runnable examples:

- [Basic usage](examples/basic-usage.js)
- [Error handling](examples/error-handling.js)
- [Advanced config](examples/advanced-config.js)

## Documentation

- [API Reference](docs/api.md) - Complete API documentation
- [Examples](docs/examples.md) - Detailed examples
- [Configuration](docs/configuration.md) - Configuration options
- [Error Handling](docs/errors.md) - Error types and handling
- [Troubleshooting](docs/troubleshooting.md) - Common issues

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT © [Author Name]
```

## README Template (CLI Tool)

```markdown
# {Tool Name}

> {One-line description of what this tool does}

## Installation

\`\`\`bash
npm install -g {tool-name}
# or
cargo install {tool-name}
\`\`\`

## Quick Start

\`\`\`bash
# Basic usage
{tool-name} command argument

# Example
{tool-name} process data.csv --output result.json
\`\`\`

## Commands

### `{tool-name} command`

Description of command.

\`\`\`bash
{tool-name} command [options] <arguments>
\`\`\`

**Options:**
- `--option` - Description
- `--flag` - Description

**Example:**
\`\`\`bash
{tool-name} command --option value file.txt
\`\`\`

## Configuration

Configuration file: `~/.{tool-name}/config.yaml`

\`\`\`yaml
key: value
\`\`\`

See [Configuration Guide](docs/configuration.md).

## Documentation

- [Commands Reference](docs/commands.md) - All commands and options
- [Examples](docs/examples.md) - Common workflows
- [Configuration](docs/configuration.md) - Config options

## License

MIT © [Author Name]
```

## README Template (API)

```markdown
# {API Name}

> {One-line description of what this API does}

## Features

- 🚀 RESTful API with {X} endpoints
- 🔒 JWT authentication
- 📝 OpenAPI/Swagger docs
- ⚡ Rate limiting

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- PostgreSQL >= 14
- Redis (optional, for caching)

### Installation

\`\`\`bash
git clone https://github.com/user/{api-name}.git
cd {api-name}
npm install
\`\`\`

### Configuration

Create `.env` file:

\`\`\`bash
DATABASE_URL=postgresql://localhost/dbname
JWT_SECRET=your-secret-key
PORT=3000
\`\`\`

### Running

\`\`\`bash
# Development
npm run dev

# Production
npm start
\`\`\`

Server starts at `http://localhost:3000`

## Quick Start

### Authentication

\`\`\`bash
# Get access token
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password"}'

# Response
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
\`\`\`

### Making Requests

\`\`\`bash
# Use token in requests
curl -X GET http://localhost:3000/api/users \
  -H "Authorization: Bearer {token}"
\`\`\`

## API Reference

See [API Documentation](docs/api.md) for complete endpoint reference.

**Main Endpoints:**

- `POST /auth/login` - Authenticate user
- `GET /api/users` - List users
- `POST /api/users` - Create user
- `GET /api/users/:id` - Get user by ID

**Base URL:** `http://localhost:3000`

**Authentication:** Bearer token in `Authorization` header

## Documentation

- [API Reference](docs/api.md) - Complete endpoint documentation
- [Authentication](docs/authentication.md) - Auth setup and usage
- [Errors](docs/errors.md) - Error codes and handling
- [Examples](docs/examples.md) - Request/response examples

## Deployment

See [Deployment Guide](docs/deployment.md) for production setup.

## License

MIT © [Author Name]
```

# OUTPUT SUMMARY

After generating docs, print:

```markdown
# Documentation Generated

## Files Created/Updated

**Core Documentation:**
- ✅ README.md - {Created | Updated}
- ✅ CHANGELOG.md - {Created | Updated}

**Detailed Documentation:**
- ✅ docs/api.md - {Created | Updated}
- ✅ docs/examples.md - {Created | Updated}
- ✅ docs/configuration.md - {Created | Updated}
- ✅ docs/errors.md - {Created | Updated}
- ✅ docs/troubleshooting.md - {Created | Updated} (if applicable)

**Examples:**
- ✅ examples/basic-usage.{ext} - Created
- ✅ examples/error-handling.{ext} - Created
- ✅ examples/advanced-config.{ext} - Created

## Coverage

**Documented:**
- Public API: {X} functions, {Y} classes
- Endpoints: {X} routes (if API)
- Configuration: {X} env vars, {Y} config keys
- Examples: {X} working examples
- Error types: {X} documented

**Based on:**
- Project type: {library | cli | api | webapp}
- Audience: {developers | end-users | operators}
- Codebase analysis: {X} source files
- Test analysis: {X} test files
- Docs review: {yes/no}

## Documentation Structure

\`\`\`
{project-root}/
├── README.md              # Main documentation
├── CHANGELOG.md           # Version history
├── docs/
│   ├── api.md            # API reference
│   ├── examples.md       # Detailed examples
│   ├── configuration.md  # Config options
│   ├── errors.md         # Error handling
│   └── troubleshooting.md
└── examples/
    ├── basic-usage.{ext}
    ├── error-handling.{ext}
    └── advanced-config.{ext}
\`\`\`

## Next Steps

**Recommended:**
1. Review generated documentation for accuracy
2. Verify examples are runnable
3. Add project-specific sections to README
4. Add architecture diagram (if complex)
5. Set up doc site (Docusaurus, VitePress, etc.) (optional)

**Maintenance:**
- Run `/review:docs` before releases
- Update examples when API changes
- Keep CHANGELOG current
- Re-run `/write-docs` after major changes

## Documentation Manifest

Detailed information saved to:
`.claude/{SESSION_SLUG}/docs/manifest.md`
```

# IMPORTANT: Accuracy and Quality

Generated documentation must be:

1. **Accurate**: Match actual code behavior
2. **Complete**: Cover all public APIs and key features
3. **Tested**: Examples should be verified to work
4. **Consistent**: Terminology matches code
5. **Clear**: Written for target audience
6. **Maintainable**: Easy to update when code changes

**Verification checklist:**
- [ ] All function signatures match actual code
- [ ] All config options exist in code
- [ ] All examples use correct API
- [ ] All error codes match actual errors
- [ ] All links work (internal and external)
- [ ] Terminology consistent throughout

# WHEN TO USE

Run `/write-docs` when:
- Starting new project (generate initial docs)
- After major feature additions (update docs)
- Before releases (ensure docs current)
- After `/review:docs` identifies gaps (fill gaps)
- When refactoring (update changed APIs)

This command should be run after implementation is complete and tested.
