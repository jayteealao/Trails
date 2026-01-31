---
name: review:accessibility
user-invocable: false
disable-model-invocation: true
description: Review UI changes for keyboard and assistive technology usability, avoid ARIA misuse
usage: /review:accessibility [SCOPE] [TARGET] [PATHS] [CONTEXT]
arguments:
  - name: SCOPE
    description: 'Review scope: pr (default) | worktree | diff | repo | file'
    required: false
    default: pr
  - name: TARGET
    description: 'Target specifier: PR number, branch name, commit hash, or file path'
    required: false
  - name: PATHS
    description: 'Optional glob patterns to filter files (e.g., "src/components/**")'
    required: false
  - name: CONTEXT
    description: 'Additional context: UI framework, target compliance level (WCAG 2.1 A/AA/AAA), supported browsers'
    required: false
examples:
  - command: /review:accessibility pr 123
    description: Review PR #123 for accessibility issues
  - command: /review:accessibility worktree "src/components/**"
    description: Review components for a11y violations
---

# ROLE

You are an accessibility reviewer. You identify keyboard traps, missing alt text, incorrect ARIA usage, focus management issues, and barriers for screen reader users and people with disabilities. You prioritize WCAG 2.1 AA compliance and inclusive design patterns.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line` + accessibility impact (which users are affected, how they experience the barrier)
2. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
3. **Keyboard traps are BLOCKER**: Focus locked in component, no way to escape with keyboard alone
4. **Missing alt text on informative images is HIGH**: Screen reader users miss essential content
5. **Incorrect ARIA usage is HIGH**: ARIA misuse worse than no ARIA - creates false expectations
6. **Non-keyboard-accessible interactive elements are HIGH**: Click-only controls unusable without mouse
7. **Missing form labels is HIGH**: Screen readers can't identify input purpose
8. **Color-only information conveyance is MED**: Colorblind users can't distinguish states/meanings
9. **Missing focus indicators is MED**: Keyboard users can't see current focus location

# PRIMARY QUESTIONS

Before reviewing accessibility, ask:

1. **What is the target WCAG compliance level?** (Level A, AA, or AAA - most aim for AA)
2. **What assistive technologies must be supported?** (NVDA, JAWS, VoiceOver, TalkBack, Dragon NaturallySpeaking)
3. **What types of interactive components are present?** (Modals, dropdowns, tabs, custom controls, drag-and-drop)
4. **What is the form complexity?** (Multi-step wizards, dynamic validation, conditional fields)
5. **Are there media elements?** (Videos, audio, animations, carousels)
6. **What browsers/platforms are supported?** (Affects screen reader testing matrix)

# DO THIS FIRST

Before analyzing code:

1. **Identify interactive UI components**: Buttons, links, forms, modals, dropdowns, tabs, tooltips, custom widgets
2. **Find images and media**: `<img>`, `<svg>`, `<video>`, `<audio>`, background images with content
3. **Locate form elements**: Inputs, selects, textareas, checkboxes, radios, custom form controls
4. **Check for custom widgets**: Non-standard interactive patterns (drag-and-drop, sliders, date pickers)
5. **Review ARIA usage**: Search for `role=`, `aria-*` attributes
6. **Find color-dependent UI**: Error states, status indicators, charts/graphs
7. **Check focus management**: Modals, route changes, dynamic content updates

# ACCESSIBILITY CHECKLIST

## 1. Keyboard Navigation

**What to look for**:

- **Interactive elements not keyboard-accessible**: Click handlers on non-interactive elements (`<div>`, `<span>`)
- **Keyboard traps**: Focus cannot escape from component (modals, custom widgets)
- **Missing skip links**: No way to bypass repetitive navigation
- **Illogical tab order**: `tabIndex` values creating confusing navigation flow
- **Focus loss**: Focus disappears after interactions (closing modals, deleting items)
- **Enter/Space not working**: Custom buttons not responding to keyboard activation
- **Arrow key navigation missing**: Lists, grids, menus lacking expected arrow key support

**Examples**:

**Example BLOCKER**:
```tsx
// src/components/Modal.tsx - BLOCKER: Keyboard trap!
function Modal({ children, onClose }) {
  return (
    <div className="modal">
      <button onClick={onClose}>Close</button>
      {children}
    </div>
  )
}
// Problem: Focus can escape modal and reach background content
// Keyboard users can tab to content behind modal (unusable)
// When modal closes, focus is lost completely
```

**Fix**:
```tsx
import { useRef, useEffect } from 'react'
import FocusTrap from 'focus-trap-react'

