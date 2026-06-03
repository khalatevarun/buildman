export function playCompletionSound() {
  try {
    const ctx = new AudioContext()
    ;[523, 784].forEach((freq, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.type = 'sine'; o.frequency.value = freq
      const t = ctx.currentTime + i * 0.18
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.35, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6)
      o.start(t); o.stop(t + 0.6)
    })
  } catch { /* audio blocked */ }
}
