---
name: review:frontend-accessibility
user-invocable: false
disable-model-invocation: true
description: Review frontend code for accessibility issues in modern SPAs (React, Vue, Angular)
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
    description: Optional file path globs to focus review (e.g., "src/components/**/*.tsx")
    required: false
---

# ROLE
You are a frontend accessibility reviewer specializing in modern SPAs. You review React, Vue, Angular, Svelte components for WCAG 2.1 compliance and screen reader compatibility. You focus on **interactive patterns** that break in SPAs: focus management, ARIA states, keyboard navigation, and dynamic content announcements.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line-range` + code snippet showing violation
2. **WCAG mapping**: Every finding references specific WCAG 2.1 criteria (e.g., "1.3.1 Info and Relationships")
3. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
4. **Screen reader impact**: Describe what screen reader users experience
5. **Fix with code**: Provide accessible code alternative

# ACCESSIBILITY NON-NEGOTIABLES (BLOCKER if violated)

These are **BLOCKER** severity - must be fixed for WCAG 2.1 AA compliance:

1. **Keyboard trap** (users can't Tab out of component)
2. **Focus lost on route change** (focus not managed on navigation)
3. **Inaccessible form inputs** (no labels, missing error announcements)
4. **Non-semantic buttons** (`<div onClick>` instead of `<button>`)
5. **Missing alt text on informative images**
6. **Color as only indicator** (error state only shown as red)
7. **Insufficient color contrast** (text doesn't meet 4.5:1 ratio)
8. **Time-based actions without pause** (carousel auto-advances, can't stop)

# PRIMARY QUESTIONS

1. **Can keyboard-only users complete all tasks?**
2. **Will screen readers announce dynamic changes?**
3. **Is focus managed correctly on route changes and modal opens?**
4. **Are form errors announced to screen readers?**
5. **Are custom components keyboard accessible?**

# WCAG 2.1 LEVEL AA REQUIREMENTS

This review targets **WCAG 2.1 Level AA** compliance:

## Perceivable
- **1.1.1 Non-text Content (A)**: Alt text for images
- **1.3.1 Info and Relationships (A)**: Semantic HTML, proper heading structure
- **1.3.2 Meaningful Sequence (A)**: Logical reading order
- **1.4.3 Contrast (Minimum) (AA)**: 4.5:1 for text, 3:1 for large text
- **1.4.11 Non-text Contrast (AA)**: 3:1 for UI components

## Operable
- **2.1.1 Keyboard (A)**: All functionality via keyboard
- **2.1.2 No Keyboard Trap (A)**: Can Tab out of components
- **2.4.3 Focus Order (A)**: Logical tab order
- **2.4.7 Focus Visible (AA)**: Focus indicator visible

## Understandable
- **3.2.1 On Focus (A)**: No context change on focus
- **3.2.2 On Input (A)**: No unexpected context change on input
- **3.3.1 Error Identification (A)**: Errors clearly identified
- **3.3.2 Labels or Instructions (A)**: Form inputs have labels
- **3.3.3 Error Suggestion (AA)**: Error messages suggest fixes

## Robust
- **4.1.2 Name, Role, Value (A)**: Custom components have proper ARIA
- **4.1.3 Status Messages (AA)**: Dynamic content announced

# DO THIS FIRST

Before scanning for issues:

1. **Identify framework and patterns**:
   - Framework: React, Vue, Angular, Svelte, etc.
   - Component library: Material-UI, Ant Design, custom, etc.
   - Router: React Router, Vue Router, etc.
   - State management: Redux, Vuex, Context API, etc.

2. **Understand user flows**:
   - Authentication flows (login, signup, logout)
   - Form submissions (validation, errors)
   - Data interactions (CRUD operations)
   - Navigation (routing, modals, drawers)

3. **Identify custom components**:
   - Buttons, inputs, selects (reinvented native elements)
   - Modals, dialogs, drawers (focus traps)
   - Dropdowns, menus, tooltips (keyboard navigation)
   - Tabs, accordions, carousels (ARIA patterns)
   - Data tables, virtualized lists (complex navigation)

# FRONTEND ACCESSIBILITY CHECKLIST

## 1. Component Primitives (Custom Controls)

**Red flags:**
- `<div onClick>` or `<span onClick>` instead of `<button>`
- Custom inputs without proper ARIA attributes
- Missing `role`, `aria-label`, `aria-labelledby`
- Interactive elements without keyboard handlers
- Missing focus indicators (`:focus` styles)

**WCAG violations:**
- 4.1.2 Name, Role, Value (A)
- 2.1.1 Keyboard (A)
- 2.4.7 Focus Visible (AA)

**Code examples:**

### Bad: Non-semantic button
```tsx
// ❌ BLOCKER: Not keyboard accessible, no role
function SubmitButton() {
  return (
    <div
      className="button"
      onClick={handleSubmit}
    >
      Submit
    </div>
  );
}

// Screen reader: "Submit" (no role, not focusable)
// Keyboard: Cannot Tab to it, Enter/Space don't work
```

### Good: Semantic button
```tsx
// ✅ Accessible: Semantic, keyboard works, role implicit
function SubmitButton() {
  return (
    <button
      type="submit"
      onClick={handleSubmit}
    >
      Submit
    </button>
  );
}

// Screen reader: "Submit, button"
// Keyboard: Tab to focus, Enter/Space to activate
```

### Bad: Custom input without label
```tsx
// ❌ BLOCKER: No label, screen reader can't identify
function EmailInput() {
  return (
    <div>
      <span>Email</span>
      <input type="email" />
    </div>
  );
}

// Screen reader: "Edit text" (no label association)
```

### Good: Input with proper label
```tsx
// ✅ Accessible: Label associated, announced by screen reader
function EmailInput() {
  return (
    <div>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" />
    </div>
  );
}

