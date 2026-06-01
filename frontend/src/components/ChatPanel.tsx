import { useRef, useEffect, useState, useMemo, useCallback, memo } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { api } from '../utility/api'
import {
  setPreviewingHash,
  setEnvNeeded,
  restoreHistory,
  enqueuePrompt,
  removeFromQueue,
  setPendingInput,
  useAppDispatch,
  useAppSelector,
} from '../store'
import { ActivityTicker } from './ActivityTicker'
import { CheckpointCard } from './CheckpointCard'
import { EnvVarCard } from './EnvVarCard'

const THINKING_WORDS = [
  'Building', 'Writing', 'Designing', 'Coding', 'Crafting',
  'Computing', 'Generating', 'Thinking', 'Creating', 'Working',
]

interface Props {
  onSend: (text: string) => void
  onStop: () => void
  userId: string | null
  publishingHash: string | null
  onDeploy: (hash: string) => Promise<string>
  projectName: string | null
}

const ThinkingText = memo(function ThinkingText({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [text])
  return (
    <div
      ref={ref}
      className="max-h-[72px] overflow-y-hidden"
      style={{ scrollbarWidth: 'none' }}
    >
      <div className="text-[10.5px] leading-relaxed text-muted-foreground/35 font-mono whitespace-pre-wrap break-words">
        {text}
      </div>
    </div>
  )
})

function ThinkingDots({ word }: { word: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-[3px] h-4">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-[3px] h-[3px] rounded-full bg-muted-foreground/40"
            style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </span>
      {word && (
        <span className="text-[11px] font-mono text-muted-foreground/50">
          {word}…
        </span>
      )}
    </span>
  )
}

