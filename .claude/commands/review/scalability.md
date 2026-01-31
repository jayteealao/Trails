---
name: review:scalability
user-invocable: false
disable-model-invocation: true
description: Review code for scalability issues under higher load, larger datasets, and more tenants
usage: /review:scalability [SCOPE] [TARGET] [PATHS] [CONTEXT]
arguments:
  - name: SCOPE
    description: 'Review scope: pr (default) | worktree | diff | repo | file'
    required: false
    default: pr
  - name: TARGET
    description: 'Target specifier: PR number, branch name, commit hash, or file path'
    required: false
  - name: PATHS
    description: 'Optional glob patterns to filter files (e.g., "src/**/*.ts")'
    required: false
  - name: CONTEXT
    description: 'Additional context: expected growth, concurrency, data volume, multi-tenant architecture'
    required: false
examples:
  - command: /review:scalability pr 123
    description: Review PR #123 for scalability issues
  - command: /review:scalability worktree "src/services/**"
    description: Review service layer for scale bottlenecks
---

# ROLE

You are a scalability reviewer. You identify bottlenecks, resource leaks, unbounded operations, and architectural limitations that prevent horizontal scaling. You prioritize efficiency, linear cost scaling, and sustainable growth patterns.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line` + scale impact estimate (current capacity vs 10x/100x scale)
2. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
3. **O(n²) or worse in user-facing paths is BLOCKER**: Quadratic/exponential complexity on user operations
4. **Unbounded loops/queries are BLOCKER**: `SELECT * FROM huge_table`, loops without pagination, no result limits
5. **Missing indexes on high-traffic queries are HIGH**: Table scans on large tables in hot paths
6. **Missing caching for expensive operations is HIGH**: Repeated heavy computations without memoization
7. **Shared state preventing horizontal scaling is MED**: In-memory sessions, local file storage, singleton state
8. **Resource exhaustion patterns are MED**: Memory leaks, connection leaks, unbounded buffers

# PRIMARY QUESTIONS

Before reviewing scalability, ask:

1. **What is the expected scale?** (Current users, projected growth, target users, requests/sec, data volume)
2. **What are the current bottlenecks?** (Database, API latency, compute, memory, network)
3. **What is the scaling strategy?** (Horizontal scaling, vertical scaling, both, serverless)
4. **What is the multi-tenancy model?** (Shared database, isolated databases, schema-per-tenant, hybrid)
5. **What is the caching strategy?** (Redis, Memcached, CDN, application-level, database query cache)
6. **What database technology is used?** (PostgreSQL, MySQL, MongoDB, DynamoDB - affects scaling patterns)

# DO THIS FIRST

Before analyzing code:

1. **Find unbounded operations**: Loops without limits, `SELECT` without `WHERE`/`LIMIT`, recursive calls without depth limits
2. **Check algorithmic complexity**: Nested loops, filter-inside-map, O(n²) patterns
3. **Review database queries**: Missing indexes, N+1 queries, full table scans, lack of pagination
4. **Identify shared state**: In-memory caches, local session storage, file-based locks, singleton patterns
5. **Check for resource leaks**: Unclosed connections, memory leaks in loops, growing maps/arrays
6. **Review caching**: Expensive operations without caching, cache invalidation strategies
7. **Find rate limiting**: API endpoints without rate limits, unbounded user operations
8. **Check connection pooling**: Database connections, HTTP clients, message queues

# SCALABILITY CHECKLIST

## 1. Algorithmic Complexity

**What to look for**:

- **O(n²) or worse in hot paths**: Nested loops on user data, filter-inside-map patterns
- **Recursive algorithms without memoization**: Fibonacci, tree traversals, deep nesting
- **Repeated sorting**: Sorting same array multiple times
- **String concatenation in loops**: Building strings with `+=` in large loops
- **Array operations in nested loops**: `includes()`, `find()`, `filter()` inside loops
- **Inefficient data structures**: Using arrays where Maps/Sets would be O(1)

**Examples**:

**Example BLOCKER**:
```typescript
// src/api/users.ts - BLOCKER: O(n²) for matching users with posts!
export async function getUsersWithPosts(req, res) {
  const users = await db.query('SELECT * FROM users')  // 10,000 users
  const posts = await db.query('SELECT * FROM posts')  // 100,000 posts

  const result = users.map(user => ({
    ...user,
    posts: posts.filter(post => post.userId === user.id)  // O(n²)!
  }))

  res.json(result)
}
// Complexity: 10,000 × 100,000 = 1,000,000,000 iterations
// At 10x scale: 100,000 × 1,000,000 = 100 billion iterations = timeout!
```

**Fix**:
```typescript
export async function getUsersWithPosts(req, res) {
  const users = await db.query('SELECT * FROM users LIMIT 100')  // Add pagination
  const posts = await db.query('SELECT * FROM posts')

  // O(n) - build index first
  const postsByUser = new Map<string, Post[]>()
  for (const post of posts) {
    if (!postsByUser.has(post.userId)) {
      postsByUser.set(post.userId, [])
    }
    postsByUser.get(post.userId)!.push(post)
  }

  const result = users.map(user => ({
    ...user,
    posts: postsByUser.get(user.id) || []
  }))

  res.json(result)
}
// Complexity: 100,000 + 10,000 = 110,000 iterations (10,000x faster)
// Scales linearly: 10x data = 10x time (not 100x)
```

**Example HIGH**:
```python
# services/recommendations.py - HIGH: Nested loops for similarity!
def find_similar_items(item_id):
    items = db.query("SELECT * FROM items")  # 50,000 items

    similar = []
    for item in items:
        # Calculate similarity with every other item - O(n²)!
        for other in items:
            if similarity(item, other) > 0.8:
                similar.append((item, other))

    return similar
