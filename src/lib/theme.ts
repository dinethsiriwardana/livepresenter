export interface ColorTheme {
  id: string;
  name: string;
  gradientClass: string;
  textClass: string;
  subtextClass: string;
  isLight: boolean;
}

export const THEME_GRADIENTS: Record<string, ColorTheme> = {
  "light-sky": {
    id: "light-sky",
    name: "Light Sky",
    gradientClass: "bg-gradient-to-br from-sky-100 via-indigo-55 to-purple-100",
    textClass: "text-slate-900",
    subtextClass: "text-slate-600",
    isLight: true,
  },
  "light-peach": {
    id: "light-peach",
    name: "Light Peach",
    gradientClass: "bg-gradient-to-br from-pink-100 via-rose-50 to-orange-100",
    textClass: "text-slate-900",
    subtextClass: "text-slate-600",
    isLight: true,
  },
  "dark-indigo": {
    id: "dark-indigo",
    name: "Midnight Indigo",
    gradientClass: "bg-gradient-to-br from-slate-900 via-indigo-950 to-purple-950",
    textClass: "text-slate-100",
    subtextClass: "text-slate-400",
    isLight: false,
  },
  "dark-gold": {
    id: "dark-gold",
    name: "Royal Gold",
    gradientClass: "bg-gradient-to-br from-stone-900 via-yellow-950 to-amber-900",
    textClass: "text-amber-50",
    subtextClass: "text-amber-200",
    isLight: false,
  },
  "dark-obsidian": {
    id: "dark-obsidian",
    name: "Obsidian Black",
    gradientClass: "bg-gradient-to-br from-zinc-950 via-neutral-900 to-black",
    textClass: "text-zinc-100",
    subtextClass: "text-zinc-400",
    isLight: false,
  },
};

export const DEFAULT_THEME_ID = "dark-indigo";

export function getTheme(themeId?: string): ColorTheme {
  return THEME_GRADIENTS[themeId || DEFAULT_THEME_ID] || THEME_GRADIENTS[DEFAULT_THEME_ID];
}
