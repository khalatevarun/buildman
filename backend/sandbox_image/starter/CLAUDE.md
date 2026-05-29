# Workspace

This is a **Vite + React + TypeScript** project in `/workspace`. Edit files in place; never scaffold a new project or run `npm create`.

---

## Stack (all pre-installed — do not npm install these)

| What | Package | Import |
|------|---------|--------|
| Styling | Tailwind CSS v4 | utility classes — no custom CSS |
| Icons | lucide-react | `import { Search, Plus } from 'lucide-react'` |
| Toasts | sonner | `import { toast } from 'sonner'` |
| Animations | motion | `import { motion, AnimatePresence } from 'motion/react'` |
| Routing | react-router-dom | `import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'` |
| Class util | clsx + tailwind-merge | `import { cn } from '@/lib/utils'` |

The CSS custom properties (colors, radii, shadows) are defined in `src/index.css`. Available as Tailwind utilities: `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `text-primary`, `text-accent`, `border-border`, `rounded-sm/md/lg/xl`.

---

## Design Philosophy

**Before writing a single line of code, answer this:** What is the app's personality?

- A **finance tracker** is calm, precise, trustworthy. Dense data, muted palette, numbers as heroes.
- A **fitness app** is bold, energetic, motivating. High contrast, strong type, vibrant accent on completion.
- A **notes app** is minimal, focused, distraction-free. Maximum whitespace, type-first, nearly invisible UI.
- A **social app** is warm, human, expressive. Rounded forms, images prominent, playful spacing.
- A **productivity tool** is systematic, efficient, clear. Grid layouts, consistent density, status-forward.

The visual style should emerge from the purpose. Don't apply the same dark card with indigo primary to everything. Make each app feel like it was designed for that specific purpose.

---

## What separates great design from AI slop

**Good: Strong visual hierarchy.** The most important thing on screen is visually dominant — largest, heaviest, most prominent. Everything else recedes in service of it. Choose ONE hero element per screen.

**Good: Intentional whitespace.** Generous padding (p-8, p-12, gap-8) creates breathing room and makes the UI feel premium. Cramped = cheap.

**Good: Color restraint.** Use the neutral palette for 90% of the UI. Reserve color for the 10% that actually needs it: primary actions, success/error states, data visualization. Never use color just because you can.

**Good: Type does the work.** Large, bold headings. Small, muted supporting text. Dramatic size contrast (48px hero vs 13px caption) creates hierarchy. Use `tracking-tight` on anything over 20px.

**Good: Depth through layers.** Backgrounds, then surfaces (cards), then interactive elements (buttons). Each layer should be a step lighter or darker. Subtle shadows (`shadow-sm`, `shadow-md`) create elevation without drama.

**Bad: Border on everything.** If you add a border to every card, every input, every section — nothing reads as intentional. Use borders selectively: inputs need them, cards sometimes, sections never.

**Bad: Buttons that all look the same.** Vary button weight by importance. One primary action per screen. Secondary actions are ghost or text. Destructive actions are red.

**Bad: Symmetric padding that ignores content.** Don't pad a modal title the same as a dashboard widget. Match density to context.

**Bad: Loading states that don't match the app.** A minimal app should have a minimal spinner. An energetic app can have a pulsing animation.

---

## Layout Patterns

**Page shell:**
```tsx
<div className="min-h-dvh bg-background text-foreground">
  <nav>...</nav>
  <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">...</main>
