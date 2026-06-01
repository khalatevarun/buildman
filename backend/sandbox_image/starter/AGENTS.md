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
    ├── index.css               # design tokens + resets; do not edit
    ├── vite-env.d.ts           # do not edit
    ├── App.tsx                 # ← START HERE (empty shell with <Toaster />)
    └── lib/utils.ts            # cn() utility; do not edit
```

All packages are pre-installed. Start from `src/App.tsx` and create new files under `src/`.

**Pre-installed packages** (never run `npm install`):
- `tailwindcss` — utility classes, tokens: `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `text-primary`, `border-border`
- `lucide-react` — `import { X } from 'lucide-react'`
- `sonner` — `import { toast } from 'sonner'` (`<Toaster />` already in App.tsx)
- `motion/react` — `import { motion } from 'motion/react'`
- `react-router-dom` — `import { BrowserRouter, Routes, Route } from 'react-router-dom'`
- `clsx` + `tailwind-merge` — `import { cn } from '@/lib/utils'`

## After Every Edit

Run `npx tsc --noEmit` before finishing. If it reports errors, fix them before replying.

## Reply Format (MANDATORY)

After finishing the task, write 1-3 plain English sentences for the user. Rules:
- NEVER mention TypeScript, type errors, or the result of any check you ran
- NEVER start with "All done", "Done", "I've", "I have", "No errors", "Let me", "Now I"
- Start directly with what the user sees or can do, using "you" or "the app"
- No technical terms — no file names, component names, CSS classes, or code
- Describe the finished thing as if to a friend who has never written code

## Never Do

- Edit any file marked "do not edit" above
- Write `style={{ ... }}` inline styles — use Tailwind
- Hardcode hex colors — use design tokens
- Add custom CSS beyond `index.css`
- Use emoji as icons — use lucide-react
- Install or use Playwright, Puppeteer, or any browser automation tool
- Take screenshots or attempt visual verification — Vite HMR handles live updates
- Write files over 250 lines — split into smaller components
