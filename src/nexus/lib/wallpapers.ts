// NEXUS OS — wallpapers (pure CSS, zero external assets)

export interface Wallpaper {
  id: string;
  name: string;
  theme: "dark" | "light";
  /** CSS background value */
  css: string;
}

export const WALLPAPERS: Wallpaper[] = [
  {
    id: "void",
    name: "Void",
    theme: "dark",
    css:
      "radial-gradient(1200px 800px at 70% -10%, rgba(56,189,248,0.10), transparent 60%)," +
      "radial-gradient(900px 700px at 10% 110%, rgba(139,92,246,0.10), transparent 60%)," +
      "linear-gradient(180deg, #050507 0%, #0a0b10 100%)",
  },
  {
    id: "aurora",
    name: "Aurora",
    theme: "dark",
    css:
      "radial-gradient(1000px 600px at 15% 20%, rgba(45,212,191,0.14), transparent 55%)," +
      "radial-gradient(1200px 700px at 85% 10%, rgba(59,130,246,0.12), transparent 60%)," +
      "radial-gradient(900px 900px at 60% 100%, rgba(139,92,246,0.14), transparent 60%)," +
      "linear-gradient(180deg, #060709 0%, #0b0f14 100%)",
  },
  {
    id: "nebula",
    name: "Nebula",
    theme: "dark",
    css:
      "radial-gradient(1100px 700px at 80% 15%, rgba(244,63,94,0.12), transparent 55%)," +
      "radial-gradient(1000px 800px at 20% 85%, rgba(168,85,247,0.14), transparent 55%)," +
      "linear-gradient(180deg, #070609 0%, #0d0a12 100%)",
  },
  {
    id: "graphite",
    name: "Graphite",
    theme: "dark",
    css:
      "radial-gradient(1400px 900px at 50% -20%, rgba(148,163,184,0.10), transparent 60%)," +
      "linear-gradient(180deg, #08090b 0%, #101216 100%)",
  },
  {
    id: "ember",
    name: "Ember",
    theme: "dark",
    css:
      "radial-gradient(1000px 600px at 80% 90%, rgba(251,146,60,0.12), transparent 55%)," +
      "radial-gradient(900px 700px at 15% 15%, rgba(239,68,68,0.10), transparent 55%)," +
      "linear-gradient(180deg, #080706 0%, #100c0a 100%)",
  },
  {
    id: "paper",
    name: "Paper",
    theme: "light",
    css: "linear-gradient(180deg, #f4f5f7 0%, #e8eaef 100%)",
  },
  {
    id: "dawn",
    name: "Dawn",
    theme: "light",
    css:
      "radial-gradient(1000px 600px at 20% 10%, rgba(251,191,36,0.18), transparent 55%)," +
      "radial-gradient(1000px 700px at 85% 20%, rgba(244,114,182,0.14), transparent 55%)," +
      "linear-gradient(180deg, #f7f6f4 0%, #ece9ee 100%)",
  },
  {
    id: "mint",
    name: "Mint",
    theme: "light",
    css:
      "radial-gradient(900px 600px at 80% 15%, rgba(16,185,129,0.14), transparent 55%)," +
      "linear-gradient(180deg, #f4f7f5 0%, #e5ebe7 100%)",
  },
];

export function wallpaperById(id: string): Wallpaper {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];
}

export const ACCENTS: { id: string; name: string; hex: string }[] = [
  { id: "cyan", name: "Cyan", hex: "#22d3ee" },
  { id: "violet", name: "Violet", hex: "#a78bfa" },
  { id: "emerald", name: "Emerald", hex: "#34d399" },
  { id: "amber", name: "Amber", hex: "#fbbf24" },
  { id: "rose", name: "Rose", hex: "#fb7185" },
  { id: "sky", name: "Sky", hex: "#38bdf8" },
  { id: "lime", name: "Lime", hex: "#a3e635" },
  { id: "fuchsia", name: "Fuchsia", hex: "#e879f9" },
];

/** hex -> "r,g,b" for rgba() composition */
export function hexToRgb(hex: string): string {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(v, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
