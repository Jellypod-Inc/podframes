/**
 * The podframes signature: two TTS provider "channels" patched into one
 * conversation bus, then routed out to a rendered video. Pure SVG + CSS so it
 * stays crisp and cheap; respects prefers-reduced-motion.
 *
 * Square corners + warm-charcoal surfaces to match the Speechbase identity; the
 * patch cables keep their per-provider colors — that mix is podframes' own motif.
 */
export function PatchBay() {
  const bars = Array.from({ length: 28 });
  return (
    <div className="relative w-full select-none">
      <svg
        viewBox="0 0 760 440"
        className="w-full h-auto"
        role="img"
        aria-label="Two TTS providers routed into one conversation, then rendered to video"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <defs>
          <linearGradient id="cableA" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#5B8CFF" />
            <stop offset="1" stopColor="#22D3EE" />
          </linearGradient>
          <linearGradient id="cableB" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0" stopColor="#A78BFA" />
            <stop offset="1" stopColor="#22D3EE" />
          </linearGradient>
          <linearGradient id="busOut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#22D3EE" />
            <stop offset="1" stopColor="#5B8CFF" />
          </linearGradient>
          <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Channel A — left. The REAL shipped default cast (Ada on Google), not a
            fictional channel — the hero must show a mix you can actually run. */}
        <g>
          <rect x="20" y="60" width="210" height="86" fill="#181715" stroke="#2f2b27" />
          <circle cx="58" cy="103" r="18" fill="#5B8CFF" opacity="0.18" />
          <circle cx="58" cy="103" r="8" fill="#5B8CFF" />
          <text x="86" y="98" fill="#F4F2EC" fontSize="20" fontWeight="700">Ada</text>
          <text x="86" y="122" fill="#A8A298" fontSize="13" style={{ fontFamily: "var(--font-mono)" }}>google/gemini-3.1-flash-tts</text>
        </g>

        {/* Channel B — right */}
        <g>
          <rect x="530" y="60" width="210" height="86" fill="#181715" stroke="#2f2b27" />
          <circle cx="568" cy="103" r="18" fill="#A78BFA" opacity="0.18" />
          <circle cx="568" cy="103" r="8" fill="#A78BFA" />
          <text x="596" y="98" fill="#F4F2EC" fontSize="20" fontWeight="700">Theo</text>
          <text x="596" y="122" fill="#A8A298" fontSize="13" style={{ fontFamily: "var(--font-mono)" }}>elevenlabs/eleven_v3</text>
        </g>

        {/* Cables into the bus */}
        <path d="M125 146 C 125 220, 300 210, 380 232" fill="none" stroke="url(#cableA)" strokeWidth="3" strokeLinecap="round" strokeDasharray="6 8" className="cable" />
        <path d="M635 146 C 635 220, 460 210, 380 232" fill="none" stroke="url(#cableB)" strokeWidth="3" strokeLinecap="round" strokeDasharray="6 8" className="cable cable-rev" />

        {/* Conversation bus / console */}
        <g>
          <rect x="250" y="214" width="260" height="104" fill="#141312" stroke="#2f2b27" />
          <rect x="250" y="214" width="260" height="104" fill="url(#busOut)" opacity="0.06" />
          <text x="270" y="240" fill="#A8A298" fontSize="12" letterSpacing="2" style={{ fontFamily: "var(--font-mono)" }}>CONVERSATION · LEVELED</text>
          <g transform="translate(270 252)">
            {bars.map((_, i) => (
              <rect
                key={i}
                x={i * 8.4}
                y={0}
                width={4}
                height={40}
                fill={i % 5 === 0 ? "#22D3EE" : "#4a443a"}
                className="eq"
                style={{ animationDelay: `${(i % 14) * 0.07}s`, transformOrigin: "center" }}
              />
            ))}
          </g>
        </g>

        {/* Output cable to video */}
        <path d="M380 318 C 380 360, 380 360, 380 372" fill="none" stroke="url(#busOut)" strokeWidth="3" strokeDasharray="6 8" className="cable" />

        {/* Rendered video frame */}
        <g>
          <rect x="276" y="372" width="208" height="54" fill="#181715" stroke="#2f2b27" />
          <rect x="288" y="384" width="44" height="30" fill="#100f0e" stroke="#22D3EE" strokeOpacity="0.5" />
          <polygon points="304,392 304,406 316,399" fill="#22D3EE" />
          <text x="344" y="396" fill="#F4F2EC" fontSize="15" fontWeight="700">podframes.mp4</text>
          <text x="344" y="414" fill="#A8A298" fontSize="12" style={{ fontFamily: "var(--font-mono)" }}>1920×1080 · captions · b-roll</text>
        </g>
      </svg>

      <style>{`
        .cable { animation: dash-flow 1.1s linear infinite; }
        .cable-rev { animation-direction: reverse; }
        .eq { animation: eq-bounce 1.2s ease-in-out infinite; }
        @keyframes eq-bounce {
          0%, 100% { transform: scaleY(0.35); }
          50% { transform: scaleY(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .cable, .eq { animation: none; }
          .eq { transform: scaleY(0.7); }
        }
      `}</style>
    </div>
  );
}
