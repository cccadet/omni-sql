import { useId } from "react";

export interface DialectIconProps {
  dialect?: string;
  size?: number;
  className?: string;
}

export function DialectIcon({ dialect, size = 14, className }: DialectIconProps) {
  const uid = useId().replace(/:/g, "");
  const mariaGrad = `mariaGrad-${uid}`;
  const oraGrad = `oraGrad-${uid}`;

  switch (dialect) {
    case "postgres":
      return (
        <svg
          className={className}
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M12.5 3C11.2 3 10.1 3.5 9.3 4.3L8 3.5L6.7 4.3C5.9 3.5 4.8 3 3.5 3C1.8 3 0.5 4.6 0.5 6.5C0.5 8.4 1.8 10 3.5 10C4.1 10 4.6 9.9 5.1 9.6L6 11.5L5.5 13.5H7L7.8 11.8C8.2 11.9 8.6 12 9 12C11 12 12.5 10.3 12.5 8.5C12.5 6.3 10.8 4.5 9 4.5C8.7 4.5 8.4 4.5 8.1 4.6L9 3L10.5 3.8C10.8 3.4 11.6 3 12.5 3Z"
            fill="#336791"
          />
        </svg>
      );
    case "mysql":
      return (
        <svg
          className={className}
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M3 4.5C3 3.7 3.7 3 4.5 3H8C9 3 9.8 3.6 10.1 4.4L11.5 8L10.1 11.6C9.8 12.4 9 13 8 13H4.5C3.7 13 3 12.3 3 11.5V4.5Z"
            fill="#00758F"
          />
          <path
            d="M10.1 4.4L11.5 8L12.5 5.5C12.7 5 13.1 4.7 13.5 4.5C12.5 3.5 11.3 3.5 10.1 4.4Z"
            fill="#00A4D6"
          />
          <circle cx="11" cy="8" r="0.8" fill="white" />
        </svg>
      );
    case "mariadb":
      return (
        <svg
          className={className}
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d="M4 3L5.5 6H10.5L12 3L13 5V9C13 11 11.5 13 9 13H7C4.5 13 3 11 3 9V5L4 3Z" fill={`url(#${mariaGrad})`} />
          <defs>
            <linearGradient id={mariaGrad} x1="3" y1="3" x2="13" y2="13">
              <stop offset="0%" stopColor="#003545" />
              <stop offset="100%" stopColor="#006060" />
            </linearGradient>
          </defs>
          <circle cx="6.5" cy="8" r="1" fill="white" />
          <circle cx="9.5" cy="8" r="1" fill="white" />
          <ellipse cx="8" cy="10" rx="1" ry="0.6" fill="#E8530E" />
          <path d="M5 4L3.5 2" stroke="#003545" strokeWidth="0.8" strokeLinecap="round" />
          <path d="M11 4L12.5 2" stroke="#003545" strokeWidth="0.8" strokeLinecap="round" />
        </svg>
      );
    case "sqlserver":
      return (
        <svg
          className={className}
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <ellipse cx="8" cy="4.5" rx="5" ry="2" fill="#CC2927" />
          <path d="M3 4.5V11.5C3 12.6 5.2 13.5 8 13.5C10.8 13.5 13 12.6 13 11.5V4.5" fill="#CC2927" />
          <ellipse cx="8" cy="11.5" rx="5" ry="2" fill="#A01E1C" />
          <ellipse cx="8" cy="4.5" rx="5" ry="2" fill="#E8403E" />
          <ellipse cx="8" cy="4.5" rx="3" ry="1.3" fill="#F06060" opacity="0.4" />
        </svg>
      );
    case "oracle":
      return (
        <svg
          className={className}
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="5.5" stroke="#F80000" strokeWidth="2" fill="none" />
          <circle cx="8" cy="8" r="5.5" fill={`url(#${oraGrad})`} opacity="0.15" />
          <defs>
            <linearGradient id={oraGrad} x1="2.5" y1="2.5" x2="13.5" y2="13.5">
              <stop offset="0%" stopColor="#F80000" />
              <stop offset="100%" stopColor="#8B0000" />
            </linearGradient>
          </defs>
        </svg>
      );
    case "jdbc-generic":
      return (
        <svg
          className={className}
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect x="5" y="2" width="6" height="5" rx="1" fill="#888" />
          <rect x="6.5" y="3.5" width="1" height="2" rx="0.3" fill="#555" />
          <rect x="8.5" y="3.5" width="1" height="2" rx="0.3" fill="#555" />
          <rect x="7.2" y="7" width="1.6" height="4" rx="0.5" fill="#888" />
          <rect x="6" y="10" width="4" height="2" rx="1" fill="#888" />
        </svg>
      );
    case "odbc":
      return (
        <svg
          className={className}
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <ellipse cx="6" cy="8" rx="3.5" ry="2.5" stroke="#888" strokeWidth="1.5" fill="none" />
          <ellipse cx="10" cy="8" rx="3.5" ry="2.5" stroke="#888" strokeWidth="1.5" fill="none" />
        </svg>
      );
    default:
      return (
        <svg
          className={className}
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="10" height="10" rx="2" stroke="#888" strokeWidth="1.2" fill="none" />
          <ellipse cx="8" cy="3" rx="5" ry="2" stroke="#888" strokeWidth="1.2" fill="none" />
        </svg>
      );
  }
}
