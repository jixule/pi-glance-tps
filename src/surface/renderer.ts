import { renderInputSurfaceFrame } from "./frame.js";
import { GlanceTpsLineRenderer } from "./status-line.js";
import { resolveGlanceTpsRenderStyles, type GlanceTpsRenderStyleContext } from "../theme/adapter.js";
import type { ActivityAnimation, ActivityStatus, GlanceTpsConfig, GlanceTpsState, WidthMode } from "../types.js";

interface InputSurfaceRenderOptions extends GlanceTpsRenderStyleContext {
	activity?: ActivityStatus;
	animation?: ActivityAnimation;
	hasDraft?: boolean;
	extensionStatuses?: ReadonlyMap<string, string>;
	contentLines?: string[];
	focused?: boolean;
	showTitle?: boolean;
	previewDensity?: WidthMode;
}

const PREVIEW_STATE: GlanceTpsState = {
	workspace: { name: "pi-glance-tps", path: "/Users/winnie/projects/pi-glance-tps" },
	git: {
		repo: true,
		branch: "main",
		detached: false,
		sha: "a1b2c3d",
		upstream: "origin/main",
		ahead: 2,
		behind: 1,
		staged: 1,
		unstaged: 1,
		untracked: 0,
		conflicts: 0,
		dirty: true,
		status: "dirty",
		summary: { files: 2, additions: 42, deletions: 8 },
		updatedAt: 0,
	},
	providers: { availableCount: 2 },
	model: { id: "claude-sonnet-4-20250514", provider: "anthropic", displayName: "Sonnet 4", thinking: "high" },
	context: { tokens: 46_800, window: 200_000, percent: 23.4 },
	usage: { input: 12_400, output: 3_100, cacheRead: 800, cacheWrite: 0, cost: 0.042 },
	throughput: { lastRun: null, currentRun: null },
	version: 0,
	liveSpeed: null,
};

export function renderInputSurfacePreview(
	config: GlanceTpsConfig,
	width: number,
	options: InputSurfaceRenderOptions = {},
): string[] {
	return renderInputSurface(PREVIEW_STATE, config, width, options);
}

export function renderInputSurface(
	state: GlanceTpsState,
	config: GlanceTpsConfig,
	width: number,
	options: InputSurfaceRenderOptions = {},
): string[] {
	return createInputSurfaceRenderer(state)(config, width, options);
}

/** Own the preview's cache without caching prompt text, layout or animation. */
export function createInputSurfaceRenderer(source: GlanceTpsState | (() => GlanceTpsState) = PREVIEW_STATE) {
	const statusLine = new GlanceTpsLineRenderer();
	return (config: GlanceTpsConfig, width: number, options: InputSurfaceRenderOptions = {}): string[] => {
		const state = typeof source === "function" ? source() : source;
		const styles = resolveGlanceTpsRenderStyles(config.theme, options, config.editor.workingSweepColor);
		return renderInputSurfaceFrame({
			state,
			config,
			width,
			styles,
			body: {
				kind: "preview",
				lines: options.contentLines,
				showPromptIndicator: Boolean(options.focused),
			},
			chrome: {
				activity: options.activity,
				animation: options.animation,
				hasDraft: options.hasDraft,
				showTitle: options.showTitle,
			},
			status: {
				render: (budget) =>
					statusLine.render(state, config, budget, state.providers.availableCount, {
						styles,
						extensionStatuses: options.extensionStatuses,
						widthMode: options.previewDensity,
					}),
			},
		});
	};
}
