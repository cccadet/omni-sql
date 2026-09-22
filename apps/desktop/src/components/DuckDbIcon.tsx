interface DuckDbIconProps {
  readonly size?: number;
  readonly className?: string;
}

export function DuckDbIcon({ size = 18, className }: DuckDbIconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#fff100" />
      <circle cx="12" cy="12" r="6.8" fill="#111" />
      <circle cx="13.7" cy="10.3" r="3.1" fill="#fff100" />
    </svg>
  );
}
