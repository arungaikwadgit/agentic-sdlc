interface Props {
  size?: number;
  title?: string;
  showWordmark?: boolean;
  wordmarkClassName?: string;
  className?: string;
}

export default function AppLogo({
  size = 28,
  title = 'Agentic SDLC',
  showWordmark = true,
  wordmarkClassName,
  className,
}: Props) {
  const icon = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="agentic-sdlc-core" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7C3AED" />
          <stop offset="0.45" stopColor="#4F46E5" />
          <stop offset="1" stopColor="#06B6D4" />
        </linearGradient>
        <linearGradient id="agentic-sdlc-ring" x1="14" y1="12" x2="50" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C4B5FD" stopOpacity="0.95" />
          <stop offset="1" stopColor="#67E8F9" stopOpacity="0.9" />
        </linearGradient>
      </defs>

      <rect x="8" y="8" width="48" height="48" rx="16" fill="#0F172A" />
      <path
        d="M18 22L28 16L38 22V34L28 40L18 34V22Z"
        fill="url(#agentic-sdlc-core)"
        opacity="0.96"
      />
      <path
        d="M30 26L40 20L50 26V38L40 44L30 38V26Z"
        fill="url(#agentic-sdlc-core)"
      />
      <path
        d="M20 24L30 30M30 30L40 24M30 30V42"
        stroke="url(#agentic-sdlc-ring)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="22" r="3.5" fill="#A78BFA" />
      <circle cx="50" cy="26" r="3.5" fill="#22D3EE" />
      <circle cx="30" cy="42" r="3.5" fill="#F8FAFC" />
      <path
        d="M46 14C49.5 16.2 52.2 19.5 53.7 23.4C55.1 27.3 55.3 31.6 54.1 35.6"
        stroke="url(#agentic-sdlc-ring)"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  );

  if (!showWordmark) return icon;

  return (
    <div className={className} title={title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {icon}
      <span className={wordmarkClassName}>Agentic SDLC</span>
    </div>
  );
}
