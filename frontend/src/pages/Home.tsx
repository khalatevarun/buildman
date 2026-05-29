import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from '@clerk/clerk-react'
import { useSandbox } from '../hooks/useSandbox'
import { SCATTERED } from '../data/prompts'

export function Home() {
  const { user } = useUser()
  const navigate = useNavigate()
  const { createProject, status, phase } = useSandbox(user?.id ?? null)
  const [prompt, setPrompt] = useState('')
  const [focused, setFocused] = useState(false)
  const [mousePos, setMousePos] = useState({ x: -9999, y: -9999 })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  const handleStart = async () => {
    if (!prompt.trim() || !user || status === 'creating') return
    const projectId = await createProject(prompt.trim())
    navigate(`/workspace/${projectId}`, { state: { initialPrompt: prompt.trim() } })
  }

  const isLoading = status === 'creating'

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      {/* Torch layer */}
      <div
        className="absolute inset-0 z-0"
        style={{
          WebkitMaskImage: `radial-gradient(circle 260px at ${mousePos.x}px ${mousePos.y}px, black 50%, transparent 90%)`,
          maskImage: `radial-gradient(circle 260px at ${mousePos.x}px ${mousePos.y}px, black 50%, transparent 90%)`,
        }}
      >
        {SCATTERED.map((item, i) => (
          <button
            key={i}
            onClick={() => { setPrompt(item.text); textareaRef.current?.focus() }}
            className="absolute text-xs text-foreground/80 whitespace-nowrap px-3 py-1.5 rounded-xl border border-border/70 bg-card hover:text-foreground hover:border-border transition-colors duration-100 cursor-pointer"
            style={{ left: `${item.x}%`, top: `${item.y}%`, transform: 'translateX(-50%)' }}
          >
            {item.text}
          </button>
        ))}
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-4">
        <span className="text-sm font-semibold tracking-tight text-muted-foreground font-heading">
          Buildman
        </span>

        <div className="flex items-center gap-3">
          <SignedOut>
            <SignInButton>
              <button className="text-xs px-3 py-1.5 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150">
                Sign in
              </button>
            </SignInButton>
          </SignedOut>

          <SignedIn>
            <Link
              to="/projects"
              className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors duration-150 no-underline"
            >
              Projects
            </Link>
            <UserButton />
          </SignedIn>
        </div>
      </nav>

      {/* Hero + input */}
      <div className="relative z-10 flex-1 flex flex-col items-center pt-[14vh] px-4 pb-16 pointer-events-none">
        <h1
          className="font-heading text-center font-semibold mb-8 text-foreground"
          style={{ fontSize: 'clamp(32px, 5vw, 52px)', letterSpacing: '-0.04em', lineHeight: 1.06 }}
        >
          Turn any idea into<br />a live app
        </h1>

        <div className="w-full max-w-[520px] pointer-events-auto">
          <div
            className={`relative rounded-2xl overflow-hidden transition-all duration-200 bg-card border ${focused ? 'border-border/60 ring-2 ring-ring/20' : 'border-border'}`}
          >
            <textarea
              ref={textareaRef}
              rows={3}
              className="w-full bg-transparent text-sm resize-none focus:outline-none px-5 pt-4 pb-12 leading-relaxed text-foreground placeholder:text-muted-foreground/50"
              style={{ letterSpacing: '-0.01em' }}
              placeholder="Describe what you want to build…"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleStart()
                }
              }}
            />
            <div className="absolute bottom-3 left-5 right-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground/50">
                {isLoading ? (phase ?? 'Starting…') : '⌘↵ to build'}
              </span>
              <button
                onClick={handleStart}
                disabled={!prompt.trim() || isLoading}
                className={`flex items-center justify-center w-8 h-8 rounded-xl transition-all duration-150 disabled:cursor-not-allowed ${prompt.trim() && !isLoading ? 'bg-primary text-primary-foreground hover:brightness-110' : 'bg-muted text-muted-foreground'}`}
              >
                {isLoading ? (
                  <span
                    className="w-3.5 h-3.5 rounded-full border-[1.5px] border-primary-foreground/30 border-t-transparent"
                    style={{ animation: 'spin 0.7s linear infinite' }}
                  />
                ) : (
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path
                      d="M6.5 11V2M6.5 2L2.5 6M6.5 2L10.5 6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
