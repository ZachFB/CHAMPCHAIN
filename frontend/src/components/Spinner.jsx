// A double counter-rotating ring, not a single generic Tailwind arc:
// outer ring spins fast one way, inner ring spins slower the other way.
// Both use currentColor so they inherit whatever button text color is
// already in play (gold on turf, chalk on red, etc.) — but the two-ring
// counter-motion reads as clearly distinct at a glance, even at 16px.
export default function Spinner({ className = "h-4 w-4" }) {
  return (
    <span className={`relative inline-block ${className}`} aria-hidden="true">
      <svg
        className="absolute inset-0 h-full w-full animate-spin"
        style={{ animationDuration: "0.6s" }}
        viewBox="0 0 50 50"
        fill="none"
      >
        <circle cx="25" cy="25" r="21" stroke="currentColor" strokeOpacity="0.18" strokeWidth="5" />
        <circle
          cx="25" cy="25" r="21"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray="33 99"
        />
      </svg>
      <svg
        className="absolute inset-0 h-full w-full"
        style={{ animation: "spin 1.1s linear infinite reverse" }}
        viewBox="0 0 50 50"
        fill="none"
      >
        <circle
          cx="25" cy="25" r="11"
          stroke="currentColor"
          strokeOpacity="0.65"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="14 55"
        />
      </svg>
    </span>
  );
}
