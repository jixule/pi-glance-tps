import { choiceSetting } from "../config/settings.js";
import type { SegmentFeature } from "./feature.js";
import { formatTokens } from "./display-primitives.js";
import type { SegmentData, SegmentRenderContext, UsageTotals } from "../types.js";

const TOKEN_CACHE_RATE_NERD_ICON = "󰑐"; // nf-md-refresh (U+F0450)

function shouldShowTokenCache(ctx: SegmentRenderContext): boolean {
	return ctx.config.tokens.cache !== "hide";
}

function sessionCacheHitPercent(usage: UsageTotals): number | undefined {
	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	return promptTokens > 0 ? Math.round((usage.cacheRead / promptTokens) * 100) : undefined;
}

function tokenCacheParts(ctx: SegmentRenderContext, hitRate: number | undefined): string[] {
	if (!shouldShowTokenCache(ctx)) return [];
	const usage = ctx.state.usage;
	const parts: string[] = [];
	if (ctx.config.tokens.cache === "rate") {
		if (hitRate !== undefined) {
			const icon = ctx.config.icons === "nerd" ? TOKEN_CACHE_RATE_NERD_ICON : "";
			parts.push(`${icon}${hitRate}%`);
		}
	} else {
		// Read/write mode shows the aggregate cache token amounts directly.
		if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
		if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	}
	return parts;
}

function tokenPrimary(ctx: SegmentRenderContext): string {
	const usage = ctx.state.usage;
	if (ctx.config.tokens.display === "total") return `total ${formatTokens(usage.input + usage.output)}`;
	return `↑${formatTokens(usage.input)} ↓${formatTokens(usage.output)}`;
}

function tokenMinimal(ctx: SegmentRenderContext): string {
	return formatTokens(ctx.state.usage.input + ctx.state.usage.output);
}

function collectTokens(ctx: SegmentRenderContext): SegmentData | undefined {
	const primary = tokenPrimary(ctx);
	const hitRate = ctx.config.tokens.cache === "rate" ? sessionCacheHitPercent(ctx.state.usage) : undefined;
	const cacheParts = tokenCacheParts(ctx, hitRate);
	const foldedRate = hitRate !== undefined ? `${hitRate}%` : undefined;
	return {
		primary,
		secondary: cacheParts.join(" ") || undefined,
		display: {
			full: [primary, ...cacheParts].join(" "),
			compact: foldedRate ?? primary,
			minimal: foldedRate ?? tokenMinimal(ctx),
		},
	};
}

export const tokensSegmentFeature = {
	id: "tokens",
	label: "Tokens",
	defaultEnabled: true,
	settings: [
		choiceSetting(
			"tokens.display",
			"显示",
			"本次会话的输入与输出 token 数。",
			[
				{ value: "input-output", label: "输入 + 输出" },
				{ value: "total", label: "输入输出合计" },
			],
			(c) => c.tokens.display,
			(c, v) => {
				c.tokens.display = v;
			},
		),
		choiceSetting(
			"tokens.cache",
			"缓存详情",
			"选择要显示的提示词缓存信息。",
			[
				{ value: "rate", label: "命中率" },
				{ value: "read-write", label: "读 / 写 tokens" },
				{ value: "hide", label: "隐藏" },
			],
			(c) => c.tokens.cache,
			(c, v) => {
				c.tokens.cache = v;
			},
		),
	],
	collect: collectTokens,
} as const satisfies SegmentFeature;
