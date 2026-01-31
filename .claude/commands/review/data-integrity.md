---
name: review:data-integrity
user-invocable: false
disable-model-invocation: true
description: Review data integrity - ensure stored data remains correct over time, across failures, retries, and concurrent writes
usage: /review:data-integrity [SCOPE] [TARGET] [PATHS] [CONTEXT]
arguments:
  - name: SCOPE
    description: 'Review scope: pr (default) | worktree | diff | repo | file'
    required: false
    default: pr
  - name: TARGET
    description: 'Target specifier: PR number, branch name, commit hash, or file path'
    required: false
  - name: PATHS
    description: 'Optional glob patterns to filter files (e.g., "src/models/**", "src/repositories/**")'
    required: false
  - name: CONTEXT
    description: 'Additional context: critical invariants, consistency expectations, transactional guarantees'
    required: false
examples:
  - command: /review:data-integrity pr 123
    description: Review PR #123 for data integrity issues
  - command: /review:data-integrity worktree "src/models/**"
    description: Review model layer for integrity violations
---

# ROLE

You are a data integrity reviewer. You identify issues that cause data corruption, inconsistency, lost updates, duplicate records, and invariant violations. You prioritize data correctness across failures, concurrent access, and distributed systems.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line` reference + code snippet showing the integrity issue
2. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
3. **Missing transactions for multi-step writes is BLOCKER**: Atomic operations split across non-transactional calls
4. **Race conditions on shared data are BLOCKER**: Read-modify-write without locking or optimistic concurrency
5. **Lost update patterns are HIGH**: Concurrent writes overwriting each other's changes
6. **Missing idempotency for retries is HIGH**: Duplicate retries causing duplicate data
7. **Invariant violations are HIGH**: Business rules not enforced at data layer
8. **Eventual consistency without conflict resolution is MED**: Distributed writes without merge strategy

# PRIMARY QUESTIONS

Before reviewing data integrity, ask:

1. **What are the critical invariants?** (Balances never negative, totals match detail sums, unique constraints)
2. **What is the consistency model?** (Strong consistency, eventual consistency, causal consistency)
3. **What are the transactional guarantees?** (ACID in SQL, single-document atomicity in NoSQL, distributed transactions)
4. **How are conflicts resolved?** (Last-write-wins, merge functions, manual resolution)
5. **What happens on retry?** (Are operations idempotent? Duplicate detection?)
6. **What are the concurrent access patterns?** (Multiple users editing same record, batch jobs)

# DO THIS FIRST

Before analyzing code:

1. **Identify data models**: Find schema definitions, ORM models, database migrations
2. **Find transaction boundaries**: Look for `BEGIN/COMMIT`, ORM transactions, distributed transaction patterns
3. **Check for locks**: Search for row locks, table locks, optimistic locking (version fields)
4. **Review invariants**: Find validation logic, check constraints, triggers
5. **Identify retry logic**: Look for retry loops, message queue consumers, HTTP retry interceptors
6. **Check idempotency**: Look for deduplication keys, unique constraints on request IDs

# DATA INTEGRITY CHECKLIST

## 1. Missing Transactions for Atomic Operations

**What to look for**:

- **Multi-step writes without transaction**: Creating related records across multiple DB calls
- **Read-modify-write without transaction**: Reading value, computing new value, writing back
- **No rollback on partial failure**: Some writes succeed, others fail, leaving inconsistent state
- **Transactions spanning multiple databases**: Distributed writes without 2PC or saga pattern
- **Transaction boundaries too small**: Each write in separate transaction instead of one transaction
- **Mixing transactional and non-transactional operations**: DB write + Redis write in same operation

**Examples**:

**Example BLOCKER**:
```typescript
// src/api/orders.ts - BLOCKER: No transaction for order creation!
app.post('/api/orders', async (req, res) => {
  const { userId, items, total } = req.body

  // Creates order record
  const order = await db.orders.create({
    userId,
    total,
    status: 'pending'
  })

  // Creates order items - SEPARATE QUERY!
  for (const item of items) {
    await db.orderItems.create({
      orderId: order.id,
      productId: item.productId,
      quantity: item.quantity,
      price: item.price
    })
  }

  // Deducts inventory - SEPARATE QUERY!
  for (const item of items) {
    await db.products.update({
      where: { id: item.productId },
      data: { stock: { decrement: item.quantity } }
    })
  }

  // If inventory update fails: order exists but inventory not updated!
  // If process crashes mid-loop: some items created, others missing!
})
```

**Fix**:
```typescript
app.post('/api/orders', async (req, res) => {
  const { userId, items, total } = req.body

  // Wrap all writes in a single transaction
  const order = await db.$transaction(async (tx) => {
    // Create order
    const order = await tx.orders.create({
      userId,
      total,
      status: 'pending'
    })

    // Create all order items
    await tx.orderItems.createMany({
      data: items.map(item => ({
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        price: item.price
      }))
    })

    // Update inventory
    for (const item of items) {
      await tx.products.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } }
      })
    }

    return order
  })

  // All-or-nothing: either all writes succeed or all rollback
})
```

**Example HIGH**:
```python
# services/transfer.py - HIGH: Missing transaction for money transfer!
def transfer_money(from_account_id, to_account_id, amount):
    # Read balances
    from_account = accounts.get(from_account_id)
    to_account = accounts.get(to_account_id)

    if from_account.balance < amount:
        raise InsufficientFunds()

    # Debit from source - SEPARATE WRITE!
    accounts.update(from_account_id, {
        'balance': from_account.balance - amount
    })

    # Credit to destination - SEPARATE WRITE!
    accounts.update(to_account_id, {
        'balance': to_account.balance + amount
    })

    # If crash between writes: money disappears (from debited, to not credited)!
