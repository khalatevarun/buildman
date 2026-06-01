import { configureStore, createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import type { TypedUseSelectorHook } from 'react-redux'

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  activities: string[]
  stopped?: boolean
  isFinal?: boolean
  thinking?: string
}

interface CheckpointEntry {
  hash: string
  timestamp: number
}

export interface EnvVarGroup {
  service: string
  url: string | null
  vars: string[]
}

interface AppState {
  messages: ChatMessage[]
  liveActivity: string[]
  checkpoints: CheckpointEntry[]
  previewingHash: string | null
  streaming: boolean
  envNeeded: EnvVarGroup[] | null
  deployedHash: string | null
  deployedUrl: string | null
  projectName: string | null
  promptQueue: string[]
  pendingInput: string | null
}

const initialState: AppState = {
  messages: [],
  liveActivity: [],
  checkpoints: [],
  previewingHash: null,
  streaming: false,
  envNeeded: null,
  deployedHash: null,
  deployedUrl: null,
  projectName: null,
  promptQueue: [],
  pendingInput: null,
}

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    addUserMessage(state, action: PayloadAction<string>) {
      state.messages.push({ role: 'user', text: action.payload, activities: [] })
      state.liveActivity = []
    },
    addAssistantMessage(state) {
      state.messages.push({ role: 'assistant', text: '', activities: [] })
    },
    appendChatOutput(state, action: PayloadAction<string>) {
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'assistant') {
        last.text += action.payload
      } else {
        state.messages.push({ role: 'assistant', text: action.payload, activities: [] })
      }
    },
    pushActivity(state, action: PayloadAction<string>) {
      state.liveActivity.push(action.payload)
    },
    // Commits the accumulated liveActivity to the last assistant message and clears the live list
    finalizeMessage(state, action: PayloadAction<string[]>) {
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'assistant') {
        last.activities = action.payload
        last.isFinal = true
      }
      state.liveActivity = []
    },
    addCheckpoint(state, action: PayloadAction<{ hash: string; timestamp: number }>) {
      state.checkpoints.push(action.payload)
    },
    setPreviewingHash(state, action: PayloadAction<string | null>) {
      state.previewingHash = action.payload
    },
    setStreaming(state, action: PayloadAction<boolean>) {
      state.streaming = action.payload
    },
    setEnvNeeded(state, action: PayloadAction<EnvVarGroup[] | null>) {
      state.envNeeded = action.payload
    },
    setDeployedHash(state, action: PayloadAction<string | null>) {
      state.deployedHash = action.payload
    },
    setDeployedUrl(state, action: PayloadAction<string | null>) {
      state.deployedUrl = action.payload
    },
    setProjectName(state, action: PayloadAction<string | null>) {
      state.projectName = action.payload
    },
    restoreHistory(state, action: PayloadAction<{ messages: ChatMessage[]; checkpoints: CheckpointEntry[] }>) {
      state.messages = action.payload.messages
      state.checkpoints = action.payload.checkpoints
    },
    enqueuePrompt(state, action: PayloadAction<string>) {
      state.promptQueue.push(action.payload)
    },
    dequeuePrompt(state) {
      state.promptQueue.shift()
    },
    removeFromQueue(state, action: PayloadAction<number>) {
      state.promptQueue.splice(action.payload, 1)
    },
    clearQueue(state) {
      state.promptQueue = []
    },
    cancelLastExchange(state) {
      let lastUserIdx = -1
      for (let i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].role === 'user') { lastUserIdx = i; break }
      }
      if (lastUserIdx !== -1) state.messages = state.messages.slice(0, lastUserIdx)
      state.liveActivity = []
    },
    setPendingInput(state, action: PayloadAction<string | null>) {
      state.pendingInput = action.payload
    },
    setAssistantFinalText(state, action: PayloadAction<string>) {
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'assistant') {
        last.thinking = last.text
        last.text = action.payload
      }
    },
    resetWorkspace() {
      return initialState
    },
  },
})

export const {
  addUserMessage,
  addAssistantMessage,
  appendChatOutput,
  pushActivity,
  finalizeMessage,
  addCheckpoint,
  setPreviewingHash,
  setStreaming,
  setEnvNeeded,
  setDeployedHash,
  setDeployedUrl,
  setProjectName,
  restoreHistory,
  resetWorkspace,
  enqueuePrompt,
  dequeuePrompt,
  removeFromQueue,
  clearQueue,
  cancelLastExchange,
  setPendingInput,
  setAssistantFinalText,
} = appSlice.actions

export const store = configureStore({ reducer: { app: appSlice.reducer } })

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export const useAppDispatch: () => AppDispatch = useDispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
