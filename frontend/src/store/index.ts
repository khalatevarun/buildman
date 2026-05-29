import { configureStore, createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  activities: string[]
}

interface CheckpointEntry {
  hash: string
  timestamp: number
}

export interface EnvVar {
  name: string
  service: string | null
  url: string | null
  hint: string | null
}

interface AppState {
  messages: ChatMessage[]
  liveActivity: string[]
  checkpoints: CheckpointEntry[]
  previewingHash: string | null
  streaming: boolean
  envNeeded: EnvVar[] | null
  deployedHash: string | null
  deployedUrl: string | null
  projectName: string | null
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
}

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    addUserMessage(state, action: PayloadAction<string>) {
      state.messages.push({ role: 'user', text: action.payload, activities: [] })
      state.liveActivity = []
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
    setEnvNeeded(state, action: PayloadAction<EnvVar[] | null>) {
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
    // Truncates messages and checkpoints to only those up to (and including) the given hash.
    // checkpoint[i] pairs with the (i+1)-th assistant message, so keep 2*(i+1) messages.
    truncateToCheckpoint(state, action: PayloadAction<string>) {
      const i = state.checkpoints.findIndex(cp => cp.hash === action.payload)
      if (i === -1) return
      state.checkpoints = state.checkpoints.slice(0, i + 1)
      state.messages = state.messages.slice(0, 2 * (i + 1))
      state.previewingHash = null
    },
    resetWorkspace() {
      return initialState
    },
  },
})

export const {
  addUserMessage,
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
  truncateToCheckpoint,
  resetWorkspace,
} = appSlice.actions

export const store = configureStore({ reducer: { app: appSlice.reducer } })

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