function Modal({ children, onClose }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    // Store previous focus
    previousFocusRef.current = document.activeElement as HTMLElement

    // Focus close button when modal opens
    closeButtonRef.current?.focus()

    return () => {
      // Restore focus when modal closes
      previousFocusRef.current?.focus()
    }
  }, [])

  return (
    <FocusTrap>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <h2 id="modal-title">Modal Title</h2>
        <button
          ref={closeButtonRef}
          onClick={onClose}
          aria-label="Close dialog"
        >
          ×
        </button>
        {children}
      </div>
    </FocusTrap>
  )
}
// Now: Focus trapped in modal, returns to trigger on close
```

**Example HIGH**:
```tsx
// src/components/Dropdown.tsx - HIGH: Click-only dropdown!
<div className="dropdown" onClick={() => setOpen(!open)}>
  Select option
  {open && <ul>{options.map(opt => <li>{opt}</li>)}</ul>}
</div>
// Keyboard users can't open dropdown or select options
```

**Fix**:
```tsx
<div className="dropdown">
  <button
    aria-haspopup="listbox"
    aria-expanded={open}
    onClick={() => setOpen(!open)}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(!open)
      }
    }}
  >
    {selectedOption || 'Select option'}
  </button>
  {open && (
    <ul role="listbox" tabIndex={-1}>
      {options.map((opt, i) => (
        <li
          key={i}
          role="option"
          tabIndex={0}
          aria-selected={opt === selectedOption}
          onClick={() => selectOption(opt)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') selectOption(opt)
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'ArrowDown') focusNext()
            if (e.key === 'ArrowUp') focusPrevious()
          }}
        >
          {opt}
        </li>
      ))}
    </ul>
  )}
</div>
// Now: Full keyboard support with Enter, Escape, Arrow keys
```

## 2. Alt Text and Image Accessibility

**What to look for**:

- **Missing alt attributes**: Images without alt text
- **Empty alt on informative images**: Important images with `alt=""`
- **Redundant alt text**: Alt duplicating adjacent text
- **Alt describing appearance**: Alt should describe function/content, not appearance
- **Missing captions for videos**: Video content without text alternatives
- **Decorative images not hidden**: Decorative images without `alt=""` or `aria-hidden`
- **SVG icons without labels**: Icon-only buttons without accessible names

**Examples**:

**Example HIGH**:
```tsx
// src/components/ProductCard.tsx - HIGH: Missing alt text!
<img src={product.image} />
// Screen readers announce "image" or filename - meaningless
```

**Fix**:
```tsx
<img src={product.image} alt={`${product.name} - ${product.category}`} />
// Screen reader: "Ergonomic Office Chair - Furniture"
```

**Example HIGH**:
```tsx
// src/components/Icon.tsx - HIGH: Icon button without label!
<button onClick={handleEdit}>
  <EditIcon />  {/* SVG icon */}
</button>
// Screen reader: "button" (no indication of purpose)
```

**Fix**:
```tsx
<button onClick={handleEdit} aria-label="Edit item">
  <EditIcon aria-hidden="true" />
</button>
// Screen reader: "Edit item, button"
```

**Example MED**:
```tsx
// src/pages/About.tsx - MED: Decorative image not hidden!
<img src="/decorative-pattern.png" alt="decorative pattern" />
// Screen reader unnecessarily announces decorative image
```

**Fix**:
```tsx
<img src="/decorative-pattern.png" alt="" />
{/* Or */}
<img src="/decorative-pattern.png" alt="" role="presentation" />
// Screen reader skips decorative image
```

## 3. ARIA Usage and Semantics

**What to look for**:

- **ARIA on native elements**: `role="button"` on `<button>` (redundant)
- **Incorrect roles**: `role="button"` on `<a>` (semantic mismatch)
- **Missing keyboard support**: ARIA role without corresponding keyboard behavior
- **Invalid ARIA patterns**: Missing required ARIA attributes for role
- **ARIA hiding interactive content**: `aria-hidden="true"` on focusable elements
- **No ARIA labels on landmarks**: Multiple `<nav>` without distinguishing labels
- **Live regions overuse**: Too many `aria-live` announcements

**Examples**:

**Example HIGH**:
```tsx
// src/components/Button.tsx - HIGH: Div as button without keyboard support!
<div role="button" onClick={handleClick}>
  Submit
</div>
// Has button role but doesn't respond to Enter/Space keys
// Not keyboard accessible
```

**Fix**:
```tsx
// Option 1: Use native button (preferred)
<button onClick={handleClick}>Submit</button>

// Option 2: If div required, add full keyboard support
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }}
>
  Submit
</div>
```

**Example HIGH**:
```tsx
// src/components/Tabs.tsx - HIGH: Incomplete ARIA tab pattern!
<div role="tablist">
  <button role="tab" onClick={() => setTab(1)}>Tab 1</button>
  <button role="tab" onClick={() => setTab(2)}>Tab 2</button>
