# App-scope coroutine scope and DI conventions

This document explains the coroutine scope conventions for background work in the
Android client, so a developer adding a feature that needs a long-lived coroutine
knows which scope to use and why.

---

## The `@ApplicationScope` scope

`AppScopeModule` (`common/di/AppScopeModule.kt`) provides a `@Singleton`
`CoroutineScope` qualified by `@ApplicationScope`:

```kotlin
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class ApplicationScope

@Module
@InstallIn(SingletonComponent::class)
object AppScopeModule {
    @Provides
    @Singleton
    @ApplicationScope
    fun provideApplicationScope(
        @Dispatcher(TrailsDispatchers.IO) ioDispatcher: CoroutineDispatcher
    ): CoroutineScope = CoroutineScope(SupervisorJob() + ioDispatcher)
}
```

This scope lives in `SingletonComponent` — it is created with the app process
and never cancelled programmatically. Inject it with `@ApplicationScope`:

```kotlin
@Singleton
class FirestoreSyncManager @Inject constructor(
    @ApplicationScope private val scope: CoroutineScope,
    ...
)
```

---

## Why `SupervisorJob()`

A bare `CoroutineScope(dispatcher)` — with no explicit `Job` — uses a regular
`Job` as its root. When **any** child coroutine throws an uncaught exception, the
`Job` is cancelled and every sibling coroutine is also cancelled. For a singleton
scope that is never replaced, this means one failing launch silently kills all
future launches for the remaining process lifetime.

`SupervisorJob()` isolates child failures: a failing child is cancelled without
cancelling its siblings or the parent scope. This is the correct choice for any
long-lived application-level scope.

---

## When to use `@ApplicationScope` vs `viewModelScope`

| Scenario | Scope to use |
|---|---|
| Work tied to a ViewModel's lifecycle (UI state, user interaction, data needed only while a screen is visible) | `viewModelScope` |
| Background sync, Firestore write, Room insert that must survive ViewModel destruction | `@ApplicationScope` |
| One-shot work inside a `WorkManager` worker | The worker's own coroutine scope (provided by `CoroutineWorker.coroutineContext`) |

**Rule of thumb:** if the work must complete even if the user navigates away from
the screen that triggered it, use `@ApplicationScope`.

---

## `cleanup()` must not cancel the shared scope

`FirestoreSyncManager.cleanup()` previously called `scope.cancel()` on a
private ad-hoc scope. Now that the scope is `@ApplicationScope @Singleton`:

- Cancelling it in `cleanup()` would permanently kill all future `scope.launch {}`
  calls in `FirestoreSyncManager`, `ArticleRepositoryImpl`, and any other
  `@ApplicationScope` consumer — for the remaining process lifetime.
- `cleanup()` is intentionally reduced to a no-op comment:
  ```kotlin
  fun cleanup() {
      cancelPeriodicSync()
      // scope is @ApplicationScope @Singleton — do NOT cancel it here
  }
  ```

---

## Anti-pattern: constructing an unmanaged scope in a `@Singleton`

Do **not** write this in a `@Singleton` class:

```kotlin
// Bad — unmanaged scope, no lifecycle awareness, no shared supervision
private val scope = CoroutineScope(ioDispatcher)
private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
```

These create scopes with no owner. They are never cancelled on logout or
process exit (memory leak), and they do not participate in shared supervision —
a failure in one does not propagate correctly. Inject `@ApplicationScope
CoroutineScope` instead.
