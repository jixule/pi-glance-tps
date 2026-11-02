import { PALETTES, foregroundStyle } from "./palette.js";
import { selectGlanceTpsTheme, type GlanceTpsAmbientTone } from "./selection.js";
import { workingAccent } from "./working-colors.js";
import type { GlanceTpsThemeName, GlanceTpsThemePair, Rgb, BuiltinSegmentId, WorkingSweepColor } from "../types.js";

export type TextStyler = (text: string) => string;

export interface ResolvedGlanceTpsSegmentStyles {
	readonly fg: TextStyler;
}

export interface ResolvedGlanceTpsStyles {
	readonly cacheKey: string;
	readonly text: TextStyler;
	readonly dim: TextStyler;
	readonly warn: TextStyler;
	readonly error: TextStyler;
	readonly separator: TextStyler;
	readonly border: TextStyler;
	readonly title: TextStyler;
	/** Normalized beam intensity for the title and border; other styles stay untouched. */
	readonly highlight?: (style: TextStyler, amount: number) => TextStyler;
	readonly segments: Record<BuiltinSegmentId, ResolvedGlanceTpsSegmentStyles>;
}

export type GlanceTpsColorMode = "truecolor" | "ansi256";

export interface GlanceTpsRenderStyleContext {
	readonly styles?: ResolvedGlanceTpsStyles;
	readonly ambientTone?: GlanceTpsAmbientTone;
	readonly getAmbientTone?: () => GlanceTpsAmbientTone;
	readonly trueColor?: boolean;
	readonly getTrueColor?: () => boolean;
}

const builtInStyles = new Map<string, ResolvedGlanceTpsStyles>();

const STYLE_SEGMENT_IDS = ["git", "model", "context", "tokens", "cost", "throughput"] as const satisfies readonly BuiltinSegmentId[];

function resolveBuiltInSegmentStyles(theme: GlanceTpsThemeName, colorMode: GlanceTpsColorMode): Record<BuiltinSegmentId, ResolvedGlanceTpsSegmentStyles> {
	const palette = PALETTES[theme];
	return Object.fromEntries(
		STYLE_SEGMENT_IDS.map((segment) => [segment, { fg: foregroundStyle(palette.segments[segment].fg, colorMode) }]),
	) as Record<BuiltinSegmentId, ResolvedGlanceTpsSegmentStyles>;
}

export function resolveBuiltInGlanceTpsStyles(theme: GlanceTpsThemeName, colorMode: GlanceTpsColorMode = "truecolor", sweepColor: WorkingSweepColor = "theme"): ResolvedGlanceTpsStyles {
	const cacheKey = `glance-tps:${theme}:${colorMode}${sweepColor === "theme" ? "" : `:${sweepColor}`}`;
	const cached = builtInStyles.get(cacheKey);
	if (cached) return cached;
	const palette = PALETTES[theme];
	const styles: ResolvedGlanceTpsStyles = {
		cacheKey,
		text: foregroundStyle(palette.text, colorMode),
		dim: foregroundStyle(palette.dim, colorMode),
		warn: foregroundStyle(palette.warn, colorMode),
		error: foregroundStyle(palette.error, colorMode),
		separator: foregroundStyle(palette.separator, colorMode),
		border: foregroundStyle(palette.border, colorMode),
		title: foregroundStyle(palette.title, colorMode),
		segments: resolveBuiltInSegmentStyles(theme, colorMode),
	};
	const peak = workingAccent(theme, sweepColor);
	const colors = new Map<TextStyler, Rgb>([[styles.border, palette.border], [styles.title, palette.title]]);
	const shades = new Map<TextStyler, Map<number, TextStyler>>();
	const resolved: ResolvedGlanceTpsStyles = {
		...styles,
		highlight: (style, amount) => {
			const color = colors.get(style);
			if (!color || !Number.isFinite(amount) || amount <= 0) return style;
			const level = Math.round(Math.min(1, amount) * 32);
			if (level === 0) return style;
			let cache = shades.get(style);
			if (!cache) shades.set(style, cache = new Map());
			let shade = cache.get(level);
			if (!shade) {
				const mix = (from: number, to: number) => Math.round(from + (to - from) * level / 32);
				const colorStyle = foregroundStyle({ r: mix(color.r, peak.r), g: mix(color.g, peak.g), b: mix(color.b, peak.b) }, colorMode);
				shade = level >= 24 ? (text) => `\x1b[1m${colorStyle(text)}\x1b[22m` : colorStyle;
				cache.set(level, shade);
			}
			return shade;
		},
	};
	// Bounded by 22 palettes × 2 color modes × 9 sweep colors.
	builtInStyles.set(cacheKey, resolved);
	return resolved;
}

function resolveColorMode(context: GlanceTpsRenderStyleContext): GlanceTpsColorMode {
	const trueColor = context.trueColor ?? context.getTrueColor?.() ?? true;
	return trueColor ? "truecolor" : "ansi256";
}

export function resolveGlanceTpsRenderStyles(theme: GlanceTpsThemePair, context: GlanceTpsRenderStyleContext = {}, sweepColor: WorkingSweepColor = "theme"): ResolvedGlanceTpsStyles {
	if (context.styles) return context.styles;
	const ambientTone = context.ambientTone ?? context.getAmbientTone?.() ?? "light";
	return resolveBuiltInGlanceTpsStyles(selectGlanceTpsTheme(theme, ambientTone), resolveColorMode(context), sweepColor);
}
