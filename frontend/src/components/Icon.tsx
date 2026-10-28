/** Ícones de traço, herdam a cor do texto. Decorativos: o texto ao lado diz o que significam. */
const PATHS = {
  home: <path d="M4 11l8-7 8 7v9H4z" />,
  pill: <><rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-35 12 12)" /><path d="M9.5 8.5l5 7" /></>,
  heart: <path d="M12 20s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.5-7 10-7 10z" />,
  history: <><path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7" /><path d="M4 4v4h4M12 8v4l3 2" /></>,
  family: <><circle cx="9" cy="9" r="3.5" /><circle cx="17" cy="10" r="2.5" /><path d="M3 19c0-3 3-5 6-5s6 2 6 5M15 15c3 0 5 1.5 5 4" /></>,
  check: <path d="M5 12l5 5 9-10" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 17h.01" /></>,
  review: <path d="M7 7h10M7 12h10M7 17h6" />,
  sync: <path d="M4 12a8 8 0 0114-5M20 12a8 8 0 01-14 5M18 3v4h-4M6 21v-4h4" />,
  x: <path d="M7 7l10 10M17 7L7 17" />,
  bell: <path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4" />,
  back: <path d="M15 5l-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  thermo: <><path d="M10 14V5a2 2 0 014 0v9a4 4 0 11-4 0z" /><path d="M12 9v7" /></>,
  note: <path d="M7 7h10M7 12h10M7 17h6" />,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

/** Marca do app (cápsula com sinal de feito). */
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="120" fill="#12695A" />
      <rect x="96" y="196" width="320" height="140" rx="70" transform="rotate(-35 256 266)" fill="none" stroke="#fff" strokeWidth="30" />
      <path d="M190 270l48 48 92-108" fill="none" stroke="#F2B33D" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