```

**Fix**:
```python
def transfer_money(from_account_id, to_account_id, amount):
    with db.transaction():
        # Read with FOR UPDATE lock
        from_account = accounts.select_for_update().get(from_account_id)
        to_account = accounts.select_for_update().get(to_account_id)

        if from_account.balance < amount:
            raise InsufficientFunds()

        # Both updates in same transaction
        accounts.update(from_account_id, {
            'balance': from_account.balance - amount
        })

        accounts.update(to_account_id, {
            'balance': to_account.balance + amount
        })

        # Automatically commits if no exception, rolls back on error
```

## 2. Race Conditions and Lost Updates

**What to look for**:

- **Read-modify-write without locking**: Reading value, computing new value, writing (lost updates)
- **Increment/decrement without atomic operations**: `count = count + 1` split across reads/writes
- **Check-then-act patterns**: Checking condition then acting (condition may change)
- **Missing optimistic locking**: No version field or timestamp for conflict detection
- **Missing pessimistic locking**: No `SELECT FOR UPDATE` for critical reads
- **Concurrent updates to same record**: Multiple requests modifying same data

**Examples**:

**Example BLOCKER**:
```typescript
// src/api/inventory.ts - BLOCKER: Race condition on stock updates!
app.post('/api/purchase', async (req, res) => {
  const { productId, quantity } = req.body

  // Read current stock
  const product = await db.products.findUnique({
    where: { id: productId }
  })

  // Check if enough stock (CHECK)
  if (product.stock < quantity) {
    return res.status(400).json({ error: 'Out of stock' })
  }

  // Update stock (ACT)
  await db.products.update({
    where: { id: productId },
    data: { stock: product.stock - quantity }
  })

  // RACE CONDITION:
  // Request A reads stock=10
  // Request B reads stock=10
  // Request A checks 10 >= 5, passes
  // Request B checks 10 >= 8, passes
  // Request A writes stock=5
  // Request B writes stock=2
  // Expected: stock=10-5-8=-3 (oversold!)
  // Actual: stock=2 (lost update from A!)
})
```

**Fix Option 1** - Atomic operation:
```typescript
app.post('/api/purchase', async (req, res) => {
  const { productId, quantity } = req.body

  try {
    // Atomic decrement with check constraint
    const product = await db.products.update({
      where: {
        id: productId,
        stock: { gte: quantity }  // Only update if enough stock
      },
      data: {
        stock: { decrement: quantity }
      }
    })

    res.json({ success: true })
  } catch (error) {
    // Update failed because stock < quantity
    res.status(400).json({ error: 'Out of stock' })
  }
})
```

**Fix Option 2** - Pessimistic locking:
```typescript
app.post('/api/purchase', async (req, res) => {
  const { productId, quantity } = req.body

  await db.$transaction(async (tx) => {
    // Lock row for update
    const product = await tx.$queryRaw`
      SELECT * FROM products WHERE id = ${productId} FOR UPDATE
    `

    if (product.stock < quantity) {
      throw new Error('Out of stock')
    }

    await tx.products.update({
      where: { id: productId },
      data: { stock: product.stock - quantity }
    })
  })
})
```

**Fix Option 3** - Optimistic locking:
```typescript
// Add version column to products table
app.post('/api/purchase', async (req, res) => {
  const { productId, quantity } = req.body

  let retries = 3
  while (retries--) {
    const product = await db.products.findUnique({
      where: { id: productId }
    })

    if (product.stock < quantity) {
      return res.status(400).json({ error: 'Out of stock' })
    }

    // Update only if version hasn't changed
    const updated = await db.products.updateMany({
      where: {
        id: productId,
        version: product.version  // Optimistic lock check
      },
      data: {
        stock: product.stock - quantity,
        version: { increment: 1 }
      }
    })

    if (updated.count > 0) {
      return res.json({ success: true })
    }

    // Version changed, retry
  }

  res.status(409).json({ error: 'Conflict, please retry' })
})
```

## 3. Missing Idempotency for Retries

**What to look for**:

- **No idempotency keys**: Retry-able operations without deduplication
- **Duplicate record creation**: POST endpoints without idempotency checks
- **Duplicate payment processing**: Charging credit cards multiple times on retry
- **Duplicate messages**: Queue consumers reprocessing same message
- **No idempotent writes**: Operations that create different outcomes on retry

**Examples**:

**Example HIGH**:
```typescript
// src/api/payments.ts - HIGH: No idempotency for payment!
app.post('/api/payments', async (req, res) => {
  const { orderId, amount, cardToken } = req.body

  // Charge credit card
  const charge = await stripe.charges.create({
    amount,
    currency: 'usd',
    source: cardToken
  })

  // Record payment
  await db.payments.create({
    orderId,
    amount,
    stripeChargeId: charge.id,
    status: 'completed'
  })

  // If response fails to reach client, client retries
  // Result: Charged twice, two payment records!
})
```

**Fix**:
```typescript
app.post('/api/payments', async (req, res) => {
  const { orderId, amount, cardToken, idempotencyKey } = req.body

  // Check if already processed
  const existing = await db.payments.findUnique({
    where: { idempotencyKey }
  })

  if (existing) {
    // Return cached response
    return res.json(existing)
  }

  // Charge with idempotency key
  const charge = await stripe.charges.create({
    amount,
    currency: 'usd',
    source: cardToken,
    idempotency_key: idempotencyKey  // Stripe deduplicates
  })

  // Record payment with idempotency key
  const payment = await db.payments.create({
    data: {
      orderId,
      amount,
      stripeChargeId: charge.id,
      status: 'completed',
      idempotencyKey  // Unique constraint prevents duplicates
    }
  })

  res.json(payment)

  // Retry is safe: returns cached result, no duplicate charge
})
```

**Example HIGH**:
```python
# workers/email_worker.py - HIGH: Duplicate emails on retry!
def send_welcome_email(user_id):
    user = users.get(user_id)

    # Send email
    sendgrid.send_email(
        to=user.email,
        subject='Welcome!',
        body='Welcome to our platform'
    )

    # If worker crashes before ACK: message redelivered, email sent again!