export function ChatPanel({ onSend, onStop, userId, publishingHash, onDeploy, projectName }: Props) {
  const dispatch = useAppDispatch()
  const messages = useAppSelector(s => s.app.messages)
  const streaming = useAppSelector(s => s.app.streaming)
  const liveActivity = useAppSelector(s => s.app.liveActivity)
  const checkpoints = useAppSelector(s => s.app.checkpoints)
  const previewingHash = useAppSelector(s => s.app.previewingHash)
  const envNeeded = useAppSelector(s => s.app.envNeeded)
  const deployedHash = useAppSelector(s => s.app.deployedHash)
  const promptQueue = useAppSelector(s => s.app.promptQueue)
  const pendingInput = useAppSelector(s => s.app.pendingInput)
  const [input, setInput] = useState('')
  const [thinkingWord, setThinkingWord] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pendingInput) {
      setInput(pendingInput)
      dispatch(setPendingInput(null))
    }
  }, [pendingInput, dispatch])

  useEffect(() => {
    if (streaming) setThinkingWord(THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)])
  }, [streaming])

  const handleEnvSubmit = useCallback(async (values: Record<string, string>) => {
    if (!userId) return
    await api.post('/set-env', { user_id: userId, vars: values })
    dispatch(setEnvNeeded(null))
  }, [userId, dispatch])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, liveActivity])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || previewingHash || publishingHash) return
    setInput('')
    if (streaming) {
      dispatch(enqueuePrompt(text))
      return
    }
    onSend(text)
  }, [input, previewingHash, publishingHash, streaming, dispatch, onSend])

  const handlePreview = useCallback(async (hash: string) => {
    if (!userId) return
    if (checkpoints[checkpoints.length - 1]?.hash === hash) return
    await api.post('/preview', { user_id: userId, hash })
    dispatch(setPreviewingHash(hash))
  }, [userId, checkpoints, dispatch])

  const handleRestore = useCallback(async (hash: string) => {
    if (!userId) return
    const { data } = await api.post<{ ok: boolean; messages: typeof messages; checkpoints: typeof checkpoints }>(
      '/restore', { user_id: userId, hash }
    )
    if (data?.messages && data?.checkpoints) {
      dispatch(restoreHistory({ messages: data.messages, checkpoints: data.checkpoints }))
    }
  }, [userId, dispatch]) // messages/checkpoints only used for the response type annotation

  // Pre-compute checkpoint index for each message — avoids a mutable counter in render
  const checkpointIndices = useMemo(() => {
    let count = 0
    return messages.map(m => (m.isFinal ? count++ : -1))
  }, [messages])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Nav header */}
      <div className="flex items-center justify-between px-4 h-10 shrink-0 border-b border-border">
        <Link
          to="/apps"
          className="flex items-center text-foreground hover:text-white transition-colors duration-150 no-underline"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M6.5 1.5L2 5l4.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>
        <span className="text-[11px] font-semibold tracking-tight text-foreground/85 font-heading truncate max-w-[180px]">
          {projectName ?? 'Buildman'}
        </span>
        <div className="w-[10px]" />
      </div>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-5 space-y-5" style={{ scrollbarWidth: 'none' }}>
        {messages.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={i} className="flex justify-end px-4">
                <div className="max-w-[82%] text-[13px] leading-[1.55] text-foreground/85 px-3 py-2 rounded-2xl rounded-tr-sm bg-muted">
                  {m.text}
                </div>
              </div>
            )
          }

          const cpIndex = checkpointIndices[i]
          const checkpoint = cpIndex >= 0 ? checkpoints[cpIndex] : undefined
          const isLastMessage = i === messages.length - 1
          const isActiveMessage = isLastMessage && streaming
          const tickerItems = isActiveMessage ? liveActivity : (m.activities ?? [])

          return (
            <div key={i} className="flex flex-col gap-2">
              <div className="px-4">
                {(() => {
                  const thinkingText = isActiveMessage ? m.text : null
                  return (
                    <>
                      {thinkingText ? (
                        <ThinkingText text={thinkingText} />
                      ) : isActiveMessage && liveActivity.length === 0 ? (
                        <ThinkingDots word={thinkingWord} />
                      ) : null}
                      {!isActiveMessage && m.text && (
                        <div className={`
                          text-[13px] leading-[1.65] text-foreground/75
                          prose prose-invert prose-sm max-w-none
                          prose-p:my-[0.4em] prose-p:text-foreground/75 prose-p:leading-[1.65]
                          prose-headings:text-foreground/85 prose-headings:font-heading prose-headings:font-semibold prose-headings:tracking-tight
                          prose-strong:text-foreground/90 prose-strong:font-semibold
                          prose-code:text-primary prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[11.5px] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                          prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-pre:text-[11.5px]
                          prose-ul:text-foreground/70 prose-li:text-foreground/70 prose-li:my-[0.2em]
                          prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                        `}>
                          <ReactMarkdown>{m.text}</ReactMarkdown>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>

              {tickerItems.length > 0 && (
                <ActivityTicker items={tickerItems} streaming={isActiveMessage} />
              )}

              {!isActiveMessage && checkpoint && (
                <CheckpointCard
                  hash={checkpoint.hash}
                  timestamp={checkpoint.timestamp}
                  versionNumber={cpIndex + 1}
                  totalVersions={checkpoints.length}
                  isDeployed={checkpoint.hash === deployedHash}
                  publishing={publishingHash === checkpoint.hash}
                  onPreview={handlePreview}
                  onRestore={handleRestore}
                  onDeploy={onDeploy}
                />
              )}
            </div>
          )
        })}

        {streaming && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex flex-col gap-2">
            {liveActivity.length === 0 && (
              <div className="px-4">
                <ThinkingDots word={thinkingWord} />
              </div>
            )}
            {liveActivity.length > 0 && (
              <ActivityTicker items={liveActivity} streaming={true} />
            )}
          </div>
        )}

        {envNeeded && envNeeded.length > 0 && !streaming && (
          <div className="px-4">
            <EnvVarCard groups={envNeeded} onSubmit={handleEnvSubmit} />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Gradient fade into input */}
      <div
        className="pointer-events-none h-10 shrink-0 bg-gradient-to-b from-transparent to-background"
        style={{ marginTop: -40 }}
      />

      {/* Input area */}
      <div className="px-3 pb-3 pt-1">
        {previewingHash && (
          <p className="mb-2 text-[11px] text-muted-foreground/50 text-center tracking-wide">
            Viewing earlier version · prompts paused
          </p>
        )}

        {/* Queued prompts */}
        {promptQueue.length > 0 && !previewingHash && (
          <div className="mb-1.5 flex flex-col gap-1">
            {promptQueue.map((item, i) => (
              <div key={`${i}:${item}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/60 border border-border/40">
                <span className="text-[10px] text-muted-foreground/30 shrink-0">↳</span>
                <span className="flex-1 text-[12px] text-muted-foreground/60 truncate">{item}</span>
                <button
                  onClick={() => dispatch(removeFromQueue(i))}
                  className="text-[13px] leading-none text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors shrink-0"
                  aria-label="Remove from queue"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative">
          <textarea
            className="w-full text-[13px] text-foreground/80 rounded-xl px-3.5 py-2.5 pr-10 resize-none focus:outline-none placeholder:text-muted-foreground/40 leading-relaxed transition-colors duration-150 bg-muted border border-border focus:border-border/60"
            rows={3}
            placeholder={streaming ? 'Queue a follow-up…' : 'Describe what to change…'}
            value={input}
            disabled={!!previewingHash || !!publishingHash}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          {streaming ? (
            <button
              onClick={onStop}
              className="absolute bottom-2.5 right-2.5 w-6 h-6 flex items-center justify-center rounded-md transition-all duration-150 bg-muted hover:bg-card text-muted-foreground"
              aria-label="Stop"
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor">
                <rect x="0" y="0" width="9" height="9" rx="1.5"/>
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !!previewingHash || !!publishingHash}
              className="absolute bottom-2.5 right-2.5 w-6 h-6 flex items-center justify-center rounded-md transition-all duration-150 disabled:opacity-20 disabled:cursor-not-allowed bg-muted hover:bg-card text-muted-foreground"
              aria-label="Send"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M5.5 9.5V1.5M5.5 1.5L2 5M5.5 1.5L9 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
