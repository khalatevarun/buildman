interface Props {
  size?: number
  className?: string
}

export function BuildmanSpinner({ size = 16, className = '' }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="currentColor"
      className={className}
      style={{ animation: 'spin 1.1s linear infinite' }}
    >
      <path d="M 50,50 C 46,42 44,32 45,20 Q 50,12 58,18 Q 65,26 62,36 Q 58,44 50,50 Z" />
      <path
        d="M 50,50 C 46,42 44,32 45,20 Q 50,12 58,18 Q 65,26 62,36 Q 58,44 50,50 Z"
        transform="rotate(120 50 50)"
      />
      <path
        d="M 50,50 C 46,42 44,32 45,20 Q 50,12 58,18 Q 65,26 62,36 Q 58,44 50,50 Z"
        transform="rotate(240 50 50)"
      />
      <circle cx="50" cy="50" r="4" />
    </svg>
  )
}