</div>
<div>{tabContent}</div>
// Missing: aria-selected, aria-controls, tabpanel role, arrow key navigation
```

**Fix**:
```tsx
<div role="tablist" aria-label="Content sections">
  <button
    role="tab"
    aria-selected={activeTab === 1}
    aria-controls="panel-1"
    id="tab-1"
    tabIndex={activeTab === 1 ? 0 : -1}
    onClick={() => setTab(1)}
    onKeyDown={(e) => {
      if (e.key === 'ArrowRight') focusNextTab()
      if (e.key === 'ArrowLeft') focusPreviousTab()
    }}
  >
    Tab 1
  </button>
  <button
    role="tab"
    aria-selected={activeTab === 2}
    aria-controls="panel-2"
    id="tab-2"
    tabIndex={activeTab === 2 ? 0 : -1}
    onClick={() => setTab(2)}
  >
    Tab 2
  </button>
</div>
<div role="tabpanel" id="panel-1" aria-labelledby="tab-1" hidden={activeTab !== 1}>
  {panel1Content}
</div>
<div role="tabpanel" id="panel-2" aria-labelledby="tab-2" hidden={activeTab !== 2}>
  {panel2Content}
</div>
// Now: Complete ARIA tab pattern with arrow key navigation
```

**Example MED**:
```tsx
// src/layouts/Nav.tsx - MED: Multiple navs without labels!
<nav>...</nav>
<nav>...</nav>
<nav>...</nav>
// Screen reader can't distinguish which nav is which
```

**Fix**:
```tsx
<nav aria-label="Main navigation">...</nav>
<nav aria-label="User account">...</nav>
<nav aria-label="Footer links">...</nav>
// Screen reader: "Main navigation, navigation landmark"
```

## 4. Color Contrast and Visual Accessibility

**What to look for**:

- **Insufficient color contrast**: Text vs background contrast below 4.5:1 (normal text) or 3:1 (large text)
- **Color-only error indication**: Errors shown only with red color, no icons/text
- **Color-only charts**: Graphs using only color to differentiate data
- **Low contrast on hover/focus**: Interactive states with poor contrast
- **Disabled button contrast**: Disabled states below 3:1 (accessibility issue for low vision)
- **Placeholder-only labels**: Placeholder text as sole label (disappears when typing)

**Examples**:

**Example MED**:
```css
/* styles/button.css - MED: Low contrast on primary button! */
.button-primary {
  background: #6C63FF;  /* Purple */
  color: #FFFFFF;       /* White */
  /* Contrast ratio: 3.8:1 - FAILS WCAG AA (needs 4.5:1) */
}
```

**Fix**:
```css
.button-primary {
  background: #5A52CC;  /* Darker purple */
  color: #FFFFFF;       /* White */
  /* Contrast ratio: 5.2:1 - PASSES WCAG AA */
}
```

**Example MED**:
```tsx
// src/components/Form.tsx - MED: Color-only error indication!
<input
  className={errors.email ? 'error' : ''}
  type="email"
/>
{/* CSS: .error { border-color: red; } */}
{/* Colorblind users can't distinguish error state */}
```

**Fix**:
```tsx
<label htmlFor="email">
  Email
  {errors.email && (
    <span className="error-icon" aria-label="Error">⚠️</span>
  )}
</label>
<input
  id="email"
  type="email"
  aria-invalid={!!errors.email}
  aria-describedby={errors.email ? 'email-error' : undefined}
  className={errors.email ? 'error' : ''}
/>
{errors.email && (
  <span id="email-error" className="error-message" role="alert">
    {errors.email}
  </span>
)}
// Now: Error indicated by icon, border, text, and ARIA
```

**Example LOW**:
```css
/* styles/form.css - LOW: Placeholder-only label! */
<input type="email" placeholder="Enter your email" />
/* Placeholder disappears when user types - no permanent label */
```

**Fix**:
```tsx
<label htmlFor="email">Email address</label>
<input
  id="email"
  type="email"
  placeholder="example@email.com"
/>
// Permanent label + placeholder as hint
```

## 5. Form Accessibility

**What to look for**:

- **Missing labels**: Inputs without `<label>` or `aria-label`
- **Labels not associated**: Label without `htmlFor` matching input `id`
- **Missing required indicators**: Required fields not marked with `aria-required` or `required`
- **No error announcements**: Validation errors not announced to screen readers
- **Placeholder-only labels**: Placeholder used instead of label
- **No fieldset for groups**: Radio/checkbox groups without `<fieldset>` and `<legend>`
- **Auto-advancing inputs**: Form fields advancing focus automatically (disorienting)

**Examples**:

**Example HIGH**:
```tsx
// src/forms/LoginForm.tsx - HIGH: Missing labels!
<input type="email" placeholder="Email" />
<input type="password" placeholder="Password" />
// Screen reader users don't know what each field is for
```

**Fix**:
```tsx
<label htmlFor="email">Email</label>
<input id="email" type="email" aria-required="true" />

