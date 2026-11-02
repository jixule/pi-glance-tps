import { strict as assert } from "node:assert";
import { PALETTES, fg, fg256, rgbToAnsi256 } from "../../src/theme/palette.js";
import { resolveBuiltInGlanceTpsStyles, resolveGlanceTpsRenderStyles, type GlanceTpsColorMode } from "../../src/theme/adapter.js";
import { selectGlanceTpsTheme } from "../../src/theme/selection.js";
import { TACH_THEME_CATALOG } from "../../src/theme/catalog.js";
import { TACH_THEMES, TACH_THEME_IDS, isGlanceTpsThemeName, themeLabel } from "../../src/theme/themes.js";
import type { GlanceTpsPalette, Rgb, SegmentId } from "../../src/types.js";

import { EXPECTED_THEMES, EXPECTED_THEME_IDS, EXPECTED_PALETTES } from "../fixtures/themes.js";

const PALETTE_KEYS = ["text", "dim", "warn", "error", "separator", "border", "title", "segments"] as const;
const STYLE_ROLE_KEYS = ["text", "dim", "warn", "error", "separator", "border", "title"] as const;
const SEGMENT_IDS = ["git", "model", "context", "tokens", "cost", "throughput"] as const satisfies readonly SegmentId[];
const EXPECTED_THEME_GROUP_LABELS: Record<string, string> = {
	core: "Core",
	catppuccin: "Catppuccin",
	classic: "Classics",
	editor: "Editor",
	kanagawa: "Japanese",
	everforest: "Forest",
	accessibility: "Accessible",
};
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesRawThemeId(text: string, themeId: string): boolean {
	return new RegExp(`\\b${escapeRegExp(themeId)}\\b`).test(text);
}

const catalogMetadata = TACH_THEME_CATALOG.map(({ palette, ...metadata }) => metadata);
const catalogPalettes = Object.fromEntries(TACH_THEME_CATALOG.map((entry) => [entry.id, entry.palette]));

assert.equal(TACH_THEMES.length, 22, "theme metadata should keep the curated 22-theme collection");
assert.deepEqual(TACH_THEMES, EXPECTED_THEMES, "theme metadata should preserve exact current id/label/group/tone/tags/detail display snapshot");
assert.deepEqual(TACH_THEME_IDS, EXPECTED_THEME_IDS, "theme id helper should preserve exact TACH_THEMES order");
assert.deepEqual(Object.keys(PALETTES), EXPECTED_THEME_IDS, "palette object key order should exactly match TACH_THEME_IDS");
assert.deepEqual(PALETTES, EXPECTED_PALETTES, "palette RGB snapshot should preserve exact current theme colors");
assert.deepEqual(TACH_THEME_CATALOG.map((entry) => entry.id), TACH_THEME_IDS, "unified theme catalog should preserve exact TACH_THEME_IDS order");
assert.deepEqual(catalogMetadata, TACH_THEMES, "unified theme catalog metadata projection should match active TACH_THEMES export");
assert.deepEqual(catalogPalettes, PALETTES, "unified theme catalog palette projection should match active PALETTES export");

const themeIds = TACH_THEMES.map((theme) => theme.id);
const themeLabels = TACH_THEMES.map((theme) => theme.label);
assert.equal(new Set(themeIds).size, themeIds.length, "theme ids should be unique");
assert.equal(new Set(themeLabels).size, themeLabels.length, "theme labels should be unique");

for (const { id, label, group, groupLabel, tone, tags, detailTags, description, detailDescription } of TACH_THEMES) {
	assert.ok(label.trim(), `${id} should have a non-empty user-facing label`);
	assert.ok(group.trim(), `${id} should have a non-empty metadata group`);
	assert.equal(groupLabel, EXPECTED_THEME_GROUP_LABELS[group], `${id} browser group label should come from catalog display copy`);
	assert.ok(tone === "light" || tone === "dark", `${id} should declare a stable light/dark tone`);
	assert.ok(tags.length > 0, `${id} should have at least one metadata tag`);
	assert.equal(new Set(tags).size, tags.length, `${id} metadata tags should be unique`);
	for (const tag of tags) {
		assert.equal(tag, tag.trim(), `${id} metadata tag should be trimmed`);
		assert.match(tag, /^[a-z0-9-]+$/, `${id} metadata tag should be lowercase kebab text`);
	}
	assert.ok(detailTags.length > 0, `${id} should have browser detail tags`);
	assert.equal(new Set(detailTags).size, detailTags.length, `${id} browser detail tags should be unique`);
	for (const tag of detailTags) {
		assert.equal(tag, tag.trim(), `${id} browser detail tag should be trimmed`);
		assert.equal(themeIds.includes(tag as never), false, `${id} browser detail tag should not expose raw theme id ${tag}`);
	}
	assert.ok(description.trim(), `${id} should have a non-empty metadata description`);
	assert.ok(detailDescription.trim(), `${id} should have a non-empty browser detail description`);
	for (const themeId of themeIds) {
		assert.equal(includesRawThemeId(detailDescription, themeId), false, `${id} browser detail description should not expose raw theme id ${themeId}`);
	}
	assert.ok(PALETTES[id], `${id} palette should exist`);
	assert.equal(themeLabel(id), label, `${id} label should come from shared metadata`);
	assert.equal(isGlanceTpsThemeName(id), true, `${id} should validate as a theme name`);
}

