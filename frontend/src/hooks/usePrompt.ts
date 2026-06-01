import { useDispatch } from 'react-redux'
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
  store,
} from '../store'

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
import { api, API_URL } from '../utility/api'

export function usePrompt(userId: string | null, projectId: string | null) {
  const dispatch = useDispatch()

  const sendPrompt = async (text: string) => {
    if (!userId) return
    dispatch(addUserMessage(text))
    dispatch(setStreaming(true))

    let response: Response
    try {
      response = await fetch(`${API_URL}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    const isFirstMessage = store.getState().app.messages.filter(m => m.role === 'user').length === 1
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
            const lastSentence = extractLastSentence(fullOutput)
            if (lastSentence) dispatch(setAssistantFinalText(lastSentence))
            dispatch(finalizeMessage([...activities]))
            if (event.commitHash) {
              dispatch(addCheckpoint({ hash: event.commitHash, timestamp: Date.now() }))
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

    // Fire-and-forget: persist chat history to volume and check for Vite errors
    if (projectId) {
      const state = store.getState()
      api.post(`/projects/${projectId}/chat`, {
        user_id: userId,
        messages: state.app.messages,
        checkpoints: state.app.checkpoints,
      }).catch(() => {})

    }
  }

  const stopPrompt = async () => {
    if (!userId) return
    try {
      await api.post('/stop', { user_id: userId })
    } catch { /* best effort */ }
  }

  return { sendPrompt, stopPrompt }
}