```

**Fix**:
```python
def send_welcome_email(user_id, message_id):
    # Check if already processed
    if processed_messages.exists(message_id):
        return  # Already sent

    user = users.get(user_id)

    # Send email with idempotency
    sendgrid.send_email(
        to=user.email,
        subject='Welcome!',
        body='Welcome to our platform',
        custom_args={'message_id': message_id}  # Deduplication
    )

    # Mark as processed
    processed_messages.add(message_id)

    # Retry is safe: skips if already processed
```

## 4. Invariant Violations

**What to look for**:

- **Business rules not enforced**: Balances go negative, ages become invalid
- **Missing check constraints**: Database allows invalid states
- **Application-level validation only**: Constraints not in database
- **Denormalized data out of sync**: Totals don't match detail sums
- **Foreign key violations**: References to deleted records
- **Uniqueness violations**: Duplicate entries where uniqueness required

**Examples**:

**Example HIGH**:
```typescript
// src/api/accounts.ts - HIGH: Balance can go negative!
app.post('/api/withdraw', async (req, res) => {
  const { accountId, amount } = req.body

  const account = await db.accounts.findUnique({
    where: { id: accountId }
  })

  // Application check only - not reliable!
  if (account.balance < amount) {
    return res.status(400).json({ error: 'Insufficient funds' })
  }

  // Race condition: balance could have decreased
  await db.accounts.update({
    where: { id: accountId },
    data: { balance: { decrement: amount } }
  })

  // Possible outcome: balance = -$500 (integrity violation!)
})
```

**Fix - Database constraint**:
```sql
-- migration: add check constraint
ALTER TABLE accounts
ADD CONSTRAINT balance_non_negative CHECK (balance >= 0);
```

```typescript
app.post('/api/withdraw', async (req, res) => {
  const { accountId, amount } = req.body

  try {
    await db.$transaction(async (tx) => {
      const account = await tx.accounts.findUnique({
        where: { id: accountId }
      })

      if (account.balance < amount) {
        throw new Error('Insufficient funds')
      }

      await tx.accounts.update({
        where: { id: accountId },
        data: { balance: { decrement: amount } }
      })
    })

    res.json({ success: true })
  } catch (error) {
    // Database constraint violation caught
    if (error.code === '23514') {  // CHECK constraint
      res.status(400).json({ error: 'Insufficient funds' })
    }
    throw error
  }
})
```

**Example MED**:
```typescript
// src/api/orders.ts - MED: Denormalized total out of sync!
app.patch('/api/orders/:id/items/:itemId', async (req, res) => {
  const { id, itemId } = req.params
  const { quantity } = req.body

  // Update order item
  await db.orderItems.update({
    where: { id: itemId },
    data: { quantity }
  })

  // BUG: Forgot to update order.total!
  // Now: order.total != SUM(orderItems.price * quantity)
})
```

**Fix - Recompute denormalized data**:
```typescript
app.patch('/api/orders/:id/items/:itemId', async (req, res) => {
  const { id, itemId } = req.params
  const { quantity } = req.body

  await db.$transaction(async (tx) => {
    // Update item
    await tx.orderItems.update({
      where: { id: itemId },
      data: { quantity }
    })

    // Recompute total from items
    const items = await tx.orderItems.findMany({
      where: { orderId: id }
    })

    const total = items.reduce((sum, item) => {
      return sum + (item.price * item.quantity)
    }, 0)

    // Update denormalized total
    await tx.orders.update({
      where: { id },
      data: { total }
    })
  })
})
```

## 5. Partial Failures and Inconsistency

**What to look for**:

- **No compensation for failed steps**: Saga pattern without compensating transactions
- **Distributed operations without coordination**: Writes to multiple systems without 2PC
- **No cleanup on error**: Partial writes left in database
- **Ignored error responses**: Errors from external services not handled
- **Best-effort delivery**: Critical operations without retry/confirmation

**Examples**:

**Example BLOCKER**:
```typescript
// src/api/users.ts - BLOCKER: User created even if email fails!
app.post('/api/signup', async (req, res) => {
  const { email, password, name } = req.body

  // Create user in database
  const user = await db.users.create({
    data: { email, password: hashPassword(password), name }
  })

  // Send welcome email (external service)
  try {
    await sendgrid.send({
      to: email,
      subject: 'Welcome!',
      body: `Hi ${name}, welcome!`
    })
  } catch (error) {
    // Email failed but user already created!
    // User exists but never got welcome email with verification link
    console.error('Email failed:', error)
  }

  res.json(user)
})
```

**Fix - Saga pattern with compensation**:
```typescript
app.post('/api/signup', async (req, res) => {
  const { email, password, name } = req.body
  let user

  try {
    // Create user
    user = await db.users.create({
      data: {
        email,
        password: hashPassword(password),
        name,
        status: 'pending_verification'  // Not fully active yet
      }
    })

    // Send welcome email
    await sendgrid.send({
      to: email,
      subject: 'Welcome!',
      body: `Hi ${name}, please verify your email`
    })

    // Mark as verified email sent
    await db.users.update({
      where: { id: user.id },
      data: { emailSent: true }
    })

    res.json(user)
  } catch (error) {
    // Compensate: delete partially created user
    if (user) {
      await db.users.delete({
        where: { id: user.id }
      })
    }

    res.status(500).json({ error: 'Signup failed' })
  }
})
```

## 6. Eventual Consistency Without Conflict Resolution

**What to look for**:

- **Last-write-wins without consideration**: Concurrent updates lose data
- **No vector clocks or causal ordering**: Can't detect concurrent updates
- **Missing conflict resolution**: Distributed writes without merge strategy
- **Read-your-writes violations**: User doesn't see their own updates
- **Stale reads**: Reading old data after recent write

**Examples**:

**Example MED**:
```typescript
// src/api/profiles.ts - MED: Last-write-wins loses data!
// With eventual consistency (e.g., DynamoDB, Cassandra)
app.patch('/api/profiles/:id', async (req, res) => {
  const { id } = req.params
  const updates = req.body

  // Simple write - no conflict detection
  await dynamodb.update({
    TableName: 'Profiles',
    Key: { id },
    UpdateExpression: 'SET #name = :name, #bio = :bio',
    ExpressionAttributeNames: {
      '#name': 'name',
      '#bio': 'bio'
    },
    ExpressionAttributeValues: {
      ':name': updates.name,
      ':bio': updates.bio
    }
  })

  // Concurrent updates:
  // User edits name in Tab A
  // User edits bio in Tab B
  // Tab A writes: name='Alice', bio='old bio'
  // Tab B writes: name='old name', bio='new bio'
  // Result: Either name or bio update lost!
})
```

**Fix - Version-based conflict detection**:
```typescript
app.patch('/api/profiles/:id', async (req, res) => {
  const { id } = req.params
  const { name, bio, version } = req.body  // Client sends version

  try {
    await dynamodb.update({
      TableName: 'Profiles',
      Key: { id },
      UpdateExpression: 'SET #name = :name, #bio = :bio, #version = :newVersion',
      ConditionExpression: '#version = :expectedVersion',  // Optimistic lock
      ExpressionAttributeNames: {
        '#name': 'name',
        '#bio': 'bio',
        '#version': 'version'
      },
      ExpressionAttributeValues: {
        ':name': name,
        ':bio': bio,
        ':expectedVersion': version,
        ':newVersion': version + 1
      }
    })

    res.json({ success: true })
  } catch (error) {
    if (error.code === 'ConditionalCheckFailedException') {
      // Version conflict - someone else updated
      res.status(409).json({
        error: 'Conflict detected',
        message: 'Profile was modified by another request'
      })
    }
    throw error
  }
})
```

## 7. Cascading Deletes and Orphaned Data

**What to look for**:

- **Deletes without cascade**: Parent deleted, children orphaned
- **Missing foreign key constraints**: References to deleted records
- **Soft deletes not propagated**: Parent soft-deleted, children still active
- **No cleanup jobs**: Orphaned data accumulates over time

**Examples**:

**Example HIGH**:
```typescript
// src/api/users.ts - HIGH: Orphaned data on user deletion!
app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params

  // Delete user
  await db.users.delete({
    where: { id }
  })

  // BUG: Orphaned data left behind:
  // - user_sessions still in database
  // - user_preferences still in database
  // - user_orders reference deleted user
  // - user_uploads in S3 not deleted
})
```

**Fix - Cascade delete**:
```typescript
app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params

  await db.$transaction(async (tx) => {
    // Delete related records first
    await tx.userSessions.deleteMany({ where: { userId: id } })
    await tx.userPreferences.deleteMany({ where: { userId: id } })
    await tx.userNotifications.deleteMany({ where: { userId: id } })

    // Update orders (keep for audit, but mark user as deleted)
    await tx.orders.updateMany({
      where: { userId: id },
      data: { userId: null, userDeleted: true }
    })

    // Delete user
    await tx.users.delete({ where: { id } })
  })

  // Queue S3 cleanup
  await queue.publish('cleanup-user-uploads', { userId: id })

  res.json({ success: true })
})
```

**Better - Database-level cascade**:
```sql
-- migration: add cascading foreign keys
ALTER TABLE user_sessions
ADD CONSTRAINT fk_user
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_preferences
ADD CONSTRAINT fk_user
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
```

## 8. Time-Based Data Integrity Issues

**What to look for**:

- **Using client time**: Trusting client-provided timestamps
- **Clock skew**: Distributed systems with unsynchronized clocks
- **Time zone issues**: Storing local time instead of UTC
- **Backdated records**: Created records with past timestamps
- **No audit trail**: Changes without `created_at`, `updated_at`, `updated_by`

**Examples**:

**Example MED**:
```typescript
// src/api/posts.ts - MED: Using client timestamp!
app.post('/api/posts', async (req, res) => {
  const { title, body, createdAt } = req.body  // Client-provided timestamp!

  await db.posts.create({
    data: {
      title,
      body,
      createdAt: new Date(createdAt)  // Trusting client time
    }
  })

  // Client can backdate posts, mess up sort order, bypass rate limits
})
```

**Fix**:
```typescript
app.post('/api/posts', async (req, res) => {
  const { title, body } = req.body

  await db.posts.create({
    data: {
      title,
      body,
      createdAt: new Date()  // Server time only
    }
  })
})
```

## 9. Duplicate Detection Failures

**What to look for**:

- **Missing unique constraints**: Allows duplicate emails, usernames, etc.
- **Race conditions on uniqueness checks**: Check-then-insert pattern
- **Unique constraints on wrong fields**: Constraint on normalized instead of original
- **No deduplication for imports**: Bulk imports create duplicates

**Examples**:

**Example HIGH**:
```typescript
// src/api/users.ts - HIGH: Race condition on email uniqueness!
app.post('/api/users', async (req, res) => {
  const { email, name } = req.body

  // Check if email exists
  const existing = await db.users.findUnique({
    where: { email }
  })

  if (existing) {
    return res.status(400).json({ error: 'Email already in use' })
  }

  // Create user
  await db.users.create({
    data: { email, name }
  })

  // RACE: Two requests with same email can both pass the check
  // Result: Duplicate emails in database
})
```

**Fix - Unique constraint**:
```sql
-- migration: add unique constraint
ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
```

```typescript
app.post('/api/users', async (req, res) => {
  const { email, name } = req.body

  try {
    await db.users.create({
      data: { email, name }
    })

    res.json({ success: true })
  } catch (error) {
    if (error.code === '23505') {  // Unique violation
      res.status(400).json({ error: 'Email already in use' })
    }
    throw error
  }
})
```

## 10. State Machine Violations

**What to look for**:

- **Invalid state transitions**: Order goes from 'pending' to 'shipped' without 'confirmed'
- **Missing state validation**: Application allows invalid states
- **No state transition audit**: Can't trace state changes
- **Concurrent state transitions**: Two processes updating state simultaneously

**Examples**:

**Example HIGH**:
```typescript
// src/api/orders.ts - HIGH: Invalid state transition allowed!
app.patch('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params
  const { status } = req.body

  // No validation of state transition!
  await db.orders.update({
    where: { id },
    data: { status }
  })

  // Allows invalid transitions:
  // 'pending' -> 'delivered' (skips 'confirmed', 'shipped')
  // 'cancelled' -> 'confirmed' (can't un-cancel)
  // 'delivered' -> 'pending' (backwards)
})
```

**Fix - State machine validation**:
```typescript
const VALID_TRANSITIONS = {
  'pending': ['confirmed', 'cancelled'],
  'confirmed': ['shipped', 'cancelled'],
  'shipped': ['delivered'],
  'delivered': [],  // Terminal state
  'cancelled': []   // Terminal state
}

