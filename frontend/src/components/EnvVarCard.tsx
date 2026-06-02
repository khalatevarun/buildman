import { useState } from 'react'
import type { EnvVarGroup } from '../store'

interface Props {
  groups: EnvVarGroup[]
  onSubmit: (values: Record<string, string>) => Promise<void>
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M1 6.5C1 6.5 2.8 2.5 6.5 2.5C10.2 2.5 12 6.5 12 6.5C12 6.5 10.2 10.5 6.5 10.5C2.8 10.5 1 6.5 1 6.5Z" stroke="currentColor" strokeWidth="1.1"/>
      <circle cx="6.5" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M2 2L11 11" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M1 6.5C1 6.5 2.8 2.5 6.5 2.5C10.2 2.5 12 6.5 12 6.5C12 6.5 10.2 10.5 6.5 10.5C2.8 10.5 1 6.5 1 6.5Z" stroke="currentColor" strokeWidth="1.1"/>
      <circle cx="6.5" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
      <path d="M1.5 7.5L7.5 1.5M7.5 1.5H3.5M7.5 1.5V5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function formatLabel(varName: string): string {
  return varName
    .replace(/^VITE_/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
}

export function EnvVarCard({ groups, onSubmit }: Props) {
  const allVars = groups.flatMap(g => g.vars)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(allVars.map(v => [v, '']))
  )
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const allFilled = allVars.every(v => values[v]?.trim())

  const handleSubmit = async () => {
    if (!allFilled || saving) return
    setSaving(true)
    try {
      await onSubmit(values)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  if (saved) {
    return (
      <div className="rounded-xl px-4 py-3 text-[12px] flex items-center gap-2.5 bg-muted border border-border">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 6.5L4.5 9L10 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/50"/>
        </svg>
        <span className="text-muted-foreground/45">Saved — preview restarting</span>
      </div>
    )
  }

  return (
    <div className="rounded-xl overflow-hidden bg-muted border border-border">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-muted-foreground/35 shrink-0">
          <rect x="1" y="6" width="10" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M3.5 6V4C3.5 2.62 4.62 1.5 6 1.5C7.38 1.5 8.5 2.62 8.5 4V6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
          <circle cx="6" cy="8.5" r="0.8" fill="currentColor"/>
        </svg>
        <span className="text-[12px] font-medium text-muted-foreground/45" style={{ letterSpacing: '-0.01em' }}>
          Add Environment Variables
        </span>
      </div>

      {/* Groups */}
      <div className="divide-y divide-border">
        {groups.map((group, i) => (
          <div key={i} className="px-4 py-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-medium text-foreground/40">{group.service}</span>
              {group.url && (
                <a
                  href={group.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] transition-colors duration-100 shrink-0 text-foreground/35 hover:text-foreground/65"
                >
                  Get keys <ExternalLinkIcon />
                </a>
              )}
            </div>
            {group.vars.map(varName => (
              <div key={varName} className="flex flex-col gap-1.5">
                <span className="text-[11px] font-mono tracking-tight text-foreground/45">
                  {formatLabel(varName)}
                </span>
                <div className="relative">
                  <input
                    type={revealed[varName] ? 'text' : 'password'}
                    value={values[varName]}
                    placeholder="Paste value…"
                    onChange={e => setValues(prev => ({ ...prev, [varName]: e.target.value }))}
                    className="w-full text-[12px] font-mono rounded-lg px-3 py-2 pr-9 focus:outline-none transition-colors duration-150 placeholder:text-muted-foreground/30 bg-background border border-border focus:border-border/60 text-foreground/80"
                  />
                  <button
                    type="button"
                    onClick={() => setRevealed(prev => ({ ...prev, [varName]: !prev[varName] }))}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/25 hover:text-muted-foreground/50 transition-colors duration-100"
                    tabIndex={-1}
                  >
                    <EyeIcon open={!!revealed[varName]} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 pb-4 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!allFilled || saving}
          className={`w-full py-2 rounded-lg text-[12px] font-medium transition-all duration-150 disabled:cursor-not-allowed ${allFilled && !saving ? 'bg-primary text-primary-foreground hover:brightness-110' : 'bg-muted text-muted-foreground/30'}`}
          style={{ letterSpacing: '-0.01em' }}
        >
          {saving ? 'Saving…' : 'Save & restart preview'}
        </button>
      </div>
    </div>
  )
}