const themesById = new Map(TACH_THEMES.map((theme) => [theme.id, theme]));
assert.deepEqual(themesById.get("dark")?.detailTags, ["default", "neutral"], "dark browser detail tags should keep raw id suppression");
assert.equal(themesById.get("dark")?.detailDescription, "Neutral dim palette for dim terminals.", "dark browser detail should keep low-light/friendly text behavior");
assert.equal(themesById.get("catppuccin-latte")?.detailDescription, "Soft Catppuccin palette with warm bright tones.", "light raw id should be friendly in browser detail copy");
assert.equal(themesById.get("kanagawa-wave")?.groupLabel, "Japanese", "kanagawa browser group label should stay friendly");
assert.equal(themesById.get("everforest-dark")?.groupLabel, "Forest", "everforest browser group label should stay friendly");
assert.equal(themesById.get("high-contrast-dark")?.groupLabel, "Accessible", "accessibility browser group label should stay friendly");

assert.equal(themeLabel("dracula" as never), "dracula", "unknown theme label should fall back to the provided id");
assert.equal(isGlanceTpsThemeName("catppuccin-macchiato"), true, "curated Catppuccin Macchiato theme should validate");
assert.equal(isGlanceTpsThemeName("high-contrast-light"), true, "new counterpart High Contrast Light theme should validate");
assert.equal(isGlanceTpsThemeName("one-light"), true, "new counterpart One Light theme should validate");
assert.equal(isGlanceTpsThemeName("kanagawa-lotus"), true, "new counterpart Kanagawa Lotus theme should validate");
assert.equal(isGlanceTpsThemeName("everforest-light"), true, "new counterpart Everforest Light theme should validate");
assert.equal(isGlanceTpsThemeName("dracula"), false, "unknown theme should not validate");

const selectedThemePair = { light: "one-light", dark: "tokyo-night" } as const;
assert.equal(selectGlanceTpsTheme(selectedThemePair, "light"), "one-light", "theme selection should return the light slot for light ambient tone");
assert.equal(selectGlanceTpsTheme(selectedThemePair, "dark"), "tokyo-night", "theme selection should return the dark slot for dark ambient tone");
assert.equal(resolveGlanceTpsRenderStyles(selectedThemePair, { ambientTone: "light" }).cacheKey, "glance-tps:one-light:truecolor", "render style resolver should use the light slot for ambient light");
assert.equal(resolveGlanceTpsRenderStyles(selectedThemePair, { ambientTone: "dark" }).cacheKey, "glance-tps:tokyo-night:truecolor", "render style resolver should use the dark slot for ambient dark");
assert.equal(resolveGlanceTpsRenderStyles(selectedThemePair).cacheKey, "glance-tps:one-light:truecolor", "render style resolver should default missing ambient tone to the light slot");
assert.equal(resolveGlanceTpsRenderStyles(selectedThemePair, { getAmbientTone: () => "dark" }).cacheKey, "glance-tps:tokyo-night:truecolor", "render style resolver should use lazy getAmbientTone when no static tone is provided");
assert.equal(
	resolveGlanceTpsRenderStyles(selectedThemePair, { ambientTone: "light", getAmbientTone: () => "dark" }).cacheKey,
	"glance-tps:one-light:truecolor",
	"render style resolver should prefer static ambientTone over getAmbientTone",
);
const explicitStyleOverride = resolveBuiltInGlanceTpsStyles("dark");
assert.equal(
	resolveGlanceTpsRenderStyles(selectedThemePair, { styles: explicitStyleOverride, ambientTone: "light", getAmbientTone: () => "dark" }),
	explicitStyleOverride,
	"render style resolver should return an explicit styles override without applying ambient tone selection",
);