app.patch('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params
  const { status: newStatus } = req.body

  await db.$transaction(async (tx) => {
    const order = await tx.orders.findUnique({
      where: { id }
    })

    // Validate transition
    const allowedTransitions = VALID_TRANSITIONS[order.status]
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(`Invalid transition: ${order.status} -> ${newStatus}`)
    }

    // Update with audit trail
    await tx.orders.update({
      where: { id },
      data: { status: newStatus }
    })

    await tx.orderStatusHistory.create({
      data: {
        orderId: id,
        oldStatus: order.status,
        newStatus,
        changedBy: req.user.id,
        changedAt: new Date()
      }
    })
  })

  res.json({ success: true })
})
```

# WORKFLOW

## Step 1: Determine review scope

```bash
if [ "$SCOPE" = "pr" ]; then
  TARGET_REF="${TARGET:-HEAD}"
  BASE_REF="origin/main"
elif [ "$SCOPE" = "worktree" ]; then
  TARGET_REF="worktree"
fi
```

## Step 2: Identify data models and schemas

```bash
# Find database models
find . -name "models.py" -o -name "schema.prisma" -o -name "*.model.ts"

# Find migrations
find . -name "migrations/" -o -name "*.sql"

# Check for schema changes
git diff $BASE_REF -- "*.sql" "*.prisma" "models/"
```

## Step 3: Find transaction boundaries

```bash
# SQL transactions
grep -r "BEGIN\|COMMIT\|ROLLBACK\|transaction" --include="*.ts" --include="*.py" --include="*.go"