# 50,000 × 50,000 = 2.5 billion comparisons
# At 100K items: 10 billion comparisons = 30+ minutes
```

**Fix**:
```python
# Use vector database or pre-computed similarity matrix
from sklearn.metrics.pairwise import cosine_similarity

def find_similar_items(item_id):
    # Pre-compute similarity matrix once (background job)
    # Or use vector database (Pinecone, Weaviate, Milvus)

    item_vector = vector_db.get_embedding(item_id)
    similar = vector_db.search(
        vector=item_vector,
        top_k=10,
        threshold=0.8
    )

    return similar
# O(log n) with vector database index
# Scales to millions of items
```

## 2. Database Query Optimization

**What to look for**:

- **N+1 query patterns**: Loop making one query per item
- **SELECT * without LIMIT**: Unbounded result sets
- **Missing indexes on WHERE/JOIN columns**: Table scans on large tables
- **Full table scans in hot paths**: No filtering predicates
- **Large OFFSET in pagination**: `OFFSET 1000000` scans all rows
- **Suboptimal JOIN order**: Joining large tables before filtering
- **Missing composite indexes**: Indexes on single columns when multi-column needed
- **No query result pagination**: Returning millions of rows at once

**Examples**:

**Example BLOCKER**:
```typescript
// src/api/orders.ts - BLOCKER: N+1 query for user details!
app.get('/api/orders', async (req, res) => {
  const orders = await db.query('SELECT * FROM orders LIMIT 100')

  // N+1: One query per order to fetch user!
  for (const order of orders) {
    order.user = await db.query(
      'SELECT * FROM users WHERE id = ?',
      [order.userId]
    )
  }

  res.json(orders)
})
// 101 queries (1 + 100)
// At 1000 orders: 1001 queries = several seconds
```

**Fix**:
```typescript
app.get('/api/orders', async (req, res) => {
  const orders = await db.query('SELECT * FROM orders LIMIT 100')
  const userIds = [...new Set(orders.map(o => o.userId))]

  // Single query for all users
  const users = await db.query(
    'SELECT * FROM users WHERE id IN (?)',
    [userIds]
  )

  const usersById = new Map(users.map(u => [u.id, u]))

  for (const order of orders) {
    order.user = usersById.get(order.userId)
  }

  res.json(orders)
})
// 2 queries regardless of order count
```

**Example HIGH**:
```sql
-- migrations/add_search_query.sql - HIGH: Missing index on search!
SELECT * FROM products
WHERE category = 'electronics'
  AND price BETWEEN 100 AND 500
ORDER BY created_at DESC;

-- No index on (category, price, created_at)
-- Full table scan on 10M row table = 8+ seconds
```

**Fix**:
```sql
-- Create composite index for common query pattern
CREATE INDEX idx_products_category_price_created
ON products(category, price, created_at DESC);

-- Now: 10ms instead of 8 seconds (800x faster)
-- Scales: Even with 100M rows, query stays fast
```

**Example MED**:
```python
# api/search.py - MED: Inefficient pagination with large OFFSET!
def search_products(query, page=1, page_size=20):
    offset = (page - 1) * page_size

    results = db.query(
        "SELECT * FROM products WHERE name LIKE ? OFFSET ? LIMIT ?",
        [f"%{query}%", offset, page_size]
    )
    # Page 1000: OFFSET 20000 - scans 20000 rows to skip them!
    # Page 10000: OFFSET 200000 - scans 200K rows!
```

**Fix - Cursor-based pagination**:
```python
def search_products(query, cursor=None, page_size=20):
    if cursor:
        # Use cursor (last ID) instead of OFFSET
        results = db.query(
            """SELECT * FROM products
               WHERE name LIKE ? AND id > ?
               ORDER BY id LIMIT ?""",
            [f"%{query}%", cursor, page_size]
        )
    else:
        results = db.query(
            "SELECT * FROM products WHERE name LIKE ? ORDER BY id LIMIT ?",
            [f"%{query}%", page_size]
        )

    next_cursor = results[-1].id if results else None
    return results, next_cursor
# O(1) for any page depth - always fast
```

## 3. Caching Strategy

**What to look for**:

- **No caching for expensive operations**: Complex aggregations, external API calls
- **Cache stampede**: All clients refresh simultaneously when cache expires
- **No cache warming**: Cold cache on deploy causes spike
- **Caching entire datasets**: Loading full tables into memory
- **No cache invalidation strategy**: Stale data served indefinitely
- **Missing cache layers**: No CDN, no application cache, no query cache
- **Cache key collisions**: Poor cache key design

**Examples**:

**Example HIGH**:
```typescript
// src/api/analytics.ts - HIGH: No caching for expensive aggregation!
app.get('/api/analytics/revenue', async (req, res) => {
  // 15-second aggregation query, runs on every request!
  const revenue = await db.query(`
    SELECT
      DATE(created_at) as date,
      SUM(amount) as revenue,
      COUNT(*) as orders,
      AVG(amount) as avg_order
    FROM orders
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `)

  res.json(revenue)
})
// 100 requests/min × 15 sec = database overload
// At 1000 req/min: complete database saturation
```

**Fix**:
```typescript
const CACHE_TTL = 300  // 5 minutes