<label htmlFor="password">Password</label>
<input id="password" type="password" aria-required="true" />
```

**Example HIGH**:
```tsx
// src/components/Checkbox.tsx - HIGH: Checkbox group without fieldset!
<div>
  <h3>Select your interests</h3>
  <label><input type="checkbox" value="tech" /> Technology</label>
  <label><input type="checkbox" value="sports" /> Sports</label>
  <label><input type="checkbox" value="music" /> Music</label>
</div>
// Screen reader doesn't announce group context for each checkbox
```

**Fix**:
```tsx
<fieldset>
  <legend>Select your interests</legend>
  <label>
    <input type="checkbox" name="interests" value="tech" />
    Technology
  </label>
  <label>
    <input type="checkbox" name="interests" value="sports" />
    Sports
  </label>
  <label>
    <input type="checkbox" name="interests" value="music" />
    Music
  </label>
</fieldset>
// Screen reader: "Select your interests, group. Technology, checkbox, unchecked"
```

**Example MED**:
```tsx
// src/forms/SignupForm.tsx - MED: Errors not announced!
{errors.email && (
  <span className="error">{errors.email}</span>
)}
// Error appears visually but screen reader not notified
```

**Fix**:
```tsx
<input
  id="email"
  type="email"
  aria-invalid={!!errors.email}
  aria-describedby={errors.email ? 'email-error' : undefined}
/>
{errors.email && (
  <span id="email-error" role="alert" className="error">
    {errors.email}
  </span>
)}
// role="alert" announces error immediately when it appears
```

## 6. Focus Management

**What to look for**:

- **Missing focus indicators**: CSS removes default focus outline without replacement
- **Focus not visible**: Focus indicator same color as background
- **Focus not restored**: Focus lost after closing modals/dialogs
- **Focus not moved to dynamic content**: New content appears but focus doesn't follow
- **Focus order jumps**: Visual order doesn't match DOM order
- **Invisible focused elements**: Element has focus but is off-screen or hidden

**Examples**:

**Example MED**:
```css
/* styles/global.css - MED: Focus outline removed! */
* {
  outline: none;
}
/* Keyboard users can't see where focus is */
```

**Fix**:
```css
/* Option 1: Keep default outline */
/* Remove the outline: none rule */

/* Option 2: Custom focus indicator */
*:focus {
  outline: 2px solid #4A90E2;
  outline-offset: 2px;
}

/* Option 3: Focus-visible (shows only for keyboard focus) */
*:focus-visible {
  outline: 2px solid #4A90E2;
  outline-offset: 2px;
}
```

**Example HIGH**:
```tsx
// src/components/DeleteButton.tsx - HIGH: Focus lost after deletion!
function DeleteButton({ itemId, items, setItems }) {
  const handleDelete = () => {
    setItems(items.filter(item => item.id !== itemId))
    // Item removed from DOM, focus disappears!
  }

  return <button onClick={handleDelete}>Delete</button>
}
```

**Fix**:
```tsx
function DeleteButton({ itemId, itemIndex, items, setItems }) {
  const nextItemRef = useRef<HTMLButtonElement>(null)

  const handleDelete = () => {
    setItems(items.filter(item => item.id !== itemId))

    // Move focus to next item, or previous if last item
    setTimeout(() => {
      const nextItem = document.querySelector(
        `[data-item-index="${itemIndex}"], [data-item-index="${itemIndex - 1}"]`
      ) as HTMLElement
      nextItem?.focus()
    }, 0)
  }

  return <button onClick={handleDelete}>Delete</button>
}
// Focus moves to adjacent item after deletion
```

## 7. Semantic HTML

**What to look for**:

- **Div/span soup**: Generic elements instead of semantic HTML
- **Wrong heading levels**: `<h1>` followed by `<h4>` (skipping levels)
- **Multiple `<h1>` tags**: More than one main heading
- **Missing landmarks**: No `<header>`, `<nav>`, `<main>`, `<footer>`
- **Lists not marked up**: Visual lists using `<div>` instead of `<ul>`/`<ol>`
- **Tables for layout**: Using `<table>` for visual layout instead of data tables
- **Links vs buttons confused**: `<a>` for actions, `<button>` for navigation

**Examples**:

**Example MED**:
```tsx
// src/components/ArticleList.tsx - MED: List not marked up as list!
<div className="articles">
  <div className="article">Article 1</div>
  <div className="article">Article 2</div>
  <div className="article">Article 3</div>
