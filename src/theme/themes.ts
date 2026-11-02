import { TACH_THEME_CATALOG } from "./catalog.js";

type ThemeCatalogMetadataShape = {
	readonly id: string;
	readonly label: string;
	readonly group: string;
	readonly groupLabel: string;
	readonly tone: string;
	readonly tags: readonly string[];
	readonly detailTags: readonly string[];
	readonly description: string;
	readonly detailDescription: string;
};

type ThemeMetadataProjection<Entry extends ThemeCatalogMetadataShape> = {
	readonly id: Entry["id"];
	readonly label: Entry["label"];
	readonly group: Entry["group"];
	readonly groupLabel: Entry["groupLabel"];
	readonly tone: Entry["tone"];
	readonly tags: Entry["tags"];
	readonly detailTags: Entry["detailTags"];
	readonly description: Entry["description"];
	readonly detailDescription: Entry["detailDescription"];
};

type ThemeMetadataCatalog<Catalog extends readonly ThemeCatalogMetadataShape[]> = {
	readonly [Index in keyof Catalog]: Catalog[Index] extends ThemeCatalogMetadataShape ? ThemeMetadataProjection<Catalog[Index]> : never;
};

type ThemeIdCatalog<Catalog extends readonly ThemeCatalogMetadataShape[]> = {
	readonly [Index in keyof Catalog]: Catalog[Index] extends ThemeCatalogMetadataShape ? Catalog[Index]["id"] : never;
};

// Theme order in the settings browser.
export const TACH_THEMES = TACH_THEME_CATALOG.map(({ id, label, group, groupLabel, tone, tags, detailTags, description, detailDescription }) => ({
	id,
	label,
	group,
	groupLabel,
	tone,
	tags,
	detailTags,
	description,
	detailDescription,
})) as unknown as ThemeMetadataCatalog<typeof TACH_THEME_CATALOG>;

export type GlanceTpsThemeName = (typeof TACH_THEME_CATALOG)[number]["id"];

export const TACH_THEME_IDS = TACH_THEME_CATALOG.map((theme) => theme.id) as unknown as ThemeIdCatalog<typeof TACH_THEME_CATALOG>;
export const TACH_THEME_ID_SET: ReadonlySet<GlanceTpsThemeName> = new Set(TACH_THEME_IDS);

export function isGlanceTpsThemeName(value: unknown): value is GlanceTpsThemeName {
	return typeof value === "string" && TACH_THEME_ID_SET.has(value as GlanceTpsThemeName);
}

export function themeLabel(theme: GlanceTpsThemeName): string {
	return TACH_THEMES.find((metadata) => metadata.id === theme)?.label ?? theme;
}