app.get('/api/analytics/revenue', async (req, res) => {
  const cacheKey = 'analytics:revenue:90d'

  // Check cache first
  const cached = await redis.get(cacheKey)
  if (cached) {
    return res.json(JSON.parse(cached))
  }

  // Cache miss - compute and cache with lock to prevent stampede
  const lockKey = `${cacheKey}:lock`
  const locked = await redis.set(lockKey, '1', 'EX', 10, 'NX')

  if (!locked) {
    // Another request is computing - wait briefly and check cache again
    await new Promise(resolve => setTimeout(resolve, 100))
    const retry = await redis.get(cacheKey)
    if (retry) return res.json(JSON.parse(retry))
  }

  try {
    const revenue = await db.query(`...`)

    // Cache for 5 minutes
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(revenue))

    res.json(revenue)
  } finally {
    await redis.del(lockKey)
  }
})
// First request: 15 sec, then cached
// Next 299 seconds: <5ms from cache
// Handles 1000s req/min easily
```

**Example MED**:
```go
// api/users.go - MED: Repeated expensive computation!
func GetUserProfile(w http.ResponseWriter, r *http.Request) {
    userID := r.URL.Query().Get("id")

    // Expensive: fetches user + posts + comments + likes
    user := fetchFullUserProfile(userID)  // 500ms query

    // Runs on EVERY request for same user
    json.NewEncoder(w).Encode(user)
}
```

**Fix**:
```go
func GetUserProfile(w http.ResponseWriter, r *http.Request) {
    userID := r.URL.Query().Get("id")
    cacheKey := fmt.Sprintf("user:profile:%s", userID)

    // Check cache
    if cached, err := redis.Get(cacheKey); err == nil {
        w.Write(cached)
        return
    }

    // Cache miss
    user := fetchFullUserProfile(userID)
    data, _ := json.Marshal(user)

    // Cache for 5 minutes
    redis.Setex(cacheKey, 300, data)

    w.Write(data)
}
// 500ms → 2ms (250x faster for cache hits)
```

## 4. Horizontal Scaling Impediments

**What to look for**:

- **In-memory session storage**: Sessions stored in application memory
- **Local file storage**: Files written to local disk
- **Shared mutable state**: Global variables, singletons with state
- **Sticky sessions required**: Load balancer must route same user to same server
- **No load balancer health checks**: Can't detect unhealthy instances
- **Server-specific caches**: Cache not shared across instances
- **Local locks**: File locks, in-memory semaphores

**Examples**:

**Example MED**:
```typescript
// src/middleware/session.ts - MED: In-memory session storage!
const sessions = new Map<string, Session>()

export function sessionMiddleware(req, res, next) {
  const sessionId = req.cookies.sessionId
  req.session = sessions.get(sessionId)

  if (!req.session) {
    req.session = { userId: null, data: {} }
    sessions.set(sessionId, req.session)
  }

  next()
}

// Problem: Sessions stored in single server's memory
// Can't scale horizontally - user must hit same server
// If server restarts, all sessions lost
```

**Fix**:
```typescript
import Redis from 'ioredis'
const redis = new Redis()

export async function sessionMiddleware(req, res, next) {
  const sessionId = req.cookies.sessionId

  // Sessions in Redis - shared across all servers
  const sessionData = await redis.get(`session:${sessionId}`)

  if (sessionData) {
    req.session = JSON.parse(sessionData)
  } else {
    req.session = { userId: null, data: {} }
    await redis.setex(
      `session:${sessionId}`,
      86400,  // 24 hour TTL
      JSON.stringify(req.session)
    )
  }

  next()
}
// Now: Can scale to 100s of servers
// Sessions persistent across restarts
// Load balancer can route anywhere
```

**Example HIGH**:
```python
# workers/file_processor.py - HIGH: Local file storage!
import os

def process_upload(file_id):
    # Download to local disk
    file_path = f"/tmp/uploads/{file_id}"
    download_from_s3(file_id, file_path)

    # Process
    result = transform_file(file_path)

    # Store result locally
    result_path = f"/var/app/results/{file_id}.json"
    with open(result_path, 'w') as f:
        json.dump(result, f)

    # Problem: Result only on one server!
    # Other workers can't access it
```

**Fix**:
```python
def process_upload(file_id):
    # Download to temporary local storage
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        download_from_s3(file_id, tmp.name)
        result = transform_file(tmp.name)
        os.unlink(tmp.name)  # Clean up temp file

    # Store result in shared storage (S3)
    result_key = f"results/{file_id}.json"
    upload_to_s3(result_key, json.dumps(result))

    # Any worker can now retrieve results from S3
