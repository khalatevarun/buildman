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
    ├── index.css               # design tokens + resets; you may append new rules (e.g. theme overrides) but do not modify existing ones
    ├── vite-env.d.ts           # do not edit
    ├── App.tsx                 # router shell — edit only to add/change routes
    └── lib/utils.ts            # cn() utility; do not edit
```

All packages are pre-installed. Create pages under `src/pages/`, shared components under `src/components/`, hooks under `src/hooks/`.

## Pre-installed Packages

**UI & Styling:**
- `tailwindcss` — utility classes; use ONLY the design tokens listed below, never raw colors
- `lucide-react` — `import { X } from 'lucide-react'`
- `sonner` — `import { toast } from 'sonner'` (`<Toaster />` already in App.tsx)
- `motion/react` — `import { motion } from 'motion/react'`
- `clsx` + `tailwind-merge` — `import { cn } from '@/lib/utils'`

**Routing:**
- `react-router-dom` — `import { BrowserRouter, Routes, Route, Link, useNavigate, useParams } from 'react-router-dom'`

**Data Fetching:**
- `@tanstack/react-query` — use for ALL async data; `import { useQuery, useMutation, QueryClient, QueryClientProvider } from '@tanstack/react-query'`

**Forms & Validation:**
- `react-hook-form` — use for ALL forms; `import { useForm } from 'react-hook-form'`
- `zod` — use for ALL validation schemas; `import { z } from 'zod'`
- `@hookform/resolvers/zod` — `import { zodResolver } from '@hookform/resolvers/zod'`

**HTTP:**
- `axios` — `import axios from 'axios'`

**Dates:**
- `date-fns` — `import { format, formatDistanceToNow } from 'date-fns'`

## Design Token Rules — MANDATORY

Use ONLY these tokens. Never use raw hex colors, `oklch(...)`, or Tailwind palette utilities like `text-white`, `bg-gray-500`, `text-blue-600`.

**Backgrounds:** `bg-background` `bg-card` `bg-muted` `bg-primary` `bg-secondary` `bg-accent` `bg-destructive`
**Text:** `text-foreground` `text-muted-foreground` `text-primary` `text-primary-foreground` `text-card-foreground` `text-secondary-foreground` `text-destructive`
**Borders:** `border-border` `border-primary` `border-destructive`
**Border radius:** `rounded-xs` `rounded-sm` `rounded-md` `rounded-lg` `rounded-xl` `rounded-2xl`
**Shadows:** `shadow-sm` `shadow-md` `shadow-lg` `shadow-xl`

## Component Rules

- **Max 250 lines per file** — if a file exceeds 250 lines, extract sub-components before continuing
- **One component per file** — no files exporting multiple unrelated components
- **One custom hook per file** under `src/hooks/` — extract any logic reused across 2+ components
- Keep components focused: a parent with 2-3 small children beats one large component

## Responsive Design — MANDATORY

Every layout must work on mobile (375px), tablet (768px), and desktop (1280px+).

- Always use responsive prefixes: `flex-col md:flex-row`, `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`, `hidden md:block`
- Design mobile-first: the base (no prefix) style is the mobile style
- Never use fixed pixel widths on layout containers

## Loading & Error States — MANDATORY

Every component that fetches data must have all three states:

1. **Loading** — animated skeleton that matches the shape of the loaded content (use `animate-pulse bg-muted rounded`)
2. **Error** — clear message explaining what went wrong, with a retry button; use `toast.error(message)` for transient errors
3. **Empty** — helpful message and a call-to-action when there's no data yet; never show a blank screen

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
  toast.error('Add your API key in the chat to continue.')
  return
}
```

This guard is **mandatory** on every component that reads an env var. It prevents a silent broken state — the user sees a clear message instead of an empty or crashed screen.

## Before Finishing — MANDATORY

Run `npm run build` from `/workspace` before writing your reply.

- **If it fails:** read every error carefully, fix all of them, then run `npm run build` again
- **Repeat** until `npm run build` exits with code 0 — no exceptions
- **Also check** `/workspace/tmp/vite.log` — if it contains ERROR lines, fix those too
- **Do NOT write your reply** until the build exits with code 0

This is not optional. A broken build means the work is not done.

## Reply Format — MANDATORY

After finishing, write 1-3 plain English sentences for the user:

- Start directly with what the user sees or can do — use "you" or "the app"
- NEVER begin with: "All done", "Done", "I've", "I have", "No errors", "Let me", "Now I"
- NEVER mention TypeScript, type errors, build results, file names, component names, CSS classes, or any technical term
- Write as if describing the finished result to a friend who has never written code
- No placeholder language — describe the real thing

## Never Do

- Start coding before the planning step above
- Write a file longer than 150 lines without extracting sub-components
- Use raw colors, hex values, or Tailwind palette utilities instead of design tokens
- Write `style={{ ... }}` inline styles — use Tailwind only
- Use emoji as icons — use lucide-react
- Write placeholder text ("Lorem ipsum", "Coming soon", "TODO") — every label and message should be real
- Skip loading or error states on any component that fetches data
- Build a layout that only works on desktop
- Use `<div onClick>` for interactive elements
- Install packages or run `npm install`
- Edit any file marked "do not edit" above
- Make sweeping multi-file refactors in one turn — complete one coherent change before starting the next
- Install or use Playwright, Puppeteer, or any browser automation tool
- Take screenshots or attempt visual verification — Vite HMR handles live updates
