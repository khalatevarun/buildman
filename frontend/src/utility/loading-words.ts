export const LOADING_WORDS = [
  'Accomplishing', 'Actioning', 'Adapting', 'Architecting', 'Assembling',
  'Augmenting', 'Bootstrapping', 'Building', 'Calculating', 'Clauding',
  'Coding', 'Compiling', 'Computing', 'Configuring', 'Connecting',
  'Constructing', 'Crafting', 'Creating', 'Debugging', 'Deploying',
  'Designing', 'Developing', 'Devising', 'Discovering', 'Elaborating',
  'Engineering', 'Enhancing', 'Executing', 'Expanding', 'Fabricating',
  'Figuring', 'Formatting', 'Generating', 'Implementing', 'Improving',
  'Initializing', 'Integrating', 'Iterating', 'Launching', 'Manifesting',
  'Materializing', 'Merging', 'Modeling', 'Nudging', 'Optimizing',
  'Orchestrating', 'Parsing', 'Polishing', 'Processing', 'Programming',
  'Propagating', 'Reasoning', 'Refactoring', 'Rendering', 'Resolving',
  'Reticulating', 'Revising', 'Running', 'Scaffolding', 'Shaping',
  'Spinning up', 'Synthesizing', 'Thinking', 'Transpiling', 'Tweaking',
  'Unifying', 'Updating', 'Validating', 'Weaving', 'Wiring', 'Writing',
]

export function randomWord() {
  return LOADING_WORDS[Math.floor(Math.random() * LOADING_WORDS.length)]
}