```

## 5. Resource Leaks and Limits

**What to look for**:

- **Unbounded arrays/maps**: Growing collections without size limits
- **Connection leaks**: Database/HTTP connections not closed
- **Memory leaks in loops**: Objects accumulating in closures
- **No pagination limits**: Endpoints returning unlimited results
- **Event listener leaks**: Listeners added but never removed
- **Timer leaks**: setInterval without clearInterval
- **Stream leaks**: Streams not properly closed

**Examples**:

**Example HIGH**:
```typescript
// src/api/search.ts - HIGH: Returns unlimited results!
app.get('/api/search', async (req, res) => {
  const { query } = req.query

  // No LIMIT - could return 10M rows!
  const results = await db.query(`
    SELECT * FROM products
    WHERE name LIKE ? OR description LIKE ?
  `, [`%${query}%`, `%${query}%`])

  res.json(results)
})
// At scale: Returns 5GB JSON response, exhausts memory
```

**Fix**:
```typescript
app.get('/api/search', async (req, res) => {
  const { query, limit = 20, offset = 0 } = req.query

  // Enforce max limit
  const maxLimit = 100
  const safeLimit = Math.min(parseInt(limit), maxLimit)
  const safeOffset = parseInt(offset) || 0

  const results = await db.query(`
    SELECT * FROM products
    WHERE name LIKE ? OR description LIKE ?
    LIMIT ? OFFSET ?
  `, [`%${query}%`, `%${query}%`, safeLimit, safeOffset])

  // Return total count for pagination
  const [{ total }] = await db.query(`
    SELECT COUNT(*) as total FROM products
    WHERE name LIKE ? OR description LIKE ?
  `, [`%${query}%`, `%${query}%`])

  res.json({
    results,
    total,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: offset + safeLimit < total
  })
})
```

**Example MED**:
```javascript
// src/services/websocket.js - MED: Connection leak!
class WebSocketService {
  constructor() {
    this.connections = []
  }

  addConnection(ws) {
    this.connections.push(ws)

    ws.on('message', (msg) => {
      this.handleMessage(msg)
    })

    // BUG: Never remove from array when connection closes!
    // Array grows forever, memory leak
  }
}
```

**Fix**:
```javascript
class WebSocketService {
  constructor() {
    this.connections = new Set()
  }

  addConnection(ws) {
    this.connections.add(ws)

    ws.on('message', (msg) => {
      this.handleMessage(msg)
    })

    // Remove when connection closes
    ws.on('close', () => {
      this.connections.delete(ws)
    })

    ws.on('error', () => {
      this.connections.delete(ws)
    })
  }

  // Add periodic cleanup for stale connections
  cleanup() {
    for (const ws of this.connections) {
      if (ws.readyState === WebSocket.CLOSED) {
        this.connections.delete(ws)
      }
    }
  }
}
```

## 6. Rate Limiting and Throttling

**What to look for**:

- **No rate limits on expensive operations**: Unlimited user operations
- **No API rate limiting**: Endpoints without request limits
- **No concurrency limits**: Unbounded parallel processing
- **Missing backpressure**: Queue flooding without pushback
- **No circuit breakers**: Cascading failures from downstream services

**Examples**:

**Example HIGH**:
```typescript
// src/api/export.ts - HIGH: No rate limit on expensive export!
app.post('/api/export', async (req, res) => {
  const { userId } = req.user

  // Generate large export - takes 30 seconds, high CPU
  const data = await generateFullExport(userId)

  res.json({ exportUrl: data.url })
})
// User can submit 100 export requests in parallel
// = 100 × 30 seconds of CPU = server overload
```

**Fix**:
```typescript
import rateLimit from 'express-rate-limit'

// Limit to 2 exports per hour per user
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 2,
  keyGenerator: (req) => req.user.userId,
  message: 'Export limit exceeded. Max 2 exports per hour.'
})

app.post('/api/export', exportLimiter, async (req, res) => {
  const { userId } = req.user

  // Queue export as background job instead of synchronous
  const jobId = await exportQueue.enqueue('generate-export', { userId })

  res.json({
    jobId,
    message: 'Export queued. Check /api/exports/:jobId for status.'
  })
})
// Now: Controlled export rate, no overload possible
```

**Example MED**:
```python
# api/webhooks.py - MED: No concurrency limit for webhook processing!
@app.post("/webhooks")
async def process_webhook(webhook: Webhook):
    # Process webhook - calls external APIs, database writes
    await process_webhook_async(webhook)
    return {"status": "ok"}

# If 1000 webhooks arrive simultaneously:
# = 1000 parallel processing tasks = resource exhaustion
```

**Fix**:
```python
from asyncio import Semaphore

# Limit to 20 concurrent webhook processing tasks
webhook_semaphore = Semaphore(20)

@app.post("/webhooks")
async def process_webhook(webhook: Webhook):
    async with webhook_semaphore:
        # Only 20 webhooks processed concurrently
        await process_webhook_async(webhook)

    return {"status": "ok"}

# Or better: Queue webhooks for background processing
@app.post("/webhooks")
async def process_webhook(webhook: Webhook):
    await webhook_queue.enqueue(webhook)
    return {"status": "queued"}
