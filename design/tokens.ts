export const tokens = {
  color: {
    canvas: "#0A0A0B",
    surface: "#131316",
    border: "rgba(255,255,255,0.08)",
    text: "#EDEDEF",
    textMuted: "#9A9AA5",
    accent: "#6366F1",
    ok: "#3FB68B",
    warn: "#E0A23C",
    danger: "#E5484D",
  },
  radius: "10px",
  space: (n: number) => `${n * 4}px`,
} as const;
export type Tokens = typeof tokens;
