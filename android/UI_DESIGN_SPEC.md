# Trails App - UI Design Specification
## Settings & Authentication Screens

**Version:** 1.0
**Last Updated:** November 17, 2025
**Design System:** Material Design 3 (Material You)

---

## Table of Contents
1. [Design Principles](#design-principles)
2. [Color & Typography](#color--typography)
3. [Component Library](#component-library)
4. [Settings Screen](#settings-screen)
5. [Authentication Screen](#authentication-screen)
6. [Interaction Patterns](#interaction-patterns)
7. [Accessibility](#accessibility)
8. [Implementation Notes](#implementation-notes)

---

## Design Principles

### Core Philosophy
The Trails app follows a **clean, content-first design** that prioritizes:
- **Clarity**: Clear visual hierarchy and straightforward navigation
- **Consistency**: Unified patterns across all screens
- **Efficiency**: Quick access to common actions
- **Accessibility**: WCAG 2.1 AA compliance

### Design Language
Based on analysis of ArticleListScreen and ArticleDetailScreen:
- **Material Design 3** with dynamic theming support
- **Vertical rhythm** using consistent 8dp grid system
- **Generous white space** for breathing room
- **Subtle animations** for state transitions
- **Progressive disclosure** to avoid overwhelming users

---

## Color & Typography

### Color System (Material 3)

```kotlin
// Color Roles
colorScheme.primary          // Brand color, key actions
colorScheme.onPrimary        // Text on primary
colorScheme.surface          // Background surfaces
colorScheme.onSurface        // Primary text
colorScheme.onSurfaceVariant // Secondary text, labels
colorScheme.error            // Error states
colorScheme.outline          // Borders, dividers
```

**Usage Guidelines:**
- **Primary**: Action buttons, selected states, brand elements
- **Surface**: Screen backgrounds, cards, dialogs
- **OnSurface**: Primary text content (87% opacity)
- **OnSurfaceVariant**: Secondary text, hints (60% opacity)
- **Error**: Destructive actions, error messages

### Typography Scale

```kotlin
// Typography Hierarchy
displayMedium     // App title, hero text (45sp)
titleLarge        // Screen titles (22sp)
titleMedium       // Section headers (16sp)
labelMedium       // Category labels, ALL CAPS (12sp)
bodyLarge         // Primary body text (16sp)
bodyMedium        // Secondary text, values (14sp)
titleSmall        // Supporting text (14sp)
```

**Implementation:**
```kotlin
Text(
    text = "Settings",
    style = MaterialTheme.typography.titleLarge,
    fontWeight = FontWeight.Bold
)
```

---

## Component Library

### Observed Patterns from Existing Screens

#### 1. **Buttons**

```kotlin
// Primary Action
Button(
    onClick = { /* action */ },
    modifier = Modifier
        .fillMaxWidth()
        .height(48.dp)
) {
    Text("Primary Action")
}

// Secondary Action
OutlinedButton(
    onClick = { /* action */ },
    modifier = Modifier
        .fillMaxWidth()
        .height(48.dp)
) {
    Text("Secondary Action")
}

// Tertiary Action
FilledTonalButton(
    onClick = { /* action */ },
    modifier = Modifier
        .fillMaxWidth()
        .padding(vertical = 8.dp)
) {
    Text("Tertiary Action")
}

// Low Emphasis
TextButton(
    onClick = { /* action */ },
    modifier = Modifier.height(48.dp)
) {
    Text("Text Action")
}
```

**Standards:**
- **Height**: 48dp (minimum touch target)
- **Width**: fullMaxWidth for primary actions
- **Padding**: 8dp vertical spacing between stacked buttons

#### 2. **Settings Rows**

```kotlin
// Standard Setting Row (observed pattern)
Row(
    modifier = Modifier
        .fillMaxWidth()
        .height(48.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween
) {
    Text(
        text = "Setting Label",
        style = MaterialTheme.typography.bodyLarge
    )
    // Control (Switch, Text, etc.)
}
```

**Standards:**
- **Height**: 48dp minimum
- **Padding**: 16dp horizontal (inherited from parent)
- **Label**: bodyLarge, onSurface color
- **Value**: bodyMedium, onSurfaceVariant color

#### 3. **Section Headers**

```kotlin
// Section Divider Pattern
HorizontalDivider()
Spacer(Modifier.height(8.dp))
Text(
    "SECTION NAME",
    style = MaterialTheme.typography.labelMedium,
    color = MaterialTheme.colorScheme.onSurfaceVariant
)
Spacer(Modifier.height(4.dp))
```

**Standards:**
- **Typography**: labelMedium, ALL CAPS
- **Top Spacing**: 8dp after divider
- **Bottom Spacing**: 4dp before content
- **Color**: onSurfaceVariant

#### 4. **Input Fields**

```kotlin
TextField(
    value = state,
    onValueChange = { /* update */ },
    modifier = Modifier.fillMaxWidth(),
    placeholder = { Text("Placeholder") },
    supportingText = {
        Text(
            text = "Helper text",
            style = MaterialTheme.typography.titleSmall
        )
    }
)
```

#### 5. **Navigation Components**

```kotlin
// Bottom Navigation (from ArticleListScreen)
NavigationBar(
    modifier = Modifier
        .wrapContentHeight(Alignment.Bottom)
        .windowInsetsPadding(WindowInsets.navigationBars),
    containerColor = MaterialTheme.colorScheme.surface
) {
    NavigationBarItem(
        selected = isSelected,
        onClick = { /* navigate */ },
        icon = { Icon(...) },
        label = { Text("Label") }
    )
}

// Tab Navigation (from ArticleDetailScreen)
PrimaryTabRow(
    selectedTabIndex = selectedIndex,
    containerColor = MaterialTheme.colorScheme.surface
) {
    Tab(
        selected = isSelected,
        onClick = { /* switch tab */ },
        icon = { Icon(...) }
    )
}
```

---

## Settings Screen

### Layout Structure

```
┌─────────────────────────────────┐
│ Screen Title                    │  ← titleLarge
├─────────────────────────────────┤
│                                 │
│ ┌─ SECTION HEADER ─────────┐   │  ← labelMedium (ALL CAPS)
│ │                           │   │
│ │  Setting Row 1            │   │  ← 48dp height
│ │  Setting Row 2            │   │
│ │  Action Button            │   │
│ └───────────────────────────┘   │
│                                 │
│ ┌─ SECTION HEADER ─────────┐   │
│ │                           │   │
│ │  Setting Row 1            │   │
│ │  Setting Row 2            │   │
│ └───────────────────────────┘   │
│                                 │
└─────────────────────────────────┘
```

### Current Implementation Analysis

**Strengths:**
✅ Clear section organization with dividers
✅ Consistent 48dp row heights
✅ Good use of Typography hierarchy
✅ Proper color semantics (error for errors, primary for success)
✅ Real-time sync status with visual indicators
✅ Responsive to user account state (guest vs. authenticated)

**Areas for Enhancement:**

1. **Add Screen Title**
```kotlin
Column(modifier = modifier.padding(16.dp)) {
    Text(
        text = "Settings",
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(bottom = 16.dp)
    )
    // ... rest of content
}
```

2. **Improve Section Spacing**
```kotlin
// Add bottom padding to sections
Column(modifier = Modifier.padding(bottom = 16.dp)) {
    // Section content
}
```

3. **Add Loading States**
```kotlin
// For account operations
if (viewStore.state.isUpgrading) {
    CircularProgressIndicator(
        modifier = Modifier.size(16.dp),
        strokeWidth = 2.dp
    )
}
```

### Detailed Section Specifications

#### Account Section
```kotlin
// User Info Row
Row(
    modifier = Modifier
        .fillMaxWidth()
        .height(48.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween
) {
    Text(
        text = "Email",
        style = MaterialTheme.typography.bodyLarge
    )
    Text(
        text = userEmail,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
}

// Guest Account Indicator
Row(
    modifier = Modifier
        .fillMaxWidth()
        .height(48.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween
) {
    Text("Account Type")
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(
            Icons.Outlined.Info,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = "Guest",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
```

**States:**
- **Authenticated**: Show email, hide upgrade button
- **Guest**: Show "Guest" label, show upgrade button
- **Loading**: Show progress indicator
- **Error**: Show error message with retry option

#### Appearance Section
```kotlin
// Dark Mode Toggle
Row(
    modifier = Modifier
        .fillMaxWidth()
        .height(48.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween
) {
    Column(modifier = Modifier.weight(1f)) {
        Text(
            text = "Dark mode",
            style = MaterialTheme.typography.bodyLarge
        )
        Text(
            text = "Use dark theme across the app",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
    Switch(
        checked = darkTheme,
        onCheckedChange = { updateDarkTheme(it) }
    )
}
```

**Options:**
- Dark mode toggle (with description)
- Card layout toggle (with description)
- Font size selection (future)
- Language selection (future)

#### Sync Section
```kotlin
// Sync Status with Multiple States
Row(
    modifier = Modifier
        .fillMaxWidth()
        .height(48.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween
) {
    Text("Status")
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Animated indicator for syncing state
        AnimatedVisibility(visible = isSyncing) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp
            )
        }

        // Status text with semantic colors
        Text(
            text = syncStatusText,
            style = MaterialTheme.typography.bodyMedium,
            color = when (syncStatus) {
                is SyncStatus.Error -> MaterialTheme.colorScheme.error
                is SyncStatus.Success -> MaterialTheme.colorScheme.primary
                else -> MaterialTheme.colorScheme.onSurfaceVariant
            }
        )
    }
}

// Expandable Error Details
AnimatedVisibility(visible = syncStatus is SyncStatus.Error) {
    Text(
        text = errorDetails,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.error,
        modifier = Modifier.padding(start = 16.dp, top = 4.dp)
    )
}
```

**States:**
- **Idle**: Gray text, no indicator
- **Syncing**: Blue text, animated progress indicator
- **Success**: Primary color, checkmark icon (optional)
- **Error**: Error color, expandable details

### Interaction Patterns

#### 1. **Account Upgrade Flow**
```
Guest User Sees:
┌──────────────────────────┐
│ Account Type    Guest    │
│ [Upgrade to Full Account]│
└──────────────────────────┘
         ↓
    User Taps
         ↓
┌──────────────────────────┐
│ Google Sign-In Dialog    │
└──────────────────────────┘
         ↓
    Success
         ↓
┌──────────────────────────┐
│ Email    user@gmail.com  │
│ [Logout]                 │
└──────────────────────────┘
```

#### 2. **Sync Flow**
```
User taps "Sync Now"
         ↓
Button disabled, text changes to "Syncing..."
Progress indicator appears
         ↓
Success: Status shows "Synced X articles"
  - Green/primary color
  - Button re-enabled
  - Last sync time updates
         ↓
Error: Status shows error message
  - Red/error color
  - Expandable details
  - Button re-enabled for retry
```

---

## Authentication Screen

### Layout Structure

```
┌─────────────────────────────────┐
│                                 │
│                                 │
│         [App Logo/Icon]         │  ← Optional
│                                 │
│           Trails               │  ← displayMedium
│                                 │
│   Your personal article        │  ← bodyLarge
│      companion                  │
│                                 │
│                                 │
│  ┌─────────────────────────┐   │
│  │  Sign In with Google    │   │  ← Button (48dp)
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │
│  │  Continue as Guest      │   │  ← OutlinedButton (48dp)
│  └─────────────────────────┘   │
│                                 │
│                                 │
└─────────────────────────────────┘
```

### Current Implementation Analysis

**Strengths:**
✅ Clean, centered layout
✅ Clear visual hierarchy
✅ Simple two-option authentication
✅ Proper button hierarchy (Primary vs Secondary)
✅ Multiple state handling (SignedOut, Loading, Error, SignedIn)
✅ Consistent with Material Design patterns

**Areas for Enhancement:**

1. **Add App Branding**
```kotlin
// Add app icon/illustration
Icon(
    painter = painterResource(R.drawable.ic_app_logo),
    contentDescription = "Trails logo",
    modifier = Modifier.size(80.dp),
    tint = MaterialTheme.colorScheme.primary
)
```

2. **Enhance Error State**
```kotlin
// More actionable error messaging
Surface(
    modifier = Modifier
        .fillMaxWidth()
        .padding(16.dp),
    color = MaterialTheme.colorScheme.errorContainer,
    shape = MaterialTheme.shapes.medium
) {
    Row(
        modifier = Modifier.padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(
            Icons.Outlined.Warning,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error
        )
        Column {
            Text(
                text = "Authentication Failed",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.error
            )
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer
            )
        }
    }
}
```

3. **Add Loading State Animation**
```kotlin
// Animated loading state
AnimatedVisibility(
    visible = state is AuthUiState.Loading,
    enter = fadeIn() + expandVertically(),
    exit = fadeOut() + shrinkVertically()
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        CircularProgressIndicator()
        Text("Signing you in...")
    }
}
```

### Detailed State Specifications

#### SignedOut State (Default)
```kotlin
Box(
    modifier = Modifier
        .fillMaxSize()
        .padding(32.dp),
    contentAlignment = Alignment.Center
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // App Icon (optional)
        Icon(
            painter = painterResource(R.drawable.ic_app_logo),
            contentDescription = "Trails",
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        Spacer(Modifier.height(8.dp))

        // App Title
        Text(
            text = "Trails",
            style = MaterialTheme.typography.displayMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary
        )

        // Tagline
        Text(
            text = "Your personal article companion",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(24.dp))

        // Primary Action: Google Sign-In
        Button(
            onClick = { launchGoogleSignIn() },
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_google),
                contentDescription = null,
                modifier = Modifier.size(18.dp)
            )
            Spacer(Modifier.width(8.dp))
            Text("Sign In with Google")
        }

        // Secondary Action: Guest
        OutlinedButton(
            onClick = { signInAnonymously() },
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
        ) {
            Text("Continue as Guest")
        }

        Spacer(Modifier.height(16.dp))

        // Privacy Policy / Terms (optional)
        Text(
            text = "By continuing, you agree to our Terms of Service and Privacy Policy",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 16.dp)
        )
    }
}
```

#### Loading State
```kotlin
Box(
    modifier = Modifier.fillMaxSize(),
    contentAlignment = Alignment.Center
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Brand consistency even during loading
        Text(
            text = "Trails",
            style = MaterialTheme.typography.displayMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary
        )

        CircularProgressIndicator()

        Text(
            text = "Signing you in...",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
```

#### Error State
```kotlin
Box(
    modifier = Modifier
        .fillMaxSize()
        .padding(32.dp),
    contentAlignment = Alignment.Center
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Brand consistency
        Text(
            text = "Trails",
            style = MaterialTheme.typography.displayMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary
        )

        Spacer(Modifier.height(8.dp))

        // Error Container
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.errorContainer,
            shape = MaterialTheme.shapes.medium
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    Icons.Outlined.Warning,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(48.dp)
                )

                Text(
                    text = "Authentication Failed",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.error
                )

                Text(
                    text = errorMessage,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    textAlign = TextAlign.Center
                )
            }
        }

        Spacer(Modifier.height(8.dp))

        // Retry Actions
        Button(
            onClick = { launchGoogleSignIn() },
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
        ) {
            Text("Retry with Google")
        }

        OutlinedButton(
            onClick = { signInAnonymously() },
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
        ) {
            Text("Continue as Guest Instead")
        }
    }
}
```

### Interaction Patterns

#### 1. **Google Sign-In Flow**
```
User taps "Sign In with Google"
         ↓
Loading state appears (circular progress)
         ↓
Google Sign-In dialog shows
         ↓
User selects account
         ↓
     Success ─────────→ Navigate to main app
         │
     Failure ──────→ Show error state
                     Allow retry or guest fallback
```

#### 2. **Guest Sign-In Flow**
```
User taps "Continue as Guest"
         ↓
Loading state appears
         ↓
Anonymous auth completes
         ↓
Navigate to main app
(Show upgrade prompt in Settings)
```

#### 3. **Auto-Login Flow**
```
App Launch
     ↓
Check auth state
     ↓
Signed In? ──Yes──→ Navigate to main app
     │
     No
     ↓
Show Auth Screen
```

---

## Interaction Patterns

### Shared Patterns Across Screens

#### 1. **Touch Feedback**
```kotlin
// All clickable elements must have visual feedback
Button/IconButton/etc:
  - Material ripple effect (default)
  - State layer opacity changes
  - Elevation changes on press (for elevated buttons)

Clickable():
  - Use Modifier.clickable { } for custom clickables
  - Includes ripple by default
  - Consider indication parameter for custom feedback
```

#### 2. **State Transitions**
```kotlin
// Use AnimatedVisibility for appearing/disappearing UI
AnimatedVisibility(
    visible = shouldShow,
    enter = fadeIn() + expandVertically(),
    exit = fadeOut() + shrinkVertically()
) {
    // Content
}

// Use AnimatedContent for state changes
AnimatedContent(
    targetState = currentState,
    transitionSpec = {
        fadeIn() togetherWith fadeOut()
    }
) { state ->
    // Content based on state
}
```

#### 3. **Loading States**
```kotlin
// Inline loading (for buttons)
Button(
    onClick = { /* action */ },
    enabled = !isLoading
) {
    if (isLoading) {
        CircularProgressIndicator(
            modifier = Modifier.size(16.dp),
            strokeWidth = 2.dp,
            color = MaterialTheme.colorScheme.onPrimary
        )
        Spacer(Modifier.width(8.dp))
    }
    Text(if (isLoading) "Loading..." else "Action")
}

// Full-screen loading
Box(
    modifier = Modifier.fillMaxSize(),
    contentAlignment = Alignment.Center
) {
    CircularProgressIndicator()
}

// Progress bar (determinate)
LinearProgressIndicator(
    progress = { progress },
    modifier = Modifier.fillMaxWidth()
)
```

#### 4. **Error Handling**
```kotlin
// Error Surface Pattern
Surface(
    modifier = Modifier
        .fillMaxWidth()
        .padding(16.dp),
    color = MaterialTheme.colorScheme.errorContainer,
    shape = MaterialTheme.shapes.medium
) {
    Row(
        modifier = Modifier.padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top
    ) {
        Icon(
            Icons.Outlined.Warning,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error
        )
        Column(
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = "Error Title",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.error
            )
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer
            )
        }
    }
}
```

---

## Accessibility

### Touch Targets
- **Minimum**: 48dp × 48dp (Material Design requirement)
- **Buttons**: 48dp height minimum
- **Icon buttons**: 48dp × 48dp minimum
- **Spacing**: 8dp minimum between targets

### Content Descriptions
```kotlin
// Icons must have contentDescription
Icon(
    Icons.Default.Settings,
    contentDescription = "Settings"  // ✅ Good
)

Icon(
    Icons.Default.Decorative,
    contentDescription = null  // ✅ Good for decorative icons
)

// Avoid
Icon(
    Icons.Default.Settings
    // ❌ Missing contentDescription
)
```

### Semantic Structure
```kotlin
// Use semantic roles
Button(...)  // Automatically has button role
Switch(...)  // Automatically has switch role

// For custom clickables, specify semantics
Modifier.clickable(
    role = Role.Button,
    onClickLabel = "Sign in with Google"
) { /* action */ }
```

### Color Contrast
- **Normal text**: Minimum 4.5:1 contrast ratio
- **Large text** (≥18pt or ≥14pt bold): Minimum 3:1
- **UI components**: Minimum 3:1 against background
- **Material 3 colors**: Pre-validated for WCAG AA compliance

### Dynamic Type Support
```kotlin
// Use MaterialTheme.typography
Text(
    text = "Content",
    style = MaterialTheme.typography.bodyLarge
    // ✅ Respects user font size settings
)

// Avoid hardcoded text sizes
Text(
    text = "Content",
    fontSize = 16.sp
    // ❌ Doesn't scale with user preferences
)
```

### Screen Reader Support
```kotlin
// Meaningful labels for actions
Button(
    onClick = { /* sync */ },
    modifier = Modifier.semantics {
        contentDescription = "Sync articles now. Last sync: 5 minutes ago"
    }
) {
    Text("Sync Now")
}

// Group related content
Column(
    modifier = Modifier.semantics(mergeDescendants = true) { }
) {
    Text("Email")
    Text("user@example.com")
    // Screen reader announces: "Email: user@example.com"
}
```

---

## Implementation Notes

### State Management (Tartlet MVVM)
```kotlin
// ViewStore pattern from existing screens
@Composable
fun SettingsScreen(
    viewStore: ViewStore<SettingsState, SettingsEvent, SettingsViewModel>
        = rememberViewStore { hiltViewModel() }
) {
    // Read state
    val isDarkTheme = viewStore.state.darkTheme

    // Dispatch actions
    Switch(
        checked = isDarkTheme,
        onCheckedChange = { viewStore.action { updateDarkTheme(it) } }
    )

    // Handle events
    viewStore.handle<SettingsEvent.ShowToast> { event ->
        // Show toast/snackbar
        snackbarHostState.showSnackbar(event.message)
    }
}
```

### Window Insets
```kotlin
// Handle system bars properly
Column(
    modifier = Modifier
        .fillMaxSize()
        .windowInsetsPadding(WindowInsets.systemBars)
) {
    // Content
}

// For navigation bars
NavigationBar(
    modifier = Modifier.windowInsetsPadding(WindowInsets.navigationBars)
) {
    // Nav items
}
```

### Preview Support
```kotlin
// Light theme preview
@Preview(name = "Settings • Light", showBackground = true)
@Composable
private fun SettingsScreenPreview() {
    TrailsTheme(darkTheme = false) {
        SettingsScreen(
            viewStore = ViewStore {
                SettingsState(/* preview data */)
            }
        )
    }
}

// Dark theme preview
@Preview(
    name = "Settings • Dark",
    showBackground = true,
    uiMode = Configuration.UI_MODE_NIGHT_YES
)
@Composable
private fun SettingsScreenDarkPreview() {
    TrailsTheme(darkTheme = true) {
        SettingsScreen(
            viewStore = ViewStore {
                SettingsState(/* preview data */)
            }
        )
    }
}

// Different states
@Preview(name = "Auth • Error State", showBackground = true)
@Composable
private fun AuthScreenErrorPreview() {
    TrailsTheme {
        AuthScreen(
            viewStore = ViewStore {
                AuthUiState.Error(Exception("Network error"))
            }
        )
    }
}
```

### Theme Configuration
```kotlin
// From TrailsTheme
@Composable
fun TrailsTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context)
            else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
```

---

## Spacing Reference

### Standard Spacing Scale
```kotlin
// Based on 8dp grid system
4.dp   // Tight spacing, within components
8.dp   // Small spacing, related items
12.dp  // Medium spacing, list items
16.dp  // Standard padding, content padding
24.dp  // Large spacing, section separation
32.dp  // Extra large, screen edges
48.dp  // Touch target minimum height
```

### Component Heights
```kotlin
48.dp  // Minimum touch target (buttons, rows)
56.dp  // App bar, navigation items
64.dp  // Extended touch targets
```

### Common Patterns
```kotlin
// Section spacing
HorizontalDivider()
Spacer(Modifier.height(8.dp))
SectionHeader(...)
Spacer(Modifier.height(4.dp))
Content(...)

// Button spacing
Button(...)
Spacer(Modifier.height(8.dp))
Button(...)

// Content padding
Column(
    modifier = Modifier.padding(16.dp)
) {
    // Content
}
```

---

## Component Sizes Reference

### Icons
```kotlin
16.dp  // Small icon (in-line with text, indicators)
18.dp  // Standard icon in buttons
24.dp  // Standard icon (default)
48.dp  // Large icon (app logo, error icons)
80.dp  // Extra large (splash/auth screens)
```

### Progress Indicators
```kotlin
// Small (inline)
CircularProgressIndicator(
    modifier = Modifier.size(16.dp),
    strokeWidth = 2.dp
)

// Medium (standard)
CircularProgressIndicator(
    modifier = Modifier.size(24.dp),
    strokeWidth = 3.dp
)

// Large (full screen loading)
CircularProgressIndicator(
    modifier = Modifier.size(48.dp),
    strokeWidth = 4.dp
)
```

---

## Design Checklist

### Settings Screen
- [ ] Screen title present and styled correctly
- [ ] Sections clearly separated with dividers
- [ ] Section headers use labelMedium, ALL CAPS
- [ ] All rows are 48dp minimum height
- [ ] Spacing follows 8dp grid
- [ ] Color semantics correct (error, primary, surface variants)
- [ ] Loading states for async operations
- [ ] Error states with clear messaging
- [ ] Touch targets ≥48dp
- [ ] Content descriptions for icons
- [ ] Previews for light and dark themes
- [ ] Multiple states previewed (guest, authenticated, syncing, error)

### Auth Screen
- [ ] Centered layout with proper spacing
- [ ] App branding visible (logo/title)
- [ ] Clear visual hierarchy
- [ ] Primary/secondary button distinction
- [ ] Loading state implemented
- [ ] Error state with actionable feedback
- [ ] Proper padding (32dp edges)
- [ ] Touch targets ≥48dp
- [ ] Content descriptions
- [ ] All states have previews
- [ ] Animations for state transitions
- [ ] Privacy policy link (if required)

### Universal
- [ ] Material 3 design system
- [ ] Dark theme support
- [ ] Dynamic color support (Android 12+)
- [ ] Proper window insets handling
- [ ] WCAG AA contrast compliance
- [ ] TalkBack/screen reader tested
- [ ] RTL layout support (if applicable)
- [ ] Tablet/large screen support
- [ ] Consistent with existing screens

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-17 | Initial design specification based on ArticleListScreen and ArticleDetailScreen analysis |

---

## References

- [Material Design 3 Guidelines](https://m3.material.io/)
- [Compose Material 3 Documentation](https://developer.android.com/jetpack/compose/designsystems/material3)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Android Accessibility](https://developer.android.com/guide/topics/ui/accessibility)

---

**End of Document**