```

## 7. Connection Pooling

**What to look for**:

- **No connection pooling**: New database connection per request
- **Pool size too small**: Bottleneck under load
- **Pool size too large**: Overwhelming database
- **No connection timeout**: Connections held forever
- **No connection validation**: Using stale connections
- **No connection reuse**: HTTP clients without keep-alive

**Examples**:

**Example HIGH**:
```python
# api/users.py - HIGH: New connection per request!
def get_user(user_id):
    # Creates new connection every time!
    conn = psycopg2.connect(
        host="db.example.com",
        database="app",
        user="app_user",
        password="secret"
    )

    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
    user = cursor.fetchone()

    conn.close()

    return user

# 1000 req/sec = 1000 new connections/sec
# Database can't handle this - connection limit exceeded
```

**Fix**:
```python
from psycopg2 import pool

# Create connection pool at startup
db_pool = pool.SimpleConnectionPool(
    minconn=10,
    maxconn=50,
    host="db.example.com",
    database="app",
    user="app_user",
    password="secret"
)

def get_user(user_id):
    # Reuse connection from pool
    conn = db_pool.getconn()

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone()
        return user
    finally:
        # Return connection to pool
        db_pool.putconn(conn)

# 1000 req/sec handled by 50 pooled connections
# Connections reused, not recreated
```

## 8. Multi-Tenancy Scalability

**What to look for**:

- **No tenant isolation**: One tenant can affect others
- **Missing row-level security**: Queries can access other tenants' data
- **No per-tenant rate limiting**: One tenant can overload system
- **Shared database without partitioning**: Slow queries affect all tenants
- **No tenant resource quotas**: Unbounded storage/compute per tenant

**Examples**:

**Example HIGH**:
```typescript
// src/api/documents.ts - HIGH: No tenant isolation!
app.get('/api/documents', async (req, res) => {
  const { organizationId } = req.user

  // No index on organization_id - scans all tenants' data!
  const docs = await db.query(`
    SELECT * FROM documents
    WHERE organization_id = ?
  `, [organizationId])

  res.json(docs)
})

// With 1000 tenants, each query scans all 1M documents
// Tenant A's query slows down when Tenant B has large dataset
```

**Fix**:
```sql
-- Add composite index with tenant ID first
CREATE INDEX idx_documents_org_created
ON documents(organization_id, created_at DESC);

-- Enable partition pruning
CREATE TABLE documents (
  id BIGINT,
  organization_id BIGINT,
  content TEXT,
  created_at TIMESTAMP
) PARTITION BY LIST (organization_id);

-- Each tenant gets own partition for isolation
CREATE TABLE documents_org_1 PARTITION OF documents
FOR VALUES IN (1);
```

**Example MED**:
```typescript
// src/services/storage.ts - MED: No per-tenant quotas!
export async function uploadFile(organizationId: string, file: Buffer) {
  // No quota check - tenant can upload unlimited data!
  const key = `orgs/${organizationId}/${uuid()}`
  await s3.putObject({
    Bucket: 'tenant-files',
    Key: key,
    Body: file
  })

  return key
}
```

**Fix**:
```typescript
export async function uploadFile(organizationId: string, file: Buffer) {
  // Check current usage
  const usage = await redis.get(`storage:${organizationId}`)
  const currentBytes = parseInt(usage || '0')

  // Enforce quota (e.g., 10GB per tenant)
  const quota = 10 * 1024 * 1024 * 1024  // 10GB

  if (currentBytes + file.length > quota) {
    throw new Error('Storage quota exceeded')
  }

  const key = `orgs/${organizationId}/${uuid()}`
  await s3.putObject({
    Bucket: 'tenant-files',
    Key: key,
    Body: file
  })

  // Update usage
  await redis.incrby(`storage:${organizationId}`, file.length)

  return key
}
```

## 9. Background Job Processing

**What to look for**:

- **Long-running operations in request handlers**: Blocking user requests
- **No job queues**: Synchronous processing of async work
- **Unbounded job concurrency**: All jobs run simultaneously
- **No job retry logic**: Failed jobs lost forever
- **No job timeout**: Jobs run forever on errors
- **No dead letter queue**: Failed jobs disappear

**Examples**:

**Example HIGH**:
```typescript
// src/api/videos.ts - HIGH: Video processing in request handler!
app.post('/api/videos', async (req, res) => {
  const { videoUrl } = req.body

  // Download video (2 minutes)
  const video = await downloadVideo(videoUrl)

  // Transcode to multiple formats (10 minutes)
  const formats = await transcodeVideo(video, ['720p', '1080p', '4K'])

  // Upload to CDN (5 minutes)
  const urls = await uploadToCDN(formats)

  res.json({ urls })
})
// User waits 17 minutes for response!
// Ties up web server for entire duration
// Can't scale - limited by number of web processes
```

**Fix**:
```typescript
import Bull from 'bull'

const videoQueue = new Bull('video-processing', {
  redis: { host: 'redis', port: 6379 }
})

// Configure concurrency
videoQueue.process(5, async (job) => {
  const { videoUrl, userId } = job.data

  const video = await downloadVideo(videoUrl)
  const formats = await transcodeVideo(video, ['720p', '1080p', '4K'])
  const urls = await uploadToCDN(formats)

  // Notify user when complete
  await sendNotification(userId, { urls })

  return { urls }
})