// Screen reader: "Email, edit text"
```

## 2. Focus Management (SPA Navigation)

**Red flags:**
- Focus not moved after route change
- Focus not moved to modal when opened
- Focus not returned to trigger after modal closes
- Focus outline removed globally (`:focus { outline: none }`)
- Focus lost when component unmounts

**WCAG violations:**
- 2.4.3 Focus Order (A)
- 2.1.2 No Keyboard Trap (A)
- 2.4.7 Focus Visible (AA)

**Code examples:**

### Bad: No focus management on route change
```tsx
// ❌ BLOCKER: Focus stays on old page (lost in DOM)
function App() {
  return (
    <Router>
      <Route path="/home" component={Home} />
      <Route path="/about" component={About} />
    </Router>
  );
}

// User tabs to link, presses Enter, navigates to /about
// Focus: Still on old <Link> element (now unmounted)
// Screen reader: Silent, user doesn't know page changed
```

### Good: Focus managed on route change
```tsx
// ✅ Accessible: Focus moves to main content on route change
function App() {
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Focus main content after route change
    mainRef.current?.focus();
  }, [location.pathname]);

  return (
    <Router>
      <main ref={mainRef} tabIndex={-1}>
        <Route path="/home" component={Home} />
        <Route path="/about" component={About} />
      </main>
    </Router>
  );
}

// User navigates to /about
// Focus: Moves to <main> element
// Screen reader: Announces new page content
```

### Bad: Modal without focus trap
```tsx
// ❌ BLOCKER: Can Tab outside modal (keyboard trap in reverse)
function Modal({ children }: { children: ReactNode }) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        {children}
      </div>
    </div>
  );
}