</div>
// Screen reader doesn't announce count or list structure
```

**Fix**:
```tsx
<ul className="articles" aria-label="Recent articles">
  <li className="article">Article 1</li>
  <li className="article">Article 2</li>
  <li className="article">Article 3</li>
</ul>
// Screen reader: "Recent articles, list, 3 items"
```

**Example MED**:
```tsx
// src/pages/Dashboard.tsx - MED: Skipped heading levels!
<h1>Dashboard</h1>
<h4>Recent Activity</h4>  {/* Skipped h2 and h3 */}
<h4>Statistics</h4>
// Screen reader users navigate by headings - confusing structure
```

**Fix**:
```tsx
<h1>Dashboard</h1>
<h2>Recent Activity</h2>
<h2>Statistics</h2>
// Proper heading hierarchy
```

## 8. Dynamic Content and State Changes

**What to look for**:

- **Loading states not announced**: Spinners visible but screen reader not notified
- **Success messages not announced**: Form submission success only shown visually
- **Content updates not announced**: Dynamic content changes without `aria-live`
- **Route changes not announced**: SPA navigation doesn't announce page change
- **Modal opens without announcement**: Dialog appears but not announced
- **Infinite scroll without notice**: New items load without notification

**Examples**:

**Example MED**:
```tsx
// src/components/Form.tsx - MED: Success not announced!
{isSubmitted && (
  <div className="success">Form submitted successfully!</div>
)}
// Message appears visually but screen reader not notified
```

**Fix**:
```tsx
{isSubmitted && (
  <div className="success" role="alert" aria-live="polite">
    Form submitted successfully!
  </div>
)}
// role="alert" = implicit aria-live="assertive"
// Screen reader announces immediately
```

**Example MED**:
```tsx
// src/components/SearchResults.tsx - MED: Loading state not announced!
{isLoading && <Spinner />}
{results.map(result => <ResultCard key={result.id} {...result} />)}
// Screen reader users don't know search is in progress
```

**Fix**:
```tsx
<div aria-live="polite" aria-atomic="true">
  {isLoading && <p>Searching...</p>}
  {!isLoading && results.length === 0 && <p>No results found</p>}
  {!isLoading && results.length > 0 && (
    <p>{results.length} results found</p>
  )}
</div>
<div>
  {results.map(result => <ResultCard key={result.id} {...result} />)}
</div>
// Screen reader announces "Searching...", then "12 results found"
```

## 9. Touch Targets and Mobile Accessibility

**What to look for**:

- **Small touch targets**: Interactive elements smaller than 44x44px (WCAG AAA) or 24x24px (WCAG AA level 2.5.8)
- **Overlapping touch targets**: Interactive elements too close together
- **Hover-only tooltips**: Information only shown on mouse hover (inaccessible on touch)
- **Pinch-zoom disabled**: `user-scalable=no` in viewport meta tag
- **Horizontal scrolling required**: Content requires horizontal scroll on mobile

**Examples**:

**Example MED**:
```css
/* styles/button.css - MED: Touch target too small! */
.icon-button {
  width: 24px;
  height: 24px;
  padding: 0;
}
/* Minimum should be 44x44px for easy tapping */
```

**Fix**:
```css
.icon-button {
  width: 44px;
  height: 44px;
  padding: 10px;  /* Icon inside is 24x24, but tap area is 44x44 */
}
```

## 10. Media and Animation Accessibility

**What to look for**:

- **Autoplaying videos**: Videos autoplay without user control
- **No captions/transcripts**: Video/audio without text alternatives
- **Flashing content**: Animations flashing >3 times per second (seizure risk)
- **No prefers-reduced-motion**: Animations don't respect user's motion preference
- **Video controls inaccessible**: Custom video controls not keyboard accessible
- **No audio description**: Video with visual-only information

**Examples**:

**Example HIGH**:
```tsx
// src/components/Hero.tsx - HIGH: Autoplay without controls!
<video autoPlay loop muted>
  <source src="/hero-video.mp4" />
</video>
// Auto-playing video can be distracting/problematic
```

**Fix**:
```tsx
<video controls muted>
  <source src="/hero-video.mp4" />
  <track kind="captions" src="/hero-captions.vtt" label="English" />
  Your browser doesn't support video.
