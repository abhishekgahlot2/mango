import { useId } from "react";
export type Glyph = "burst" | "blob" | "cube" | "pixel";

const PIXELS = ["###.", "#.##", "#..#", "##.#"];

/** The four agent marks. Drawn in currentColor so a tile can invert them. */
export function AgentGlyph({ glyph, className }: { glyph: Glyph; className?: string }) {
  const maskId = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      {glyph === "burst" &&
        [0, 30, 60, 90, 120, 150].map((deg) => (
          <line
            key={deg}
            x1="12"
            y1="3"
            x2="12"
            y2="21"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            transform={`rotate(${deg} 12 12)`}
          />
        ))}
      {glyph === "blob" && (
        <>
          <mask id={maskId}>
            <rect width="24" height="24" fill="white" />
            <path d="M8 9l3 3-3 3M13 15h4" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </mask>
          <circle cx="12" cy="12" r="10" mask={`url(#${maskId})`} />
        </>
      )}
      {glyph === "cube" && (
        <>
          <polygon points="12,3 19.8,7.5 12,12 4.2,7.5" />
          <polygon points="4.2,7.5 12,12 12,21 4.2,16.5" opacity="0.55" />
          <polygon points="19.8,7.5 19.8,16.5 12,21 12,12" opacity="0.8" />
        </>
      )}
      {glyph === "pixel" &&
        PIXELS.flatMap((row, y) =>
          [...row].map((cell, x) => cell === "#" && <rect key={`${x}-${y}`} x={4 + x * 4} y={4 + y * 4} width="4" height="4" />),
        )}
    </svg>
  );
}