</div>
```

**Data-heavy dashboard:** Use a sidebar + main content split. Dense rows, not cards.
**Marketing / landing page:** Full-width sections, large type, generous padding.
**Form / settings:** Max-width 480–600px, centered, generous vertical rhythm.
**Feed / list:** Full-width on mobile, max 680px on desktop, consistent item height.

Mobile-first always. Every layout must work at 375px — add `sm:`, `md:`, `lg:` breakpoints for larger screens.

---

## Typography Scale

```
Hero heading:    text-4xl sm:text-5xl font-bold tracking-tight
Page heading:    text-2xl sm:text-3xl font-bold tracking-tight  
Section heading: text-xl font-semibold tracking-tight
Card title:      text-base font-semibold
Body:            text-sm leading-relaxed
Supporting:      text-sm text-muted-foreground
Caption:         text-xs text-muted-foreground
Label:           text-xs font-medium uppercase tracking-widest text-muted-foreground
```

---

## Color with Intention

```
bg-background          → page background
bg-card                → elevated surfaces (cards, modals, sidebars)
bg-muted               → subtle containers (code blocks, tags, badges)
text-foreground        → primary content
text-muted-foreground  → secondary content, captions, placeholders
text-primary           → brand color — links, active states, key actions
text-accent            → secondary brand — use sparingly
text-destructive       → errors, delete actions
text-success           → confirmations, completed states
```

For backgrounds, prefer opacity variants for color accents:
`bg-primary/10` (tint), `bg-destructive/10` (danger zone), `bg-success/10` (success area).

---

## Interactions

Every interactive element needs three states: default, hover, active/pressed.

```tsx
// Button — feel the weight change
className="... hover:bg-primary/90 active:scale-[0.97] transition-all duration-100"

// Link — subtle underline reveal
className="... hover:text-foreground transition-colors duration-150"

// Card — lift on hover (use for clickable cards only)
className="... hover:shadow-md hover:-translate-y-0.5 transition-all duration-150"

// Input — ring on focus, not just outline
className="... focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-shadow duration-150"
```

---

## Icons

Always lucide-react. Never emoji as icons.

```tsx
import { Search, Plus, ArrowRight, Check, X, Loader2, Settings, ChevronDown } from 'lucide-react'

<Search className="w-4 h-4" />    // 16px — inline, dense UI
<Settings className="w-5 h-5" />  // 20px — nav, toolbars
<Plus className="w-6 h-6" />      // 24px — feature icons, empty states
<Loader2 className="w-4 h-4 animate-spin" />  // loading
```

---

## Toasts

```tsx
import { toast } from 'sonner'

toast.success('Saved')
toast.error('Failed to save — try again')
toast.promise(saveAsync(), { loading: 'Saving...', success: 'Saved!', error: 'Failed' })
```

`<Toaster />` is already in `App.tsx`.

---

## Animations — use purposefully, not decoratively

```tsx
import { motion, AnimatePresence } from 'motion/react'

// Page / section entrance
<motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }}>

// List items stagger
<motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.04 }}>

// Modal / dialog
<motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}>

// Don't animate things that don't need it. A settings page doesn't need staggered list items.
```

---

## Empty States

Never show a blank area. Every empty state needs three things: an icon (lucide, w-12 h-12, muted), a title, a helpful action.

```tsx
<div className="flex flex-col items-center justify-center py-16 gap-4">
  <BookOpen className="w-12 h-12 text-muted-foreground/30" />
  <div className="text-center">
    <p className="text-sm font-medium">No notes yet</p>
    <p className="text-xs text-muted-foreground mt-1">Create your first note to get started</p>
  </div>
  <button ...>New note</button>
</div>
```

---

## Code Rules

- Use `cn()` from `@/lib/utils` for all conditional classes
- Never write `style={{ color: '...' }}` — use Tailwind
- Never add custom CSS beyond what's in `index.css`
- Never hardcode colors as hex values
- Files over 250 lines → split into smaller components
- Mobile-first: write base styles for 375px, add breakpoints for wider

---

## Environment Variables

If the app needs an API key:
1. Write to `/workspace/.env`:
   ```
   # service: OpenAI | url: https://platform.openai.com/api-keys | hint: starts with sk-
   VITE_OPENAI_API_KEY=__NEEDS_USER_VALUE__
   ```
2. Use `__NEEDS_USER_VALUE__` exactly — never invent a fake key.
3. Reference as `import.meta.env.VITE_YOUR_VAR_NAME`.
4. All frontend vars must be prefixed `VITE_`.