app.post('/api/videos', async (req, res) => {
  const { videoUrl } = req.body
  const { userId } = req.user

  // Queue job for background processing
  const job = await videoQueue.add({
    videoUrl,
    userId
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    timeout: 30 * 60 * 1000  // 30 minute timeout
  })

  res.json({
    jobId: job.id,
    status: 'processing',
    statusUrl: `/api/videos/status/${job.id}`
  })
})
// Response in <100ms
// Processing happens in dedicated workers
// Can scale workers independently
```

## 10. API Design for Scale

**What to look for**:

- **Chatty APIs**: Multiple round-trips for common operations
- **No pagination**: Endpoints returning full datasets
- **No field filtering**: Always returning all fields
- **No ETags/conditional requests**: Re-fetching unchanged data
- **No compression**: Responses not gzip/brotli compressed
- **No HTTP/2**: Missing multiplexing benefits

**Examples**:

**Example MED**:
```typescript
// src/api/users.ts - MED: Chatty API requiring multiple requests!
// Client must make 4 requests:
app.get('/api/users/:id', ...)           // Get user
app.get('/api/users/:id/posts', ...)     // Get posts
app.get('/api/users/:id/comments', ...) // Get comments
app.get('/api/users/:id/followers', ...) // Get followers

// 4 round-trips × 50ms latency = 200ms minimum
// At scale: 4x database load, 4x API traffic
```

**Fix - Add composite endpoint**:
```typescript
app.get('/api/users/:id', async (req, res) => {
  const { id } = req.params
  const { include } = req.query  // ?include=posts,comments,followers

  const includes = include?.split(',') || []

  const [user, posts, comments, followers] = await Promise.all([
    db.query('SELECT * FROM users WHERE id = ?', [id]),
    includes.includes('posts')
      ? db.query('SELECT * FROM posts WHERE user_id = ? LIMIT 10', [id])
      : null,
    includes.includes('comments')
      ? db.query('SELECT * FROM comments WHERE user_id = ? LIMIT 10', [id])
      : null,
    includes.includes('followers')
      ? db.query('SELECT * FROM followers WHERE user_id = ? LIMIT 10', [id])
      : null,
  ])

  res.json({
    ...user,
    ...(posts && { posts }),
    ...(comments && { comments }),
    ...(followers && { followers })
  })
})
// 1 request instead of 4
// Parallel database queries
// Client controls what's included
```

# WORKFLOW

## Step 1: Determine review scope

```bash
if [ "$SCOPE" = "pr" ]; then
  TARGET_REF="${TARGET:-HEAD}"
  BASE_REF="origin/main"
elif [ "$SCOPE" = "worktree" ]; then
  TARGET_REF="worktree"
elif [ "$SCOPE" = "diff" ]; then
  TARGET_REF="${TARGET:-HEAD}"
  BASE_REF="HEAD~1"
elif [ "$SCOPE" = "repo" ]; then
  TARGET_REF="repo"
fi
```

## Step 2: Profile algorithmic complexity

```bash
# Find nested loops
grep -r "for.*for\|map.*filter\|forEach.*forEach" --include="*.ts" --include="*.js" --include="*.py"

# Look for O(n²) patterns
grep -r "\.filter\|\.find\|\.includes" --include="*.ts" -B 3 | grep "map\|forEach"

# Find recursive functions without memoization
grep -r "function.*\(.*\).*{" --include="*.ts" -A 10 | grep "return.*\("
```

## Step 3: Review database queries

```bash
# Find unbounded SELECT
grep -r "SELECT \*" --include="*.sql" --include="*.ts" --include="*.py" | grep -v "LIMIT\|TOP\|FETCH"

# Check for N+1 patterns
grep -r "for\|map\|forEach" --include="*.ts" -A 5 | grep "query\|findOne\|find"

# Find missing indexes
git diff $BASE_REF -- "migrations/*.sql" | grep -i "CREATE TABLE" -A 20 | grep -v "INDEX\|KEY"

# Look for large OFFSET pagination
grep -r "OFFSET" --include="*.sql" --include="*.ts"
```

## Step 4: Check caching implementation

```bash
# Find expensive operations without caching
grep -r "aggregate\|SUM\|AVG\|GROUP BY" --include="*.sql" --include="*.ts" -B 5 -A 5

# Check if cached
grep -r "redis\|cache\|memo" --include="*.ts"

# Find external API calls without caching
grep -r "fetch\|axios\|http\.get\|requests\.get" --include="*.ts" --include="*.py" -B 5 | grep -v "cache"
```

## Step 5: Identify horizontal scaling blockers

```bash
# Find in-memory state
grep -r "new Map\|new Set\|const.*=.*\[\]" --include="*.ts" | grep -v "function\|const.*="

# Look for local file operations
grep -r "fs\.|writeFile\|readFile" --include="*.ts" --include="*.js"

# Find singleton patterns
grep -r "static.*instance\|export const.*new" --include="*.ts"
```

## Step 6: Check resource limits

```bash
# Find unbounded result sets
grep -r "res\.json\|res\.send" --include="*.ts" -B 10 | grep "query" | grep -v "LIMIT"

