interface IconProps {
  className?: string;
}

export function IconPlay({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 5.14v13.72L19 12 8 5.14z" />
    </svg>
  );
}

export function IconPause({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

export function IconStop({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7 7h10v10H7V7z" />
    </svg>
  );
}
