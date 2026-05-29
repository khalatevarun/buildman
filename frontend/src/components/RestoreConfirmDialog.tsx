import { Dialog } from 'radix-ui'

interface Props {
  open: boolean
  versionNumber: number
  timeAgo: string
  showPreviewHint: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function RestoreConfirmDialog({ open, versionNumber, timeAgo, showPreviewHint, onConfirm, onCancel }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm rounded-2xl bg-card border border-border p-6 shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">

          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/20 shrink-0">
              <svg width="15" height="15" viewBox="0 0 18 18" fill="none" className="text-amber-400">
                <path d="M9 3v6M9 12.5v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                <path d="M1.5 15L9 3l7.5 12H1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              </svg>
            </div>
            <Dialog.Title className="text-[15px] font-semibold text-foreground/90">
              Restore to v{versionNumber}?
            </Dialog.Title>
          </div>

          <Dialog.Description asChild>
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                All messages and changes after <span className="text-foreground/80 font-medium">v{versionNumber}</span>
                {' '}— made {timeAgo} — will be <span className="text-foreground/80 font-medium">permanently removed</span> from your chat history.
              </p>

              {showPreviewHint && (
                <p className="text-[12px] text-muted-foreground/60 leading-relaxed">
                  Not sure? Hit <span className="text-foreground/55 font-medium">Preview</span> to explore this version without committing to it.
                </p>
              )}
            </div>
          </Dialog.Description>

          <div className="mt-6 flex items-center gap-2.5 justify-end">
            <button
              onClick={onCancel}
              className="px-3.5 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors duration-100"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="px-4 py-1.5 text-[12.5px] font-medium text-white bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors duration-100"
            >
              Yes, Restore
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