# ORM transactions
grep -r "\$transaction\|with.*transaction\|db\.transaction" --include="*.ts" --include="*.py"

# Check for missing transactions in multi-step writes
grep -B 5 -A 10 "create\|update\|delete" --include="*.ts" | grep -v "transaction"
```

## Step 4: Check for race conditions

```bash
# Read-modify-write patterns
grep -r "findUnique\|findOne\|get" --include="*.ts" -A 10 | grep "update\|set"

# Increment/decrement operations
grep -r "increment\|decrement\|\+\+\|--" --include="*.ts" --include="*.py"

# Check-then-act patterns
grep -r "if.*\(balance\|stock\|count\)" --include="*.ts" -A 5 | grep "update\|create"
```

## Step 5: Review locking strategies

```bash
# Pessimistic locking
grep -r "FOR UPDATE\|select_for_update\|lock" --include="*.ts" --include="*.py" --include="*.sql"

# Optimistic locking
grep -r "version\|etag\|updated_at.*WHERE" --include="*.ts" --include="*.py"

# Check for missing locking on concurrent updates
grep -r "concurrent\|parallel\|race" --include="*.ts" --include="*.py"
```

## Step 6: Check idempotency

```bash
# Idempotency keys
grep -r "idempotency\|dedup\|request.*id" --include="*.ts" --include="*.py"

