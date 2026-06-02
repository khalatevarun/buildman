import { useCallback } from 'react'
import { toast } from 'sonner'
import {
  appendChatOutput,
  addAssistantMessage,
  pushActivity,
  finalizeMessage,
  addCheckpoint,
  setStreaming,
  addUserMessage,
  setEnvNeeded,
  setProjectName,
  clearQueue,
  cancelLastExchange,
  setPendingInput,
  setAssistantFinalText,
  useAppDispatch,
  useAppSelector,
} from '../store'
import { api, API_URL } from '../utility/api'

function extractLastSentence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return trimmed
  const parts = trimmed.split(/(?<=[.!?])\s+/)
  for (let i = parts.length - 1; i >= 0; i--) {
    const s = parts[i].trim()
    if (s.length > 15) return s
  }
  return parts[parts.length - 1].trim()
}

export function usePrompt(userId: string | null, projectId: string | null, getToken: (() => Promise<string | null>) | null) {
  const dispatch = useAppDispatch()
  // messages is read at call time (sendPrompt is not memoized), so this is always fresh
  const messages = useAppSelector(s => s.app.messages)

  // Not wrapped in useCallback — this function must close over fresh `messages` on every call.
  // Callers that store it across renders (e.g. Workspace streaming effect) use a ref.
  const sendPrompt = async (text: string) => {
    if (!userId) return
    const isFirstMessage = messages.filter(m => m.role === 'user').length === 0
    dispatch(addUserMessage(text))
    dispatch(setStreaming(true))

    let response: Response
    try {
      const token = await getToken?.()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      response = await fetch(`${API_URL}/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ user_id: userId, text }),
      })
    } catch (err) {
      dispatch(setStreaming(false))
      toast.error('Connection error — please try again')
      throw err
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      dispatch(appendChatOutput(`\n\n⚠️ Request failed (${response.status}): ${errBody || response.statusText}`))
      dispatch(setStreaming(false))
      return
    }

    if (!response.body) {
      dispatch(setStreaming(false))
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const activities: string[] = []
    let gotDone = false
    let nameParsed = !isFirstMessage
    let outputBuffer = ''
    let fullOutput = ''

    const flushBuffer = () => {
      if (outputBuffer) {
        dispatch(appendChatOutput(outputBuffer))
        outputBuffer = ''
      }
    }

    const finishNameParsing = () => {
      flushBuffer()
      nameParsed = true
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
      for (const line of lines) {
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === 'new_turn') {
            dispatch(addAssistantMessage())
          }
          if (event.type === 'output') {
            fullOutput += event.text
            if (!nameParsed) {
              outputBuffer += event.text
              const match = outputBuffer.match(/<name>(.*?)<\/name>/)
              if (match) {
                nameParsed = true
                const aiName = match[1].trim()
                dispatch(setProjectName(aiName))
                if (projectId) {
                  api.patch(`/projects/${projectId}`, { user_id: userId, name: aiName }).catch(() => {})
                }
                const cleaned = outputBuffer.replace(/<name>.*?<\/name>\n?/, '').trim()
                if (cleaned) dispatch(appendChatOutput(cleaned))
                outputBuffer = ''
              }
            } else {
              dispatch(appendChatOutput(event.text))
            }
          }
          if (event.type === 'activity') {
            activities.push(event.text)
            dispatch(pushActivity(event.text))
          }
          if (event.type === 'error') {
            finishNameParsing()
            dispatch(appendChatOutput(`\n\n⚠️ ${event.text}`))
          }
          if (event.type === 'build_error') {
            dispatch(appendChatOutput(`\n\n⚠️ The app has build errors — describe what you wanted and I'll fix it.`))
          }
          if (event.type === 'stopped') {
            finishNameParsing()
            dispatch(clearQueue())
            dispatch(cancelLastExchange())
            dispatch(setPendingInput(text))
            dispatch(finalizeMessage([...activities]))
            dispatch(setStreaming(false))
            return
          }
          if (event.type === 'env_needed') dispatch(setEnvNeeded(event.vars))
          if (event.type === 'done') {
            finishNameParsing()
            gotDone = true
            const cleanedOutput = fullOutput.replace(/<name>.*?<\/name>\n?/g, '').trim()
            const lastSentence = extractLastSentence(cleanedOutput)
            if (lastSentence) dispatch(setAssistantFinalText(lastSentence))
            dispatch(finalizeMessage([...activities]))
            if (event.commitHash) {
              dispatch(addCheckpoint({ hash: event.commitHash, timestamp: Date.now(), buildBroken: event.buildStatus === 'broken' }))
            }
            dispatch(setStreaming(false))
          }
        } catch { /* malformed event */ }
      }
    }

    if (!gotDone) {
      finishNameParsing()
      dispatch(finalizeMessage([...activities]))
      dispatch(setStreaming(false))
    }
  }

  // Chat persistence is handled by a useEffect in Workspace that watches streaming→false,
  // where it reads fully-updated messages/checkpoints from the triggering render.

  const stopPrompt = useCallback(async () => {
    if (!userId) return
    try {
      await api.post('/stop', { user_id: userId })
    } catch { /* best effort */ }
  }, [userId])

  return { sendPrompt, stopPrompt }
}