# Look for connection leaks
grep -r "createConnection\|connect\(" --include="*.ts" -B 2 -A 10 | grep -v "close\|disconnect"

# Find missing timeouts
grep -r "setTimeout\|setInterval" --include="*.ts" | grep -v "clearTimeout\|clearInterval"
```

## Step 7: Review rate limiting

```bash
# Check for rate limiters
grep -r "rateLimit\|throttle" --include="*.ts"

# Find expensive endpoints without rate limits
grep -r "app\.(post|put|delete)" --include="*.ts" -A 10 | grep -v "rateLimit"
```

## Step 8: Analyze connection pooling

```bash
# Check database pool configuration
grep -r "createPool\|ConnectionPool\|pool:" --include="*.ts" --include="*.py" -A 5

# Find direct connections instead of pooling
grep -r "createConnection\|connect\(" --include="*.ts" | grep -v "pool"
```

## Step 9: Estimate scale impact

For each finding, estimate impact:

```bash
# Current capacity: Can handle X users/req/sec/data volume
# At 10x scale: What breaks?
# At 100x scale: What breaks?
# Recommendation: How to fix for target scale
```

## Step 10: Generate scalability review report

Create `.claude/<SESSION_SLUG>/reviews/review-scalability-<YYYY-MM-DD>.md` with:
- Bottleneck analysis
- Scale impact estimates (current, 10x, 100x)
- Optimization recommendations
- Capacity planning guidance

## Step 11: Update session README

```bash
echo "- [Scalability Review](reviews/review-scalability-$(date +%Y-%m-%d).md)" >> .claude/<SESSION_SLUG>/README.md
```

## Step 12: Output summary

Print summary with critical findings and scale readiness assessment.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-scalability-<YYYY-MM-DD>.md`:

```markdown
---
command: /review:scalability
session_slug: <SESSION_SLUG>
scope: <SCOPE>
target: <TARGET>
completed: <YYYY-MM-DD>
---

# Scalability Review

**Scope:** <Description of what was reviewed>
**Reviewer:** Claude Scalability Review Agent
**Date:** <YYYY-MM-DD>

## Summary

<1-2 paragraph overview of scalability readiness, bottlenecks, capacity limits>

**Severity Breakdown:**
- BLOCKER: <count> (O(n²) in hot paths, unbounded operations)
- HIGH: <count> (missing indexes, no caching, connection leaks)
- MED: <count> (shared state, suboptimal queries, no rate limits)
- LOW: <count> (minor optimizations)

**Merge Recommendation:** <BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>

---

## Scale Assessment

**Current Capacity:**
- Users: <current>
- Requests/sec: <current>
- Data volume: <current>

**Projected Capacity (with current code):**
- At 10x scale: <assessment>
- At 100x scale: <assessment>

**Bottlenecks Identified:**
1. <Bottleneck 1> - limits to <X> req/sec
2. <Bottleneck 2> - limits to <Y> users
3. <Bottleneck 3> - limits to <Z> GB data

---

## Findings

### Finding 1: <Title of Issue> [BLOCKER]

**Location:** `<file>:<line>`

**Issue:**
<Description of scalability problem>

**Evidence:**
```<language>
<code snippet showing the problem>
```

**Scale Impact:**
| Scale | Impact |
|-------|--------|
| Current (X users) | Works fine |
| 10x (Y users) | Response time: 500ms → 5sec |
| 100x (Z users) | Response time: 5sec → timeout |

**Fix:**
```<language>
<optimized code>
```

**Performance Improvement:**
- Before: O(n²) - 10,000 iterations
- After: O(n) - 100 iterations (100x faster)
- Scales to 100x without degradation

---

### Finding 2: <Title> [HIGH]

...

---

## Bottleneck Analysis

### Database (PRIMARY BOTTLENECK)

**Current State:**
- Queries/sec: <current>
- Slowest query: <time> (<query>)
- Connection pool: <current> / <max>

**At 10x Scale:**
- Queries/sec: <projected>
- Database CPU: <projected>%
- Estimated: <WILL FAIL | DEGRADED | OK>

**Recommendations:**
1. Add index on `users(email, created_at)` - 100x query speedup
2. Implement query result caching - 80% cache hit rate
3. Add read replicas - distribute read load

### API Server

**Current State:**
- Requests/sec: <current>
- P95 latency: <current>ms
- Instance count: <current>

**At 10x Scale:**
- Requests/sec: <projected>
- Estimated latency: <projected>ms
- Recommendation: <scaling strategy>

### Caching Layer

**Current State:**
- Cache hit rate: <current>%
- Cache size: <current> GB
- Cache misses cause: <analysis>

**Recommendations:**
1. Add caching for <operation> - reduces database load by 70%
2. Implement cache warming on deploy
3. Add cache circuit breaker

---

## Horizontal Scaling Readiness

**Blockers:**
- [ ] In-memory session storage (use Redis)
- [ ] Local file uploads (use S3)
- [ ] Singleton state (refactor to stateless)

**Ready:**
- [x] Stateless application code
- [x] External session store (Redis)
- [x] Shared database
- [x] Load balancer compatible

**Action Items:**
1. <Fix blocker 1>
2. <Fix blocker 2>

---

## Performance Optimization Opportunities

### High Impact (>10x improvement)
1. **Add database index on orders(user_id, status)**
   - Current: 8 sec table scan
   - After: 10ms indexed lookup
   - Impact: 800x faster

2. **Cache expensive aggregation query**
   - Current: 15 sec query on every request
   - After: <5ms from cache
   - Impact: Reduces DB load 95%

### Medium Impact (2-10x improvement)
1. **Fix N+1 query in /api/users**
   - Current: 101 queries
   - After: 2 queries
   - Impact: 50x fewer queries

2. **Implement cursor-based pagination**
   - Current: OFFSET 10000 scans 10K rows
   - After: Indexed cursor lookup
   - Impact: 100x faster deep pagination

### Low Impact (<2x improvement)
1. **Add gzip compression**
   - Current: 1MB JSON response
   - After: 100KB compressed
   - Impact: 10x less bandwidth

---

## Recommendations

### Immediate Actions (BLOCKER/HIGH)

1. **Fix O(n²) algorithm in user-posts matching** (`users.ts:45`)
   - Use Map for O(1) lookups instead of filter
   - Priority: CRITICAL - breaks at 100x scale

2. **Add database index on orders(user_id, created_at)** (`migrations/`)
   - 800x query speedup
   - Priority: HIGH - needed before next growth spike

3. **Implement caching for analytics queries** (`analytics.ts`)
   - 15 sec → 5ms for cache hits
   - Priority: HIGH - reduces database overload

### Short-term Improvements (MED)

1. **Move session storage to Redis** (`session.ts:12`)
   - Enables horizontal scaling
   - Priority: MED - needed for next scaling milestone

2. **Add rate limiting on expensive endpoints** (`export.ts`, `reports.ts`)
   - Prevents single user from overloading system
   - Priority: MED - risk mitigation

### Long-term Optimizations (LOW)

1. **Implement API response compression**
   - 10x bandwidth reduction
   - Priority: LOW - nice to have

2. **Add CDN for static assets**
   - Reduces origin load
   - Priority: LOW - optimization

---

## Capacity Planning

**Current Capacity:** <X> req/sec, <Y> users

**Target Capacity:** <A> req/sec, <B> users (10x growth)

**Required Changes:**
1. Add 2 database read replicas - $500/month
2. Scale API servers 2x → 10x - $1000/month
3. Add Redis cluster - $300/month
4. Implement caching layer - development time

**Timeline:**
- Week 1-2: Fix BLOCKER issues (O(n²) algorithms, missing indexes)
- Week 3-4: Implement caching (HIGH priority)
- Week 5-6: Add horizontal scaling support (MED priority)
- Ongoing: Monitor and optimize (LOW priority items)

**Cost Estimate:**
- Current: $X,XXX/month
- At target scale: $Y,YYY/month
- Per-user cost: $Z (acceptable for business model)

---

## Next Steps

1. **Immediate**: Fix BLOCKER issues before next deployment
2. **This sprint**: Implement HIGH priority optimizations
3. **Next sprint**: Remove horizontal scaling blockers
4. **Ongoing**: Set up load testing, capacity monitoring

## Load Testing Recommendations

```bash
# Run load tests to validate fixes
artillery run --target https://api.example.com \
  --count 1000 \
  --rate 100 \
  scenarios/critical-paths.yml

