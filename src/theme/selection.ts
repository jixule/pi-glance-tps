import type { GlanceTpsThemeName, GlanceTpsThemePair } from "../types.js";

export type GlanceTpsAmbientTone = "light" | "dark";
export type GlanceTpsThemeSlot = "light" | "dark";

export function selectGlanceTpsTheme(pair: GlanceTpsThemePair, tone: GlanceTpsAmbientTone): GlanceTpsThemeName {
	return tone === "dark" ? pair.dark : pair.light;
}