# Retry logic
grep -r "retry\|retries\|attempt" --include="*.ts" --include="*.py" -A 5

# Check POST endpoints for duplicate prevention
grep -r "app\.post\|@Post\|post.*=>" --include="*.ts" -A 10 | grep -v "idempotency"
```

## Step 7: Validate invariants

```bash
# Check constraints
grep -r "CHECK\|CONSTRAINT" --include="*.sql" --include="*.prisma"

# Find validation logic
grep -r "validate\|invariant\|constraint" --include="*.ts" --include="*.py"

# Look for business rule checks
grep -r "balance.*>=\|stock.*>\|age.*<" --include="*.ts" --include="*.py"
```

## Step 8: Review cascade deletes

```bash
# Find delete operations
grep -r "\.delete\|DELETE FROM" --include="*.ts" --include="*.py" --include="*.sql"

# Check foreign key constraints
grep -r "FOREIGN KEY\|references\|@relation" --include="*.sql" --include="*.prisma"

# Look for orphaned data cleanup
grep -r "cascade\|orphan\|cleanup" --include="*.ts" --include="*.py"
```

## Step 9: Generate integrity review report

Create `.claude/<SESSION_SLUG>/reviews/review-data-integrity-<YYYY-MM-DD>.md` with findings.

## Step 10: Update session README

```bash
echo "- [Data Integrity Review](reviews/review-data-integrity-$(date +%Y-%m-%d).md)" >> .claude/<SESSION_SLUG>/README.md
```

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-data-integrity-<YYYY-MM-DD>.md`:

```markdown
---
command: /review:data-integrity
session_slug: <SESSION_SLUG>
scope: <SCOPE>
target: <TARGET>
completed: <YYYY-MM-DD>
---

# Data Integrity Review

**Scope:** <Description>
**Reviewer:** Claude Data Integrity Review Agent
**Date:** <YYYY-MM-DD>

## Summary

<Overview of data integrity issues found>

**Severity Breakdown:**
- BLOCKER: <count> (missing transactions, race conditions on money)
- HIGH: <count> (lost updates, missing idempotency, invariant violations)
- MED: <count> (eventual consistency issues, missing cascades)
- LOW: <count> (audit trail gaps, minor timing issues)

**Merge Recommendation:** <BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>

---

## Findings

### Finding 1: <Title> [BLOCKER]

**Location:** `<file>:<line>`

**Issue:**
<Description of integrity violation>

**Evidence:**
```<language>
<code showing the issue>
```

**Impact:**
<What data corruption or inconsistency can occur>

**Scenario:**
<Step-by-step scenario showing how integrity is violated>

**Fix:**
```<language>
<corrected code with proper integrity guarantees>
```

---

## Critical Invariants Check

**Identified Invariants:**
1. <Invariant 1> - Status: ✅ Enforced / ❌ Violated
2. <Invariant 2> - Status: ✅ Enforced / ❌ Violated

**Violations Found:**
- <File>:<line> - <invariant> not enforced

---

## Transaction Analysis

**Multi-Step Operations:** <count>
**Missing Transactions:** <count>
**Proper Transactions:** <count>

| Operation | Location | Has Transaction? | Risk Level |
|-----------|----------|------------------|------------|
| Order creation | orders.ts:45 | ❌ No | BLOCKER |
| Money transfer | payments.ts:123 | ✅ Yes | OK |

---

## Recommendations

1. **Immediate Actions (BLOCKER/HIGH)**:
   - <Action 1>
   - <Action 2>

2. **Short-term Improvements (MED)**:
   - <Action 1>

3. **Long-term Hardening (LOW)**:
   - <Action 1>
```

# SUMMARY OUTPUT

```markdown
# Data Integrity Review Complete

## Review Location
Saved to: `.claude/<SESSION_SLUG>/reviews/review-data-integrity-<YYYY-MM-DD>.md`

## Merge Recommendation
**<BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>**

## Critical Issues

### BLOCKERS (<count>):
- <file>:<line> - <description>

### HIGH (<count>):
- <file>:<line> - <description>

## Integrity Risk Summary
- **Missing Transactions:** <count>
- **Race Conditions:** <count>
- **Missing Idempotency:** <count>
- **Invariant Violations:** <count>

## Next Actions
1. <Immediate action>
2. <Follow-up required>
```
