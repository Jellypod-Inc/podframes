"use client";

import type { Host } from "./api";

/**
 * Provider-specific voice settings.
 *
 * Each TTS provider exposes a different set of knobs, so rather than a generic
 * control that silently no-ops on the wrong provider, every provider registers
 * its OWN block of controls. They render underneath the universal voice/tone
 * controls in the cast console, under a labeled header in the provider's color.
 *
 * Adding a new provider = add one entry to REGISTRY. Nothing else changes; a
 * provider with no custom settings simply renders nothing.
 */
/** ElevenLabs voice stability used when a host hasn't picked one (mirrors core's DEFAULT_STABILITY). */
export const DEFAULT_STABILITY = 0.5;

export interface ProviderSettingsProps {
  provider: string;
  providerLabel: string;
  color: string;
  host: Host;
  disabled: boolean;
  // The live drafts are owned by the parent (the cast console) so the voice
  // preview can synthesize with the not-yet-saved values.
  stability: number;
  onStability: (n: number) => void;
  commitStability: () => void;
  style: string;
  onStyle: (s: string) => void;
  commitStyle: () => void;
}

const REGISTRY: Record<string, React.FC<ProviderSettingsProps>> = {
  elevenlabs: ElevenLabsSettings,
  google: GeminiSettings,
};

export function ProviderSettings(props: ProviderSettingsProps) {
  const Render = REGISTRY[props.provider];
  if (!Render) return null;
  return (
    <div className="mt-3 space-y-3 border-t border-[var(--color-hairline)] pt-3">
      <div className="mono flex items-center gap-1.5 text-[10px] tracking-[0.09em] text-[var(--color-text-muted)]">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: props.color }} />
        {props.providerLabel.toUpperCase()} SETTINGS
      </div>
      <Render {...props} />
    </div>
  );
}

/** ElevenLabs eleven_v3 — voice_settings.stability, passed straight through. */
function ElevenLabsSettings(p: ProviderSettingsProps) {
  return (
    <Setting
      label="Stability"
      help="ElevenLabs voice_settings.stability. Lower is more expressive and variable take-to-take; higher is more consistent. Default 0.5."
    >
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={p.stability}
          disabled={p.disabled}
          onChange={(e) => p.onStability(Number(e.target.value))}
          onPointerUp={p.commitStability}
          className="min-w-0 flex-1"
          aria-label="Stability"
        />
        <span className="mono w-9 shrink-0 text-right text-[11px] text-[var(--color-text-secondary)]">{p.stability.toFixed(2)}</span>
      </div>
    </Setting>
  );
}

/** Gemini 3.1 Flash TTS — free-text natural-language direction for the read. */
function GeminiSettings(p: ProviderSettingsProps) {
  return (
    <Setting
      label="Style direction"
      help="Plain-language direction Gemini interprets for the read — e.g. warm radio host, a little sarcastic."
    >
      <input
        value={p.style}
        disabled={p.disabled}
        onChange={(e) => p.onStyle(e.target.value)}
        onBlur={p.commitStyle}
        placeholder="e.g. warm radio host, a little sarcastic"
        className="w-full min-w-0 rounded-none border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-2.5 py-2 text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-60"
      />
    </Setting>
  );
}

/** One labeled setting: a clear name, the control, and a one-line explanation of what it does. */
function Setting({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-[var(--color-text-secondary)]">{label}</div>
      {children}
      {help && <p className="mt-1 text-[11px] leading-snug text-[var(--color-text-muted)]">{help}</p>}
    </div>
  );
}