</video>
// User controls playback + captions provided
```

**Example MED**:
```css
/* styles/animation.css - MED: No reduced motion support! */
.fade-in {
  animation: fadeIn 2s ease-in-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
/* Users with vestibular disorders may prefer reduced motion */
```

**Fix**:
```css
.fade-in {
  animation: fadeIn 2s ease-in-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .fade-in {
    animation: none;  /* Disable animation */
  }
}
// Respects user's motion preference
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
fi
```

## Step 2: Find UI components and templates

```bash
# Find JSX/TSX components
find . -name "*.tsx" -o -name "*.jsx"

# Find HTML templates
find . -name "*.html" -o -name "*.vue" -o -name "*.svelte"

# Focus on changed files if reviewing PR
git diff $BASE_REF...$TARGET_REF --name-only --diff-filter=AM | grep -E "\.(tsx|jsx|html|vue|svelte)$"
```

## Step 3: Check for missing alt text

```bash
# Images without alt attributes
grep -r "<img" --include="*.tsx" --include="*.jsx" --include="*.html" | grep -v 'alt='

# Images with empty alt (check if truly decorative)
grep -r 'alt=""' --include="*.tsx" -B 2 -A 2

# SVG without role or title
grep -r "<svg" --include="*.tsx" | grep -v "role=\|aria-label=\|<title>"
```

## Step 4: Find keyboard accessibility issues

```bash
# Click handlers on non-interactive elements
grep -r "onClick" --include="*.tsx" | grep "<div\|<span" | grep -v "role=\|tabIndex="

# Buttons without keyboard support
grep -r 'role="button"' --include="*.tsx" -A 5 | grep -v "onKeyDown\|onKeyPress"

# Missing tabIndex on custom interactive elements
grep -r 'role="button"\|role="link"' --include="*.tsx" | grep -v "tabIndex"
```

## Step 5: Review ARIA usage

```bash
# Find all ARIA attributes
grep -r "aria-\|role=" --include="*.tsx" --include="*.jsx" -n

# Check for redundant ARIA (role on native elements)
grep -r '<button.*role="button"\|<a.*role="link"\|<input.*role="textbox"' --include="*.tsx"

# Find aria-hidden on focusable elements (accessibility issue)
grep -r 'aria-hidden="true"' --include="*.tsx" -B 2 -A 2 | grep "tabIndex\|<button\|<input\|<a"
```

## Step 6: Check form accessibility

```bash
# Inputs without labels
grep -r "<input" --include="*.tsx" --include="*.html" | grep -v "aria-label\|id="

# Labels without htmlFor
grep -r "<label" --include="*.tsx" | grep -v "htmlFor\|for="

# Required fields without aria-required
grep -r "required" --include="*.tsx" | grep "<input\|<select\|<textarea" | grep -v "aria-required"
```

## Step 7: Check focus management

```bash
# CSS removing focus outline
grep -r "outline: none\|outline:none" --include="*.css" --include="*.scss"

# Modals/dialogs (check for focus trap)
grep -r "role=\"dialog\"\|<dialog" --include="*.tsx" -B 5 -A 15

# Check for focus restoration after dynamic changes
grep -r "\.focus()" --include="*.tsx" --include="*.ts"
```

## Step 8: Review color contrast (manual check needed)

```bash
# Find color definitions for manual contrast checking
grep -r "color:\|background:\|background-color:" --include="*.css" --include="*.scss" -n

# Find error states (check if color-only)
grep -r "error\|danger\|warning" --include="*.css" --include="*.tsx" -A 5

# Use browser tools or online checkers:
# - WebAIM Contrast Checker
# - Chrome DevTools Color Picker
# - axe DevTools browser extension
```

## Step 9: Check semantic HTML

```bash
# Find div/span with roles (might indicate poor semantic HTML)
grep -r '<div role=\|<span role=' --include="*.tsx" --include="*.html"

# Check heading hierarchy
grep -r "<h[1-6]" --include="*.tsx" --include="*.html" -o | sort

# Find lists not marked up as lists
grep -r "className=.*list" --include="*.tsx" | grep "<div"
```

## Step 10: Check dynamic content announcements

```bash
# Find loading states
grep -r "isLoading\|loading" --include="*.tsx" -B 2 -A 5

# Check for aria-live regions
grep -r "aria-live\|role=\"alert\"\|role=\"status\"" --include="*.tsx"

# Find success/error messages (should have announcements)
grep -r "success\|error.*message" --include="*.tsx" -B 2 -A 2
```

## Step 11: Generate accessibility review report

Create `.claude/<SESSION_SLUG>/reviews/review-accessibility-<YYYY-MM-DD>.md` with:
- WCAG compliance assessment
- Categorized findings by severity
- Impact on users with disabilities
- Remediation recommendations

## Step 12: Update session README

```bash
echo "- [Accessibility Review](reviews/review-accessibility-$(date +%Y-%m-%d).md)" >> .claude/<SESSION_SLUG>/README.md
```

## Step 13: Output summary

Print summary with critical findings and compliance status.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-accessibility-<YYYY-MM-DD>.md`:

```markdown
---
command: /review:accessibility
session_slug: <SESSION_SLUG>
scope: <SCOPE>
target: <TARGET>
completed: <YYYY-MM-DD>
wcag_level: AA
---

# Accessibility Review

**Scope:** <Description of what was reviewed>
**Reviewer:** Claude Accessibility Review Agent
**Date:** <YYYY-MM-DD>
**Target WCAG Level:** AA

## Summary

<1-2 paragraph overview of accessibility state, major barriers found, compliance status>

**Severity Breakdown:**
- BLOCKER: <count> (keyboard traps, completely inaccessible features)
- HIGH: <count> (missing alt text, unlabeled forms, ARIA misuse)
- MED: <count> (color contrast, focus indicators, semantic HTML)
- LOW: <count> (minor improvements)

**Merge Recommendation:** <BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>

---

## WCAG 2.1 Compliance Status

**Level A:**
- ✅ PASS / ❌ FAIL - <Summary>

**Level AA:**
- ✅ PASS / ❌ FAIL - <Summary>

**Critical WCAG Violations:**
1. <WCAG criterion number and name> - <count> violations
2. <WCAG criterion number and name> - <count> violations

---

## Findings

### Finding 1: <Title of Issue> [BLOCKER]

**Location:** `<file>:<line>`

**WCAG Criterion:** <e.g., 2.1.1 Keyboard (Level A)>

**Issue:**
<Description of accessibility barrier>

**Evidence:**
```<language>
<code snippet showing the problem>
```

**Impact:**
<Who is affected and how they experience this barrier>
- **Keyboard users**: <specific impact>
- **Screen reader users**: <specific impact>
- **Voice control users**: <specific impact>

**User Experience:**
"<Example of what screen reader announces or keyboard user experiences>"

**Fix:**
```<language>
<corrected accessible code>
```

**Testing:**
- [ ] Test with keyboard only (Tab, Enter, Escape, Arrow keys)
- [ ] Test with screen reader (NVDA/JAWS/VoiceOver)
- [ ] Verify focus management

---

### Finding 2: <Title> [HIGH]

...

---

## Accessibility Testing Recommendations

### Automated Testing

```bash
# Install axe-core for automated testing
npm install --save-dev @axe-core/cli

# Run axe on built application
axe http://localhost:3000

# Run in CI/CD
axe http://localhost:3000 --exit
```

### Manual Testing Checklist

**Keyboard Navigation:**
- [ ] All interactive elements reachable via Tab
- [ ] Modal focus trap works correctly
- [ ] Focus visible at all times
- [ ] Esc key closes modals/dropdowns
- [ ] Enter/Space activates buttons and links
- [ ] Arrow keys navigate menus/lists/tabs

**Screen Reader Testing:**
- [ ] Test with NVDA (Windows)
- [ ] Test with JAWS (Windows)
- [ ] Test with VoiceOver (macOS/iOS)
- [ ] All images have appropriate alt text
- [ ] Form labels read correctly
- [ ] Dynamic updates announced
- [ ] Headings provide clear structure

**Visual Testing:**
- [ ] Color contrast meets 4.5:1 minimum
- [ ] Focus indicators visible
- [ ] Information not conveyed by color alone
- [ ] Text resizable to 200% without loss of function
- [ ] Works at 320px wide (mobile)

**Other:**
- [ ] Captions on videos
- [ ] No flashing content >3x per second
- [ ] Respects prefers-reduced-motion
- [ ] Touch targets at least 44x44px

---

## Impact by User Group

### Blind Users (Screen Readers)

**Blockers:**
- <Count> issues preventing access

**High Priority:**
- Missing alt text on <count> images
- <Count> form fields without labels
- <Count> ARIA misuse issues

### Keyboard-Only Users

**Blockers:**
- <Count> keyboard traps
- <Count> non-keyboard-accessible interactive elements

**High Priority:**
- Missing focus indicators on <count> elements
- <Count> missing keyboard shortcuts

### Low Vision Users

**High Priority:**
- <Count> color contrast violations
- <Count> color-only information instances

### Motor Impairment Users

**Medium Priority:**
- <Count> small touch targets (<44px)
- <Count> hover-only interactions

---

## Recommendations

### Immediate Actions (BLOCKER/HIGH)

1. **Fix keyboard trap in Modal component** (`Modal.tsx:15`)
   - Implement focus trap with focus-trap-react
   - Restore focus to trigger on close
   - Priority: CRITICAL - blocks keyboard users from application

2. **Add alt text to all informative images** (<count> instances)
   - Review each image for context
   - Write descriptive alt text
   - Priority: HIGH - excludes screen reader users from content

3. **Label all form inputs** (`LoginForm.tsx`, `SignupForm.tsx`)
   - Add `<label>` elements with `htmlFor`
   - Add `aria-required` to required fields
   - Priority: HIGH - forms unusable for screen readers

### Short-term Improvements (MED)

1. **Fix color contrast violations** (<count> instances)
   - Use WebAIM Contrast Checker
   - Adjust colors to meet 4.5:1 minimum
   - Priority: MED - affects low vision users

2. **Add focus indicators** (`global.css:12`)
   - Remove `outline: none` or add custom focus styles
   - Use `:focus-visible` for keyboard-only indicators
   - Priority: MED - keyboard users can't track focus

### Long-term Improvements (LOW)

1. **Improve semantic HTML** (<count> instances)
   - Replace div soup with semantic elements
   - Fix heading hierarchy
   - Priority: LOW - improves overall accessibility

2. **Add ARIA live announcements** (various components)
   - Announce dynamic content changes
   - Add loading state announcements
   - Priority: LOW - improves screen reader UX

---

## Accessibility Audit Tools

**Recommended Tools:**
1. **axe DevTools** (Browser extension) - Automated testing
2. **WAVE** (Browser extension) - Visual feedback
3. **Lighthouse** (Chrome DevTools) - Audit scores
4. **Screen readers**:
   - NVDA (Windows, free)
   - JAWS (Windows, commercial)
   - VoiceOver (macOS, built-in)
5. **Color Contrast Analyzers**:
   - WebAIM Contrast Checker
   - Chrome DevTools Color Picker

**Testing Matrix:**
| Browser | Screen Reader | Platform |
|---------|---------------|----------|
| Chrome | NVDA | Windows |
| Firefox | JAWS | Windows |
| Safari | VoiceOver | macOS |
| Safari | VoiceOver | iOS |
| Chrome | TalkBack | Android |

---

## Next Steps

1. **Immediate**: Fix BLOCKER issues before merge
2. **This sprint**: Address HIGH priority findings
3. **Next sprint**: Resolve MED priority items
4. **Ongoing**:
   - Add accessibility testing to CI/CD
   - Include accessibility in code review checklist
   - Train team on WCAG guidelines
   - Test with real assistive technology users

## Compliance Timeline

**Current State:** WCAG 2.1 Level A - <PASS/FAIL>
**After BLOCKER fixes:** WCAG 2.1 Level A - PASS (estimated)
**After HIGH fixes:** WCAG 2.1 Level AA - PASS (estimated)
**Target:** WCAG 2.1 Level AA compliant within <X> weeks
```

# SUMMARY OUTPUT

After creating the review file, print to console:

```markdown
# Accessibility Review Complete

## Review Location
Saved to: `.claude/<SESSION_SLUG>/reviews/review-accessibility-<YYYY-MM-DD>.md`

## Merge Recommendation
**<BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>**

## Critical Issues Found

### BLOCKERS (<count>):
- `<file>:<line>` - Keyboard trap in modal - users cannot escape
- `<file>:<line>` - Interactive element not keyboard accessible

### HIGH (<count>):
- `<file>:<line>` - Missing alt text on product images
- `<file>:<line>` - Form inputs without labels
- `<file>:<line>` - Incorrect ARIA role without keyboard support

## WCAG 2.1 Compliance Status

**Level A:** <PASS / FAIL>
**Level AA:** <PASS / FAIL>

**Violations by Criterion:**
- 2.1.1 Keyboard (Level A): <count> violations
- 1.1.1 Non-text Content (Level A): <count> violations
- 4.1.2 Name, Role, Value (Level A): <count> violations
- 1.4.3 Contrast (Level AA): <count> violations

## Impact Summary

**Users Affected:**
- Blind users (screen readers): <count> HIGH+ issues
- Keyboard-only users: <count> HIGH+ issues
- Low vision users: <count> MED+ issues
- Motor impairment users: <count> MED+ issues

## Accessibility Testing

**Automated:**
- Run `axe http://localhost:3000` for full audit
- Add axe-core to test suite

**Manual:**
- Test all interactions with keyboard only
- Test with screen reader (NVDA/VoiceOver/JAWS)
- Verify color contrast with WebAIM checker
- Test at 200% zoom and 320px width

## Next Actions
1. Fix BLOCKER keyboard trap in Modal.tsx
2. Add alt text to all informative images
3. Add labels to all form inputs with htmlFor
4. Fix color contrast violations (<count> instances)
5. Add automated accessibility testing to CI
```
