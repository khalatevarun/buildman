// Layout rules:
//   • All items use translateX(-50%) so they centre on their x%.
//   • Items with x > 88 use translateX(-100%) to avoid right-edge clipping.
//   • Every row has a unique left and right x so no vertical column forms.
//   • 3-item rows (≤ 50 char prompts): left x ∈ 10-20, right x ∈ 78-87
//   • 4-item rows (≤ 33 char prompts): left x ∈ 11-16, right x ∈ 80-87

export const SCATTERED = [
  // row 1 — 3 items  (y ≥ 9 to clear the nav bar)
  { x: 15, y: 9,  text: 'Expense splitter with per-person breakdown' },
  { x: 50, y: 8,  text: 'Live flight tracker using AviationStack API' },
  { x: 83, y: 10, text: 'Word of the day app with history and quiz mode' },

  // row 2 — 4 items
  { x: 12, y: 19, text: 'Focus timer with session log' },
  { x: 35, y: 17, text: 'GitHub repo star tracker with charts' },
  { x: 58, y: 19, text: 'Recipe finder using the Spoonacular API' },
  { x: 82, y: 17, text: 'Emoji search and copy tool' },

  // row 3 — 3 items
  { x: 12, y: 28, text: 'Kanban board with drag-and-drop and local save' },
  { x: 47, y: 26, text: 'News digest with headlines via NewsAPI' },
  { x: 78, y: 28, text: 'Currency converter with live rates via Fixer.io' },

  // row 4 — 4 items
  { x: 15, y: 37, text: 'AI tweet thread generator via OpenAI' },
  { x: 38, y: 35, text: 'Dice roller with roll history' },
  { x: 62, y: 37, text: 'Flashcard app with spaced repetition' },
  { x: 86, y: 35, text: 'IP address lookup with map pin' },

  // row 5 — 3 items
  { x: 18, y: 46, text: 'Savings goal tracker with progress rings' },
  { x: 53, y: 44, text: 'Random cocktail generator using CocktailDB' },
  { x: 84, y: 46, text: 'Pixel art canvas with color picker and undo stack' },

  // row 6 — 4 items
  { x: 11, y: 55, text: 'Resume score checker using OpenAI' },
  { x: 33, y: 53, text: 'Color palette generator from an image URL' },
  { x: 57, y: 55, text: 'Music mood board using Last.fm API' },
  { x: 80, y: 53, text: 'Stopwatch with split and lap time list' },

  // row 7 — 3 items
  { x: 10, y: 64, text: 'Country explorer with flags and fun facts via RestCountries' },
  { x: 46, y: 62, text: 'Movie night picker with ratings from TMDB' },
  { x: 78, y: 64, text: 'Breathing exercise with animated circle guide' },

  // row 8 — 4 items
  { x: 14, y: 73, text: 'Open library book search with cover art' },
  { x: 37, y: 71, text: 'Sticky notes wall with drag to reposition' },
  { x: 61, y: 73, text: 'Real-time crypto ticker via CoinGecko' },
  { x: 84, y: 71, text: 'Anime search and detail view with Jikan API' },

  // row 9 — 3 items
  { x: 20, y: 82, text: 'AI bio generator from a few keywords' },
  { x: 56, y: 80, text: 'Countdown timer that fires confetti on zero' },
  { x: 85, y: 82, text: 'NASA photo of the day with facts and share link' },

  // row 10 — 4 items
  { x: 13, y: 91, text: 'Habit tracker with weekly heatmap' },
  { x: 36, y: 89, text: 'Weather forecast with hourly chart via Open-Meteo' },
  { x: 60, y: 91, text: 'QR code generator for any URL or text' },
  { x: 83, y: 89, text: 'ASCII art generator from any text' },
]
