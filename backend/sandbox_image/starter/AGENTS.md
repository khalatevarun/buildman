# Workspace

Vite + React + TypeScript project at `/workspace`. Edit files in place — never scaffold a new project or run `npm create`.

## Project Structure

```
/workspace/
├── index.html                  # do not edit
├── vite.config.ts              # @ → src/ alias, port 5173; do not edit
├── package.json                # do not edit
├── tsconfig*.json              # do not edit
├── netlify.toml                # do not edit
└── src/
    ├── main.tsx                # do not edit
    ├── index.css               # design tokens + resets; you may append new rules but do not modify existing ones
    ├── vite-env.d.ts           # do not edit
    ├── App.tsx                 # top-level shell — edit to add your UI
    └── lib/utils.ts            # cn() utility; do not edit
```

Create pages under `src/pages/`, shared components under `src/components/`, hooks under `src/hooks/`.

## Available Packages

Only these packages are pre-installed. Do not import anything else.

- `react`, `react-dom` — core
- `lucide-react` — icons: `import { X } from 'lucide-react'`
- `clsx` + `tailwind-merge` — conditional classes: `import { cn } from '@/lib/utils'`
- `tailwindcss` — utility classes; use ONLY the design tokens listed below

**Do not add routing, data fetching, form, HTTP, animation, or toast libraries unless the app genuinely requires them and you cannot build without them.**

## Design Token Rules — MANDATORY

Use ONLY these tokens. Never use raw hex colors, `oklch(...)`, or Tailwind palette utilities like `text-white`, `bg-gray-500`, `text-blue-600`.

**Backgrounds:** `bg-background` `bg-card` `bg-muted` `bg-primary` `bg-secondary` `bg-accent` `bg-destructive`
**Text:** `text-foreground` `text-muted-foreground` `text-primary` `text-primary-foreground` `text-card-foreground` `text-secondary-foreground` `text-destructive`
**Borders:** `border-border` `border-primary` `border-destructive`
**Border radius:** `rounded-xs` `rounded-sm` `rounded-md` `rounded-lg` `rounded-xl` `rounded-2xl`
**Shadows:** `shadow-sm` `shadow-md` `shadow-lg` `shadow-xl`

## Design Philosophy — MANDATORY

Every screen must feel considered, not assembled. Apply these principles to every UI you build:

- **One dominant element per screen**: Pick the most important thing and make it the biggest, boldest, or most prominent. Don't give equal visual weight to everything — that's how UIs look flat and unfinished.
- **Whitespace is structure**: Use generous `p-`, `gap-`, and `space-y-` values. Cramped UIs feel broken. When in doubt, add more breathing room.
- **Color directs attention**: Use `bg-primary` / `text-primary` for exactly one call-to-action per screen. Everything else should be muted or neutral. Color is not decoration — it's a signal.
- **Typography contrast**: Combine sizes and weights deliberately. A large bold heading + regular body text + small `text-muted-foreground` label is readable. All-same-size text reads as a featureless list.
- **Depth through cards**: Use `bg-card border border-border rounded-lg shadow-sm` to lift content off the background. Flat white-on-white (or dark-on-dark) UIs have no sense of space.
- **Every interactive element must respond**: Add `hover:` and `transition-colors` to every button and link. A button with no hover state looks inert and broken.
- **Scannable over readable**: Break content into chunks with clear spacing between sections. A user's eye should be able to skim the page in 2 seconds and find what they need.

## Component Rules

- **Max 250 lines per file** — if a file exceeds 250 lines, extract sub-components before continuing
- **One component per file** — no files exporting multiple unrelated components
- Keep components focused: a parent with 2-3 small children beats one large component

## Responsive Design — MANDATORY

Every layout must work on mobile (375px), tablet (768px), and desktop (1280px+).

- Always use responsive prefixes: `flex-col md:flex-row`, `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`
- Design mobile-first: the base (no prefix) style is the mobile style
- Never use fixed pixel widths on layout containers

## Accessibility — Required

- Use semantic HTML: `<nav>` `<main>` `<section>` `<article>` `<header>` `<footer>` `<button>` `<a>`
- Every `<img>` needs descriptive `alt` text
- Every form input needs a `<label>` with matching `htmlFor`
- Never use `<div onClick>` — use `<button>` or `<a href>`
- Interactive elements must be reachable by keyboard (Tab + Enter/Space)

## External Services & API Keys — Do This BEFORE Writing API Code

If the app uses any third-party service (AI, payments, maps, email, storage, etc.), follow these steps **in order**:

**Step 1 — Write the `.env` placeholder first, before any code that calls the service:**

Exact format — copy exactly, no variation allowed:
```
# https://the-exact-page-where-the-user-gets-their-api-key.com
VITE_SERVICE_NAME=
```

Rules:
- The comment line MUST start with `# https://` — link directly to where the user signs up or gets the key
- The variable line MUST end with `=` and nothing else — no quotes, no spaces, no text after `=`
- NEVER write `VITE_KEY=your-key-here` or `VITE_KEY=""` or `VITE_KEY=placeholder` — the value after `=` must be completely empty

**Step 2 — Access it in code:**
```typescript
import.meta.env.VITE_SERVICE_NAME
```

**Step 3 — Guard every usage against a missing key:**
```typescript
if (!import.meta.env.VITE_SERVICE_NAME) {
  alert('Add your API key in the chat to continue.')
  return
}
```

## Before Finishing — MANDATORY

Run `npm run build` from `/workspace` before writing your reply.

- **If it fails:** read every error carefully, fix all of them, then run `npm run build` again
- **Repeat** until `npm run build` exits with code 0 — no exceptions
- **Also check** `/workspace/tmp/vite.log` — if it contains ERROR lines, fix those too
- **Do NOT write your reply** until the build exits with code 0

## Reply Format — MANDATORY

After finishing, write 1-3 plain English sentences for the user:

- Start directly with what the user sees or can do — use "you" or "the app"
- NEVER begin with: "All done", "Done", "I've", "I have", "No errors", "Let me", "Now I"
- NEVER mention TypeScript, type errors, build results, file names, component names, CSS classes, or any technical term
- Write as if describing the finished result to a friend who has never written code
- No placeholder language — describe the real thing

## Never Do

- Import a library not listed under Available Packages
- Use raw colors, hex values, or Tailwind palette utilities instead of design tokens
- Write `style={{ ... }}` inline styles — use Tailwind only
- Use emoji as icons — use lucide-react
- Write placeholder text ("Lorem ipsum", "Coming soon", "TODO") — every label and message should be real
- Build a layout that only works on desktop
- Use `<div onClick>` for interactive elements
- Run `npm install` or edit `package.json`
- Edit any file marked "do not edit" above
- Make sweeping multi-file refactors in one turn — complete one coherent change before starting the next
- Install or use Playwright, Puppeteer, or any browser automation tool
- Take screenshots or attempt visual verification — Vite HMR handles live updates