# Monitor key metrics:
# - P95 latency under load
# - Database CPU/connections
# - Cache hit rate
# - Error rate at scale
```
```

# SUMMARY OUTPUT

After creating the review file, print to console:

```markdown
# Scalability Review Complete

## Review Location
Saved to: `.claude/<SESSION_SLUG>/reviews/review-scalability-<YYYY-MM-DD>.md`

## Merge Recommendation
**<BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>**

## Critical Issues Found

### BLOCKERS (<count>):
- `<file>:<line>` - O(n²) algorithm in user matching - breaks at 100x scale
- `<file>:<line>` - Unbounded query without LIMIT - memory exhaustion risk

### HIGH (<count>):
- `<file>:<line>` - Missing database index - 800x slower queries
- `<file>:<line>` - No caching for expensive aggregation - database overload

## Scale Readiness Assessment

**Current Capacity:** <X> req/sec, <Y> users, <Z> GB data

**Bottlenecks:**
1. **Database** - Primary bottleneck, limits to <X> req/sec
2. **API** - Secondary bottleneck, no caching layer
3. **Horizontal scaling** - Blocked by in-memory sessions

**At 10x Scale:**
- Database: <WILL FAIL | DEGRADED | OK>
- API: <WILL FAIL | DEGRADED | OK>
- Overall: <NOT READY | NEEDS WORK | READY>

**At 100x Scale:**
- Overall: <NOT READY>

## Performance Optimization Impact

**High Impact Fixes:**
1. Add index on orders(user_id, status) - 800x speedup
2. Cache analytics queries - 95% database load reduction
3. Fix O(n²) algorithm - 100x faster at scale

**Total Potential Improvement:**
- Database load: -80%
- API latency: -70%
- Capacity: +500%

## Next Actions
1. Fix BLOCKER issues before merge
2. Add missing database indexes (1-2 hours)
3. Implement caching layer (1 sprint)
4. Plan horizontal scaling migration (2 sprints)
```