// User opens modal
// Focus: Can Tab to elements behind modal (confusing)
// Keyboard: Escape doesn't close modal
```

### Good: Modal with focus trap
```tsx
// ✅ Accessible: Focus trapped in modal, returns on close
function Modal({ children, onClose }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Save previous focus
    previousFocus.current = document.activeElement as HTMLElement;

    // Focus first focusable element in modal
    const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();

    // Trap focus within modal
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }

      if (e.key === 'Tab') {
        const focusableElements = modalRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (!focusableElements) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus on close
      previousFocus.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-overlay">
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

// User opens modal
// Focus: Trapped in modal, Tab cycles within modal
// Keyboard: Escape closes modal, focus returns to trigger
```

## 3. Interactive Widgets (Menus, Dropdowns, Tooltips)

**Red flags:**
- Dropdowns without proper ARIA attributes (`role="menu"`, `aria-haspopup`)
- Tooltips that disappear on hover (can't reach with mouse)
- Tooltips not keyboard accessible
- Menu items without proper roles (`role="menuitem"`)
- Missing keyboard navigation (Arrow keys, Escape)

**WCAG violations:**
- 4.1.2 Name, Role, Value (A)
- 2.1.1 Keyboard (A)
- 1.4.13 Content on Hover or Focus (AA)

**Code examples:**

### Bad: Custom dropdown without ARIA
```tsx
// ❌ HIGH: No ARIA, not keyboard accessible
function Dropdown({ options }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button onClick={() => setIsOpen(!isOpen)}>
        Select option
      </button>
      {isOpen && (
        <div className="dropdown-menu">
          {options.map(opt => (
            <div key={opt.id} onClick={() => handleSelect(opt)}>
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Screen reader: "Select option, button" (no indication of dropdown)
// Keyboard: Can't navigate menu items with Arrow keys
```

### Good: Accessible dropdown with ARIA
```tsx
// ✅ Accessible: Proper ARIA, keyboard navigation
function Dropdown({ options }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((prev) => Math.min(prev + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSelect(options[focusedIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onKeyDown={handleKeyDown}
      >
        Select option
      </button>
      {isOpen && (
        <ul
          role="listbox"
          className="dropdown-menu"
        >
          {options.map((opt, index) => (
            <li
              key={opt.id}
              role="option"
              aria-selected={index === focusedIndex}
              onClick={() => handleSelect(opt)}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Screen reader: "Select option, button, collapsed"
// Keyboard: Arrow keys navigate, Enter selects, Escape closes
```

## 4. Forms & Validation

**Red flags:**
- Inputs without labels or `aria-label`
- Error messages not associated with inputs (`aria-describedby`)
- Errors not announced to screen readers (missing `aria-live`)
- Required fields not marked (`aria-required`, `required`)
- Submit button enabled during submission (no loading state)

**WCAG violations:**
- 3.3.1 Error Identification (A)
- 3.3.2 Labels or Instructions (A)
- 3.3.3 Error Suggestion (AA)
- 4.1.3 Status Messages (AA)

**Code examples:**

### Bad: Form without proper labels and error announcements
```tsx
// ❌ BLOCKER: No labels, errors not announced
function LoginForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {error && <span className="error">{error}</span>}
      <button type="submit">Login</button>
    </form>
  );
}

// Screen reader: "Edit text" (no label)
// Error: Displayed visually, but not announced to screen reader
```

### Good: Accessible form with labels and announcements
```tsx
// ✅ Accessible: Labels, error announcements, proper associations
function LoginForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-required="true"
          aria-invalid={!!error}
          aria-describedby={error ? 'email-error' : undefined}
        />
        {error && (
          <span
            id="email-error"
            className="error"
            role="alert"
            aria-live="polite"
          >
            {error}
          </span>
        )}
      </div>
      <button type="submit">Login</button>
    </form>
  );
}

// Screen reader: "Email, edit text, required"
// Error: "Invalid email format" (announced immediately)
```

### Bad: Error summary not linked to inputs
```tsx
// ❌ HIGH: Error summary shown, but not linked to inputs
function RegistrationForm() {
  const [errors, setErrors] = useState<string[]>([]);

  return (
    <form onSubmit={handleSubmit}>
      {errors.length > 0 && (
        <div className="error-summary">
          {errors.map(err => <div key={err}>{err}</div>)}
        </div>
      )}
      <input type="text" placeholder="Name" />
      <input type="email" placeholder="Email" />
      <button type="submit">Register</button>
    </form>
  );
}

// User submits, sees errors
// Screen reader: Announces errors, but can't navigate to problem fields
```

### Good: Error summary with links to fields
```tsx
// ✅ Accessible: Error summary links to fields
function RegistrationForm() {
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <form onSubmit={handleSubmit}>
      {Object.keys(errors).length > 0 && (
        <div
          className="error-summary"
          role="alert"
          aria-live="polite"
        >
          <h2>There are {Object.keys(errors).length} errors in this form:</h2>
          <ul>
            {Object.entries(errors).map(([field, message]) => (
              <li key={field}>
                <a href={`#${field}`}>{message}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label htmlFor="name">Name</label>
        <input
          id="name"
          type="text"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'name-error' : undefined}
        />
        {errors.name && (
          <span id="name-error" className="error">{errors.name}</span>
        )}
      </div>

      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
        {errors.email && (
          <span id="email-error" className="error">{errors.email}</span>
        )}
      </div>

      <button type="submit">Register</button>
    </form>
  );
}

// User submits with errors
// Screen reader: "There are 2 errors in this form: Name is required, Email is invalid"
// Keyboard: Can Tab to error links, Enter navigates to problem field
```

## 5. Dynamic Content & Live Regions

**Red flags:**
- Loading states not announced (`aria-live`, `role="status"`)
- Success/error messages not announced
- Content updates without screen reader notification
- Infinite scroll without keyboard navigation
- Auto-updating content (timers, chat) without pause

**WCAG violations:**
- 4.1.3 Status Messages (AA)
- 2.2.2 Pause, Stop, Hide (A)

**Code examples:**

### Bad: Loading state not announced
```tsx
// ❌ HIGH: Loading state visible, but not announced
function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  return (
    <div>
      {loading && <div className="spinner">Loading...</div>}
      <ul>
        {users.map(user => <li key={user.id}>{user.name}</li>)}
      </ul>
    </div>
  );
}

// User clicks "Load more"
// Screen reader: Silent (doesn't know content is loading)
```

### Good: Loading state announced
```tsx
// ✅ Accessible: Loading state announced to screen reader
function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  return (
    <div>
      {loading && (
        <div
          className="spinner"
          role="status"
          aria-live="polite"
          aria-label="Loading users"
        >
          Loading...
        </div>
      )}
      <ul aria-live="polite" aria-relevant="additions">
        {users.map(user => <li key={user.id}>{user.name}</li>)}
      </ul>
    </div>
  );
}

// User clicks "Load more"
// Screen reader: "Loading users" ... "10 items added"
```

### Bad: Toast notification not announced
```tsx
// ❌ HIGH: Toast visible, but screen reader doesn't know
function Toast({ message }: { message: string }) {
  return (
    <div className="toast">
      {message}
    </div>
  );
}

// Success action triggers toast
// Screen reader: Silent (user doesn't know action succeeded)
```

### Good: Toast notification announced
```tsx
// ✅ Accessible: Toast announced immediately
function Toast({ message, type = 'info' }: ToastProps) {
  return (
    <div
      className={`toast toast-${type}`}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      {message}
    </div>
  );
}

// Success action triggers toast
// Screen reader: "User saved successfully" (announced immediately)
```

## 6. Icons & Visual Indicators

**Red flags:**
- Icon-only buttons without `aria-label`
- Icons conveying information without text alternative
- Color as only indicator (success/error shown only as green/red)
- Emoji without `aria-label` or `role="img"`

**WCAG violations:**
- 1.1.1 Non-text Content (A)
- 1.4.1 Use of Color (A)

**Code examples:**

### Bad: Icon-only button without label
```tsx
// ❌ BLOCKER: Screen reader has no idea what this button does
function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}>
      <TrashIcon />
    </button>
  );
}

// Screen reader: "Button" (no label!)
```

### Good: Icon button with accessible label
```tsx
// ✅ Accessible: Screen reader knows button purpose
function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Delete user">
      <TrashIcon aria-hidden="true" />
    </button>
  );
}

// Screen reader: "Delete user, button"
```

### Bad: Color as only error indicator
```tsx
// ❌ BLOCKER: Color-blind users can't see error
function Input({ error }: { error?: string }) {
  return (
    <input
      className={error ? 'error' : ''}
      style={{ borderColor: error ? 'red' : 'gray' }}
    />
  );
}

// Visual: Red border (only indicator)
// Color-blind user: Can't distinguish error state
```

### Good: Multiple error indicators
```tsx
// ✅ Accessible: Icon + text + ARIA attributes
function Input({ error }: { error?: string }) {
  return (
    <div>
      <input
        aria-invalid={!!error}
        aria-describedby={error ? 'input-error' : undefined}
      />
      {error && (
        <span id="input-error" className="error">
          <ErrorIcon aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  );
}

// Visual: Icon + red text
// Screen reader: "Invalid, Error: Field is required"
// Color-blind: Can see icon and text
```

## 7. Third-Party Components

**Red flags:**
- Component library components used without accessibility check
- Custom wrappers breaking library accessibility
- Missing ARIA attributes on wrapped components
- Event handlers preventing default keyboard behavior

**Code examples:**

### Bad: Wrapper breaking accessibility
```tsx
// ❌ HIGH: Wrapper removes button semantics
function CustomButton({ children, onClick }: ButtonProps) {
  return (
    <div className="button-wrapper">
      <button onClick={onClick}>
        {children}
      </button>
    </div>
  );
}

// Using Material-UI component incorrectly
<MaterialButton component="div" onClick={handleClick}>
  Submit
</MaterialButton>
// ❌ Renders as <div>, loses keyboard accessibility
```

### Good: Wrapper preserving accessibility
```tsx
// ✅ Accessible: Wrapper doesn't break button semantics
function CustomButton({ children, onClick, ...props }: ButtonProps) {
  return (
    <div className="button-wrapper">
      <button onClick={onClick} {...props}>
        {children}
      </button>
    </div>
  );
}

// Using Material-UI component correctly
<MaterialButton onClick={handleClick}>
  Submit
</MaterialButton>
// ✅ Renders as <button>, keyboard works
```

# WORKFLOW

## Step 0: Infer SESSION_SLUG if not provided

Standard session inference from `.claude/README.md` (last entry).

## Step 1: Load session context

1. Validate `.claude/<SESSION_SLUG>/` exists
2. Read `.claude/<SESSION_SLUG>/README.md` for context
3. Check spec for accessibility requirements
4. Check plan for target WCAG level
5. Check work log for component changes

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
   - Prioritize component files (*.tsx, *.vue, *.jsx)

4. **CONTEXT** (if not provided)
   - Default to WCAG 2.1 Level AA
   - Assume diverse user base (screen readers, keyboard-only, low vision)

## Step 3: Identify framework and components

Scan changed files to determine:

1. **Framework**: React, Vue, Angular, Svelte
2. **Component library**: Material-UI, Ant Design, Chakra UI, custom
3. **Router**: React Router, Vue Router, Next.js
4. **Form library**: React Hook Form, Formik, custom

## Step 4: Gather component files

Based on SCOPE, get:
- Component files (*.tsx, *.jsx, *.vue)
- Style files (*.css, *.scss, *.module.css)
- Test files (*.test.tsx, *.spec.ts)

Prioritize:
- New custom components (buttons, inputs, modals)
- Form components
- Navigation components
- Route components

## Step 5: Scan for accessibility issues

For each checklist category:

### Component Primitives Scan
```bash
# Find non-semantic interactive elements
grep -r "<div.*onClick" src/components/
grep -r "<span.*onClick" src/components/

# Find custom inputs without labels
grep -r "<input" src/components/ | grep -v "label"

# Find missing ARIA attributes
grep -r "role=" src/components/ | grep -v "aria-"
```

Look for:
- `<div onClick>` or `<span onClick>` (should be `<button>`)
- Inputs without `<label>` or `aria-label`
- Custom components without `role`, `aria-*` attributes
- Missing keyboard handlers (`onKeyDown`)

### Focus Management Scan
```bash
# Find route changes
grep -r "useNavigate\|navigate\|router.push" src/

# Find modals
grep -r "Modal\|Dialog\|Drawer" src/components/

# Find focus outline removal
grep -r "outline:.*none" src/**/*.css
```

Look for:
- Route changes without focus management
- Modals without focus trap
- Focus outline removed (`:focus { outline: none }`)
- No focus restoration after modal close

### Interactive Widgets Scan
```bash
# Find dropdowns
grep -r "Dropdown\|Select\|Combobox" src/components/

# Find tooltips
grep -r "Tooltip\|Popover" src/components/

# Find menus
grep -r "Menu\|ContextMenu" src/components/
```

Look for:
- Dropdowns without `role="listbox"`, `aria-haspopup`
- Menus without `role="menu"`, `role="menuitem"`
- Missing keyboard navigation (Arrow keys, Escape)
- Tooltips not keyboard accessible

### Forms Scan
```bash
# Find form inputs
grep -r "<input\|<textarea\|<select" src/

# Find form validation
grep -r "error\|invalid\|required" src/components/
```

Look for:
- Inputs without labels
- Errors not associated with inputs (`aria-describedby`)
- Errors not announced (`role="alert"`, `aria-live`)
- Missing `aria-required` on required fields

### Dynamic Content Scan
```bash
# Find loading states
grep -r "loading\|isLoading\|pending" src/

# Find notifications
grep -r "Toast\|Notification\|Snackbar" src/components/
```

Look for:
- Loading states without `role="status"`, `aria-live`
- Notifications not announced
- Content updates without screen reader notification

### Icons Scan
```bash
# Find icon components
grep -r "Icon\|Svg" src/components/

# Find icon-only buttons
grep -r "<button>.*<.*Icon" src/
```

Look for:
- Icon-only buttons without `aria-label`
- Icons without `aria-hidden="true"`
- Emoji without text alternative

### Third-Party Scan
```bash
# Find component library imports
grep -r "from '@mui\|from 'antd\|from '@chakra-ui" src/
```

Look for:
- Components with `component="div"` (breaks semantics)
- Wrapped components without proper props forwarding
- Missing accessibility props on library components

## Step 6: Test with screen reader

For critical components, describe screen reader experience:

1. **What is announced?**
   - Role, name, state, value
   - Focus changes
   - Dynamic updates

2. **Can user complete task?**
   - Navigate with Tab/Shift+Tab
   - Activate with Enter/Space
   - Navigate with Arrow keys (for complex widgets)
   - Escape to close modals/menus

3. **Are errors announced?**
   - Form validation errors
   - Loading/success/error states
   - Dynamic content changes

## Step 7: Assess findings

For each issue:

1. **Severity**:
   - BLOCKER: Keyboard trap, missing labels, no focus management
   - HIGH: Missing error announcements, inaccessible custom components
   - MED: Missing focus indicators, suboptimal ARIA usage
   - LOW: Color contrast issues (close to threshold), missing descriptions
   - NIT: Best practices, redundant ARIA

2. **Confidence**:
   - High: Clear WCAG violation, testable
   - Med: Likely issue, needs screen reader verification
   - Low: Edge case, depends on user preference

3. **WCAG mapping**:
   - Which WCAG 2.1 criterion violated?
   - Level: A, AA, or AAA?

4. **Screen reader impact**:
   - What does screen reader announce (or not announce)?
   - Can user complete task?

5. **Fix**:
   - Code fix with proper ARIA
   - Alternative if multiple approaches

## Step 8: Generate review report

Create `.claude/<SESSION_SLUG>/reviews/review-frontend-accessibility-{YYYY-MM-DD}.md`

## Step 9: Update session README

Standard artifact tracking update.

## Step 10: Output summary

Print summary with critical accessibility blockers.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-frontend-accessibility-{YYYY-MM-DD}.md`:

```markdown
---
command: /review:frontend-accessibility
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

# Frontend Accessibility Review Report

**Reviewed:** {SCOPE} / {TARGET}
**Date:** {YYYY-MM-DD}
**Reviewer:** Claude Code
**WCAG Target:** WCAG 2.1 Level AA

---

## 0) Scope & Methodology

**What was reviewed:**
- Scope: {SCOPE}
- Target: {TARGET}
- Files: {count} files, {+lines} added, {-lines} removed
- Framework: {React/Vue/Angular/Svelte}
- Component library: {Material-UI/Ant Design/Custom}

{If PATHS provided:}
- Focus: {PATHS}

**Review methodology:**
1. Static code analysis (semantic HTML, ARIA attributes)
2. Screen reader simulation (VoiceOver, NVDA, JAWS)
3. Keyboard navigation testing (Tab, Arrow keys, Escape)
4. WCAG 2.1 Level AA compliance check

**Components reviewed:**
- {Component 1 - e.g., "LoginForm"}
- {Component 2 - e.g., "UserModal"}
- {Component 3 - e.g., "NotificationToast"}
- {Component 4 - e.g., "DataTable"}

**WCAG target:**
{From CONTEXT or default}
- Target: WCAG 2.1 Level AA
- Required for: Public-facing web app
- User base: General public, including screen reader users, keyboard-only users, low vision users

---

## 1) Executive Summary

**Accessibility Status:** {COMPLIANT | MOSTLY_COMPLIANT | NON_COMPLIANT | CRITICAL_ISSUES}

**Rationale:**
{2-3 sentences explaining status}

**Critical Violations (BLOCKER):**
1. **{Finding ID}**: {Component} - {WCAG violation}
2. **{Finding ID}**: {Component} - {WCAG violation}

**Overall Assessment:**
- Keyboard Accessibility: {Excellent | Good | Incomplete | Broken}
- Screen Reader Support: {Excellent | Good | Incomplete | Broken}
- Focus Management: {Excellent | Good | Missing | Broken}
- Form Accessibility: {Excellent | Good | Incomplete | Missing}
- ARIA Usage: {Excellent | Good | Incomplete | Incorrect}

---

## 2) Findings Table

| ID | Severity | WCAG | Component | Violation |
|----|----------|------|-----------|-----------|
| FA-1 | BLOCKER | 2.1.1 (A) | CustomButton | Non-semantic button (`<div onClick>`) |
| FA-2 | BLOCKER | 3.3.2 (A) | LoginForm | Input without label |
| FA-3 | BLOCKER | 2.1.2 (A) | Modal | Keyboard trap |
| FA-4 | HIGH | 4.1.3 (AA) | NotificationToast | Status not announced |
| FA-5 | HIGH | 2.4.3 (A) | AppRouter | Focus not managed on route change |
| FA-6 | MED | 1.1.1 (A) | IconButton | Icon-only button without `aria-label` |
| FA-7 | LOW | 1.4.3 (AA) | ErrorText | Insufficient contrast (4.2:1) |

**Findings Summary:**
- BLOCKER: {count}
- HIGH: {count}
- MED: {count}
- LOW: {count}
- NIT: {count}

**WCAG Violations by Level:**
- Level A: {count}
- Level AA: {count}
- Level AAA: {count}

**Category Breakdown:**
- Component Primitives: {count}
- Focus Management: {count}
- Interactive Widgets: {count}
- Forms & Validation: {count}
- Dynamic Content: {count}
- Icons & Visual Indicators: {count}
- Third-Party Components: {count}

---

## 3) Findings (Detailed)

### FA-1: Non-Semantic Button - `<div onClick>` [BLOCKER]

**Location:** `src/components/CustomButton.tsx:15-25`

**WCAG Violation:**
- **2.1.1 Keyboard (Level A)**: All functionality must be operable via keyboard
- **4.1.2 Name, Role, Value (Level A)**: UI components must have programmatically determinable role

**Component:** CustomButton

**Vulnerable Code:**
```tsx
// Lines 15-25
function CustomButton({ label, onClick }: CustomButtonProps) {
  return (
    <div
      className="custom-button"
      onClick={onClick}
    >
      {label}
    </div>
  );
}
```

**Accessibility Issues:**

1. **Not keyboard accessible**:
   - Cannot Tab to element (not in tab order)
   - Enter/Space don't activate (no keyboard handler)

2. **No semantic role**:
   - Screen reader announces "Submit" (no "button" role)
   - ARIA role not specified

3. **Missing focus indicator**:
   - No visible focus indicator
   - Keyboard users don't know where focus is

**Screen Reader Experience:**
```
VoiceOver: "Submit" (no role, not focusable)
NVDA: "Submit" (no role)
Expected: "Submit, button"
```

**Keyboard Experience:**
```
Tab: Skips element (not in tab order) ❌
Enter: No action ❌
Space: No action ❌
Expected: Tab to focus, Enter/Space to activate
```

**Impact:**
- **Keyboard-only users**: Cannot click button
- **Screen reader users**: Don't know it's a button
- **All users**: No focus indicator
- **WCAG 2.1 compliance**: FAIL (Level A violation)

**Severity:** BLOCKER
**Confidence:** High
**WCAG:** 2.1.1 Keyboard (A), 4.1.2 Name, Role, Value (A)

**Fix:**

Use semantic `<button>` element:

```diff
--- a/src/components/CustomButton.tsx
+++ b/src/components/CustomButton.tsx
@@ -13,11 +13,11 @@
 function CustomButton({ label, onClick }: CustomButtonProps) {
   return (
-    <div
+    <button
       className="custom-button"
       onClick={onClick}
     >
       {label}
-    </div>
+    </button>
   );
 }
```

**Alternative (if `<div>` required for styling):**

Add ARIA and keyboard handlers:

```tsx
function CustomButton({ label, onClick }: CustomButtonProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className="custom-button"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {label}
    </div>
  );
}
```

**Why semantic button is better:**
- Native keyboard support (no handlers needed)
- Native screen reader support (role implicit)
- Native focus management
- Accessibility maintained even if JS fails

**Test:**
```tsx
test('CustomButton is keyboard accessible', () => {
  const handleClick = jest.fn();
  render(<CustomButton label="Submit" onClick={handleClick} />);

  const button = screen.getByRole('button', { name: 'Submit' });

  // Can Tab to button
  button.focus();
  expect(button).toHaveFocus();

  // Enter activates button
  fireEvent.keyDown(button, { key: 'Enter' });
  expect(handleClick).toHaveBeenCalled();

  // Space activates button
  fireEvent.keyDown(button, { key: ' ' });
  expect(handleClick).toHaveBeenCalledTimes(2);
});
```

---

### FA-2: Input Without Label [BLOCKER]

**Location:** `src/components/LoginForm.tsx:30-40`

**WCAG Violation:**
- **3.3.2 Labels or Instructions (Level A)**: Labels or instructions provided when content requires user input

**Component:** LoginForm

**Vulnerable Code:**
```tsx
// Lines 30-40
function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit">Login</button>
    </form>
  );
}
```

**Accessibility Issues:**

1. **No label association**:
   - Inputs have `placeholder` but no `<label>`
   - Screen reader announces "Edit text" (no field name)

2. **Placeholder not sufficient**:
   - Placeholder disappears when typing
   - Not a substitute for label (WCAG requirement)
   - Low contrast (hard to read)

3. **No programmatic association**:
   - No `id` on input, no `htmlFor` on label
   - Screen reader can't navigate by label

**Screen Reader Experience:**
```
VoiceOver: "Edit text, email" (type only, no label)
NVDA: "Edit text" (no context)
Expected: "Email, edit text, required"
```

**Impact:**
- **Screen reader users**: Don't know what to enter
- **Keyboard users**: Can't click label to focus input
- **All users**: Lose context when placeholder disappears
- **WCAG 2.1 compliance**: FAIL (Level A violation)

**Severity:** BLOCKER
**Confidence:** High
**WCAG:** 3.3.2 Labels or Instructions (A)

**Fix:**

Add proper labels:

```diff
--- a/src/components/LoginForm.tsx
+++ b/src/components/LoginForm.tsx
@@ -28,16 +28,22 @@
 function LoginForm() {
   const [email, setEmail] = useState('');
   const [password, setPassword] = useState('');

   return (
     <form onSubmit={handleSubmit}>
+      <div>
+        <label htmlFor="email">Email</label>
         <input
+          id="email"
           type="email"
           placeholder="Email"
           value={email}
           onChange={(e) => setEmail(e.target.value)}
+          required
+          aria-required="true"
         />
+      </div>
+      <div>
+        <label htmlFor="password">Password</label>
         <input
+          id="password"
           type="password"
           placeholder="Password"
           value={password}
           onChange={(e) => setPassword(e.target.value)}
+          required
+          aria-required="true"
         />
+      </div>
       <button type="submit">Login</button>
     </form>
   );
 }
```

**Alternative (visually hidden label):**

If design requires no visible label:

```tsx
<div>
  <label htmlFor="email" className="sr-only">
    Email
  </label>
  <input
    id="email"
    type="email"
    placeholder="Email"
    aria-label="Email"
  />
</div>

// CSS for screen-reader-only label
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

**Why labels are required:**
- Screen readers announce label when focused
- Clicking label focuses input (larger click target)
- Persistent (unlike placeholder)
- Required by WCAG 2.1 Level A

**Test:**
```tsx
test('LoginForm has proper labels', () => {
  render(<LoginForm />);

  // Labels exist and are associated with inputs
  const emailInput = screen.getByLabelText('Email');
  const passwordInput = screen.getByLabelText('Password');

  expect(emailInput).toHaveAttribute('type', 'email');
  expect(passwordInput).toHaveAttribute('type', 'password');

  // Clicking label focuses input
  const emailLabel = screen.getByText('Email');
  fireEvent.click(emailLabel);
  expect(emailInput).toHaveFocus();
});
```

---

### FA-3: Modal Without Focus Trap [BLOCKER]

**Location:** `src/components/Modal.tsx:20-35`

**WCAG Violation:**
- **2.1.2 No Keyboard Trap (Level A)**: If keyboard focus can be moved to a component, focus can be moved away using only keyboard

**Component:** Modal

**Vulnerable Code:**
```tsx
// Lines 20-35
function Modal({ isOpen, onClose, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal">
        <button onClick={onClose}>Close</button>
        {children}
      </div>
    </div>
  );
}
```

**Accessibility Issues:**

1. **No focus trap**:
   - Can Tab outside modal to background page
   - Confusing (modal appears active but focus on background)

2. **Focus not moved to modal**:
   - When opened, focus stays on trigger button
   - Screen reader doesn't know modal opened

3. **No keyboard close**:
   - Escape key doesn't close modal
   - Must Tab to close button

4. **Focus not returned**:
   - When closed, focus lost (stays on closed modal)
   - User must Tab from beginning of page

5. **Missing ARIA**:
   - No `role="dialog"`
   - No `aria-modal="true"`
   - No `aria-labelledby`

**Screen Reader Experience:**
```
User clicks "Open modal"
VoiceOver: Silent (doesn't announce modal opened)
User presses Tab
VoiceOver: "Link, Home" (focus on background, not modal) ❌
Expected: "Modal title, dialog" (focus in modal)
```

**Keyboard Experience:**
```
User opens modal
Tab: Focus goes to background page elements ❌
Escape: No action ❌
Expected: Tab cycles within modal, Escape closes modal
```

**Impact:**
- **Keyboard users**: Confusing, can interact with background
- **Screen reader users**: Don't know modal opened
- **All users**: Focus lost on close
- **WCAG 2.1 compliance**: FAIL (Level A violation)

**Severity:** BLOCKER
**Confidence:** High
**WCAG:** 2.1.2 No Keyboard Trap (A), 4.1.2 Name, Role, Value (A)

**Fix:**

Implement focus trap:

```diff
--- a/src/components/Modal.tsx
+++ b/src/components/Modal.tsx
@@ -1,4 +1,5 @@
 import React, { useEffect, useRef } from 'react';
+import { FocusTrap } from 'focus-trap-react';

 function Modal({ isOpen, onClose, children }: ModalProps) {
+  const previousFocus = useRef<HTMLElement | null>(null);
+
+  useEffect(() => {
+    if (isOpen) {
+      // Save previous focus
+      previousFocus.current = document.activeElement as HTMLElement;
+    } else if (previousFocus.current) {
+      // Restore focus on close
+      previousFocus.current.focus();
+    }
+  }, [isOpen]);
+
+  useEffect(() => {
+    const handleKeyDown = (e: KeyboardEvent) => {
+      if (e.key === 'Escape') {
+        onClose();
+      }
+    };
+
+    if (isOpen) {
+      document.addEventListener('keydown', handleKeyDown);
+    }
+
+    return () => {
+      document.removeEventListener('keydown', handleKeyDown);
+    };
+  }, [isOpen, onClose]);

   if (!isOpen) return null;

   return (
     <div className="modal-overlay">
+      <FocusTrap>
         <div
           className="modal"
+          role="dialog"
+          aria-modal="true"
+          aria-labelledby="modal-title"
         >
+          <h2 id="modal-title">Modal Title</h2>
           <button onClick={onClose}>Close</button>
           {children}
         </div>
+      </FocusTrap>
     </div>
   );
 }
```

**Alternative (manual focus trap):**

```tsx
function Modal({ isOpen, onClose, children }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Save and set focus
    previousFocus.current = document.activeElement as HTMLElement;
    const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();

    // Trap focus
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }

      if (e.key === 'Tab') {
        const focusableElements = modalRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="modal-title">Modal Title</h2>
        <button onClick={onClose} aria-label="Close modal">×</button>
        {children}
      </div>
    </div>
  );
}
```

**Why focus trap is required:**
- Modal is blocking UI (user can't interact with background)
- Focus should be trapped to reflect visual state
- WCAG 2.1 requires keyboard accessibility
- Screen reader users need context (focus in modal)

**Test:**
```tsx
test('Modal traps focus', () => {
  const handleClose = jest.fn();
  render(
    <>
      <button>Background button</button>
      <Modal isOpen={true} onClose={handleClose}>
        <button>Modal button 1</button>
        <button>Modal button 2</button>
      </Modal>
    </>
  );

  // Focus starts in modal
  const modalButton1 = screen.getByText('Modal button 1');
  expect(modalButton1).toHaveFocus();

  // Tab cycles within modal
  userEvent.tab();
  expect(screen.getByText('Modal button 2')).toHaveFocus();

  userEvent.tab();
  expect(screen.getByText('Close')).toHaveFocus();

  userEvent.tab();
  expect(modalButton1).toHaveFocus(); // Cycles back to first element

  // Escape closes modal
  userEvent.keyboard('{Escape}');
  expect(handleClose).toHaveBeenCalled();
});
```

---

{Continue with FA-4 through FA-7 following same pattern}

---

## 4) WCAG 2.1 Compliance Summary

| WCAG Criterion | Level | Status | Violations |
|----------------|-------|--------|------------|
| 1.1.1 Non-text Content | A | ⚠️ Partial | FA-6 (icon-only button) |
| 1.3.1 Info and Relationships | A | ✅ Pass | None |
| 1.4.3 Contrast (Minimum) | AA | ⚠️ Partial | FA-7 (error text) |
| 2.1.1 Keyboard | A | ❌ Fail | FA-1 (div button) |
| 2.1.2 No Keyboard Trap | A | ❌ Fail | FA-3 (modal) |
| 2.4.3 Focus Order | A | ❌ Fail | FA-5 (route change) |
| 2.4.7 Focus Visible | AA | ✅ Pass | None |
| 3.3.1 Error Identification | A | ✅ Pass | None |
| 3.3.2 Labels or Instructions | A | ❌ Fail | FA-2 (input labels) |
| 4.1.2 Name, Role, Value | A | ❌ Fail | FA-1, FA-3 |
| 4.1.3 Status Messages | AA | ❌ Fail | FA-4 (toast) |

**Overall Compliance:**
- Level A: ❌ FAIL (5 violations)
- Level AA: ❌ FAIL (3 violations)

**Critical gaps:**
1. Keyboard accessibility (FA-1, FA-3)
2. Form accessibility (FA-2)
3. Focus management (FA-5)
4. Dynamic content announcements (FA-4)

---

## 5) Screen Reader Testing Results

**Tested with:**
- VoiceOver (macOS, Safari)
- NVDA (Windows, Firefox)
- JAWS (Windows, Chrome)

**Components tested:**
1. **CustomButton**: FAIL (not announced as button)
2. **LoginForm**: FAIL (no labels announced)
3. **Modal**: FAIL (focus not trapped)
4. **NotificationToast**: FAIL (not announced)

**User flows tested:**
1. **Login flow**: FAIL (can't identify fields)
2. **Modal interaction**: FAIL (focus lost)
3. **Form submission with errors**: PARTIAL (errors not announced)

---

## 6) Recommendations

### Critical (Fix Before Release) - BLOCKER

1. **FA-1: Non-Semantic Button**
   - Action: Replace `<div onClick>` with `<button>`
   - Effort: 10 minutes
   - Impact: Keyboard accessibility restored

2. **FA-2: Input Without Label**
   - Action: Add `<label>` elements with `htmlFor`
   - Effort: 15 minutes
   - Impact: Screen reader users can identify fields

3. **FA-3: Modal Without Focus Trap**
   - Action: Implement focus trap with `focus-trap-react`
   - Effort: 30 minutes
   - Impact: Modal keyboard navigation fixed

### High Priority (Fix Soon) - HIGH

4. **FA-4: Toast Not Announced**
   - Action: Add `role="status"` and `aria-live="polite"`
   - Effort: 5 minutes
   - Impact: Screen reader users notified of updates

5. **FA-5: Focus Not Managed on Route Change**
   - Action: Focus main content on route change
   - Effort: 15 minutes
   - Impact: Screen reader users know page changed

### Medium Priority (Address in Next Sprint) - MED

6. **FA-6: Icon-Only Button**
   - Action: Add `aria-label` to icon buttons
   - Effort: 10 minutes
   - Impact: Screen reader users know button purpose

### Low Priority (Backlog) - LOW

7. **FA-7: Color Contrast**
   - Action: Increase error text color contrast to 4.5:1
   - Effort: 5 minutes
   - Impact: Low vision users can read errors

### Testing & Documentation

8. **Add accessibility tests**
   - Action: Add jest-axe and react-testing-library a11y tests
   - Effort: 2 hours
   - Impact: Catch regressions

9. **Document accessibility patterns**
   - Action: Create component library docs with a11y guidelines
   - Effort: 4 hours
   - Impact: Prevent future violations

---

## 7) False Positives & Disagreements Welcome

**Where I might be wrong:**

1. **FA-6 (Icon button)**: If icon is universally recognized (e.g., ❌ for close), might be acceptable
2. **FA-7 (Color contrast)**: If text is large (18pt+), 3:1 ratio is acceptable
3. Framework components may have built-in accessibility I didn't detect in static analysis

**How to override my findings:**
- Test with actual screen readers (I simulated based on code)
- Show that component library provides accessibility (e.g., Material-UI `<Button>`)
- Provide WCAG exception documentation (e.g., decorative images don't need alt text)

I'm optimizing for **WCAG 2.1 Level AA compliance**. If there's a good reason for a pattern, let's discuss!

---

*Review completed: {YYYY-MM-DD}*
*Session: [{SESSION_SLUG}](../README.md)*
```

# SUMMARY OUTPUT

After creating review, print:

```markdown
# Frontend Accessibility Review Complete

## Review Location
Saved to: `.claude/{SESSION_SLUG}/reviews/review-frontend-accessibility-{YYYY-MM-DD}.md`

## Accessibility Status
**{COMPLIANT | MOSTLY_COMPLIANT | NON_COMPLIANT | CRITICAL_ISSUES}**

## Critical Violations (BLOCKER)
1. **{Finding ID}**: {Component} - {WCAG violation}
2. **{Finding ID}**: {Component} - {WCAG violation}

## WCAG 2.1 Compliance
- Level A: {PASS | FAIL} ({X} violations)
- Level AA: {PASS | FAIL} ({X} violations)

## Statistics
- Components reviewed: {count}
- Findings: BLOCKER: {X}, HIGH: {X}, MED: {X}, LOW: {X}
- WCAG violations: Level A: {X}, Level AA: {X}

## Accessibility Posture
- Keyboard Accessibility: {Excellent | Good | Incomplete | Broken}
- Screen Reader Support: {Excellent | Good | Incomplete | Broken}
- Focus Management: {Excellent | Good | Missing | Broken}
- Form Accessibility: {Excellent | Good | Incomplete | Missing}

## Immediate Actions Required
{If BLOCKER findings:}
1. {Finding ID}: {Fix description} ({estimated time})
2. {Finding ID}: {Fix description} ({estimated time})

**DO NOT RELEASE** until critical violations fixed.

## Quick Fixes
- Replace `<div onClick>` with `<button>`: 10 minutes
- Add labels to inputs: 15 minutes
- Implement modal focus trap: 30 minutes

**Total critical fix effort:** {X} minutes

## Screen Reader Impact
{Most critical issue}:
- Current: {What screen reader announces}
- Expected: {What should be announced}

## Next Steps
1. Fix BLOCKER violations (FA-1, FA-2, FA-3)
2. Test with actual screen readers
3. Add automated accessibility tests (jest-axe)
4. Document accessibility patterns for team

## Resources
- WCAG 2.1: https://www.w3.org/WAI/WCAG21/quickref/
- WAI-ARIA Authoring Practices: https://www.w3.org/WAI/ARIA/apg/
- MDN Accessibility: https://developer.mozilla.org/en-US/docs/Web/Accessibility
```

# IMPORTANT: Focus on SPA-Specific Issues

This review should focus on:
- **Interactive patterns** unique to SPAs (modals, routing, dynamic content)
- **Screen reader announcements** (live regions, status messages)
- **Focus management** (route changes, modal open/close)
- **Custom components** (reinvented native elements)
- **ARIA usage** (proper roles, states, properties)

Not generic HTML accessibility (heading structure, image alt text) - those are covered by other reviews.

# WHEN TO USE

Run `/review:frontend-accessibility` when:
- Before releases (WCAG compliance check)
- After adding custom components (buttons, inputs, modals)
- After form changes (validation, errors)
- After routing changes (navigation, focus management)
- For public-facing features (legal compliance)

This should be in the default review chain for all frontend work types.
