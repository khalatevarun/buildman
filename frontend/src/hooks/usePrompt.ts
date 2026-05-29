import { useDispatch } from 'react-redux'
import { toast } from 'sonner'
import {
  appendChatOutput,
  pushActivity,
  finalizeMessage,
  addCheckpoint,
  setStreaming,
  addUserMessage,
  setEnvNeeded,
  setProjectName,
  store,
} from '../store'
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

    const flushBuffer = () => {
      if (outputBuffer) {
        dispatch(appendChatOutput(outputBuffer))
        outputBuffer = ''
      }
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
          if (event.type === 'output') {
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
            flushBuffer()
            dispatch(appendChatOutput(`\n\n⚠️ ${event.text}`))
          }
          if (event.type === 'env_needed') dispatch(setEnvNeeded(event.vars))
          if (event.type === 'done') {
            flushBuffer()
            gotDone = true
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
      flushBuffer()
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

      // Check Vite for errors after Claude finishes
      api.get(`/vite-logs?user_id=${userId}`).then(({ data }) => {
        if (data.isEnvError) {
          // Only show generic env prompt if env popup isn't already queued from the agent scan
          const currentEnv = store.getState().app.envNeeded
          if (!currentEnv?.length) {
            dispatch(setEnvNeeded([{
              name: 'VITE_API_KEY',
              service: null,
              url: null,
              hint: 'The preview is returning auth errors — check your API key',
            }]))
          }
        } else if (data.isCodeError && data.logs) {
          // Auto-fix: send the error lines back to Claude without user action
          const errorLines = data.logs
            .split('\n')
            .filter((l: string) => /error/i.test(l))
            .slice(0, 5)
            .join('\n')
          if (errorLines.trim()) {
            sendPrompt(`The preview is showing an error. Fix it:\n\n${errorLines}`)
          }
        }
      }).catch(() => {})
    }
  }

  return { sendPrompt }
}
