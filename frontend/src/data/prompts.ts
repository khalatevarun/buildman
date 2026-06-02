// Layout rules:
//   • All items use translateX(-50%) so they centre on their x%.
//   • Items with x > 88 use translateX(-100%) to avoid right-edge clipping.
//   • Every row has a unique left and right x so no vertical column forms.
//   • 3-item rows (≤ 50 char prompts): left x ∈ 10-20, right x ∈ 78-87
//   • 4-item rows (≤ 33 char prompts): left x ∈ 11-16, right x ∈ 80-87

export const SCATTERED = [
  // row 1 — 3 items  (y ≥ 9 to clear the nav bar)
  { x: 15, y: 9,  text: 'Mood tracker that auto-builds a Spotify playlist' },
  { x: 50, y: 8,  text: 'Pokedex with type charts and evolution tree' },
  { x: 83, y: 10, text: 'Pomodoro timer with ambient sound modes and stats' },

  // row 2 — 4 items
  { x: 12, y: 19, text: 'Habit tracker with streak view' },
  { x: 35, y: 17, text: 'Markdown editor with live preview' },
  { x: 58, y: 19, text: 'GitHub profile card generator' },
  { x: 82, y: 17, text: 'Typing speed test with WPM score' },

  // row 3 — 3 items
  { x: 12, y: 28, text: 'Kanban board with drag-and-drop and local save' },
  { x: 47, y: 26, text: 'Live trivia game with the Open Trivia Database' },
  { x: 78, y: 28, text: 'Crypto watchlist with live prices via CoinGecko' },

  // row 4 — 4 items
  { x: 15, y: 37, text: 'Text-to-speech reader with ElevenLabs' },
  { x: 38, y: 35, text: 'Random user profile card generator' },
  { x: 62, y: 37, text: 'Flashcard flip app for any topic' },
  { x: 86, y: 35, text: 'Rock paper scissors with win history' },

  // row 5 — 3 items
  { x: 18, y: 46, text: 'Budget tracker with category charts and history' },
  { x: 53, y: 44, text: 'AI image generator that starts with your mood' },
  { x: 84, y: 46, text: 'Pixel art canvas with color picker and undo stack' },

  // row 6 — 4 items
  { x: 11, y: 55, text: 'Invoice builder with Stripe payment link' },
  { x: 33, y: 53, text: 'Color palette explorer from a mood' },
  { x: 57, y: 55, text: 'AI meal planner with macros via OpenAI' },
  { x: 80, y: 53, text: 'Stopwatch with split and lap time list' },

  // row 7 — 3 items
  { x: 10, y: 64, text: 'Dictionary with audio clips and example sentences' },
  { x: 46, y: 62, text: 'Movie night picker with ratings from TMDB' },
  { x: 78, y: 64, text: 'Breathing exercise with an animated circle guide' },

  // row 8 — 4 items
  { x: 14, y: 73, text: 'Dog breed identifier using a free image API' },
  { x: 37, y: 71, text: 'Notes app saved to local storage' },
  { x: 61, y: 73, text: 'Live chat room backed by Supabase Realtime' },
  { x: 84, y: 71, text: 'Anime search and detail view with Jikan API' },

  // row 9 — 3 items
  { x: 20, y: 82, text: 'AI cover letter built from your job description' },
  { x: 56, y: 80, text: 'Countdown timer that fires confetti on zero' },
  { x: 85, y: 82, text: 'NASA photo of the day with facts and share link' },

  // row 10 — 4 items
  { x: 13, y: 91, text: 'Smart todo list with AI priority scoring' },
  { x: 36, y: 89, text: 'Weather forecast for any city' },
  { x: 60, y: 91, text: 'Binary and hex converter tool' },
  { x: 83, y: 89, text: 'ASCII art generator from any text' },
]