function assertRgb(themeId: string, path: string, color: Rgb): void {
	for (const channel of ["r", "g", "b"] as const) {
		const value = color[channel];
		assert.ok(Number.isFinite(value), `${themeId}.${path}.${channel} should be finite`);
		assert.ok(Number.isInteger(value), `${themeId}.${path}.${channel} should be an integer`);
		assert.ok(value >= 0 && value <= 255, `${themeId}.${path}.${channel} should be in [0,255]`);
	}
}

function assertPalette(themeId: (typeof TACH_THEME_IDS)[number], theme: GlanceTpsPalette): void {
	assert.deepEqual(Object.keys(theme), PALETTE_KEYS, `${themeId} should preserve exact top-level palette key order`);
	assert.deepEqual(Object.keys(theme.segments), SEGMENT_IDS, `${themeId} should preserve exact segment color key order`);

	for (const key of ["text", "dim", "warn", "error", "separator", "border", "title"] as const) {
		assertRgb(themeId, key, theme[key]);
	}

	for (const segment of SEGMENT_IDS) {
		assert.ok(theme.segments[segment], `${themeId} should define ${segment} segment color`);
		assertRgb(themeId, `segments.${segment}.fg`, theme.segments[segment].fg);
	}
}

const colorModes = ["truecolor", "ansi256"] as const satisfies readonly GlanceTpsColorMode[];
const styleCacheKeys = new Set<string>();
for (const themeId of TACH_THEME_IDS) {
	const palette: GlanceTpsPalette = PALETTES[themeId];
	assertPalette(themeId, palette);

	for (const colorMode of colorModes) {
		const styles = resolveBuiltInGlanceTpsStyles(themeId, colorMode);
		const secondStyles = resolveBuiltInGlanceTpsStyles(themeId, colorMode);
		assert.equal(styles.cacheKey, `glance-tps:${themeId}:${colorMode}`, `${themeId} ${colorMode} resolved style cacheKey should be stable and capability-specific`);
		assert.equal(secondStyles, styles, "theme and color depth reuse the same immutable style resources");
		assert.equal(secondStyles.cacheKey, styles.cacheKey, `${themeId} ${colorMode} resolved style cacheKey should be stable across calls`);
		styleCacheKeys.add(styles.cacheKey);

		for (const role of STYLE_ROLE_KEYS) {
			const text = `${themeId}:${role}:sample`;
			const expected = colorMode === "truecolor" ? fg(palette[role], text) : fg256(palette[role], text);
			assert.equal(styles[role](text), expected, `${themeId}.${role} style should use ${colorMode} palette output`);
		}
		for (const segment of SEGMENT_IDS) {
			const text = `${themeId}:${segment}:segment`;
			const expected = colorMode === "truecolor" ? fg(palette.segments[segment].fg, text) : fg256(palette.segments[segment].fg, text);
			assert.equal(styles.segments[segment].fg(text), expected, `${themeId}.segments.${segment}.fg should use ${colorMode} palette output`);
		}
	}
}
assert.equal(styleCacheKeys.size, TACH_THEME_IDS.length * colorModes.length, "resolved style cache keys should be unique across themes and color modes");

assert.equal(rgbToAnsi256(PALETTES.light.text), 16, "light neutral text should map to the nearest xterm cube color");
assert.equal(rgbToAnsi256(PALETTES.dark.text), 254, "near-neutral dark-theme text should map to the nearest xterm grayscale color");
assert.equal(rgbToAnsi256(PALETTES.light.segments.context.fg), 29, "saturated context color should preserve its tint in the xterm cube");

assert.equal(
	resolveGlanceTpsRenderStyles(selectedThemePair, { ambientTone: "light", trueColor: false }).cacheKey,
	"glance-tps:one-light:ansi256",
	"a static false trueColor capability should select ANSI 256-color styles",
);
assert.equal(
	resolveGlanceTpsRenderStyles(selectedThemePair, { ambientTone: "dark", getTrueColor: () => false }).cacheKey,
	"glance-tps:tokyo-night:ansi256",
	"a lazy false trueColor capability should select ANSI 256-color styles",
);
assert.equal(
	resolveGlanceTpsRenderStyles(selectedThemePair, { ambientTone: "dark", trueColor: true, getTrueColor: () => false }).cacheKey,
	"glance-tps:tokyo-night:truecolor",
	"static trueColor should take precedence over the lazy capability provider",
);

console.log("✓ theme config checks passed");
