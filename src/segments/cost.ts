import { formatCost } from "./display-primitives.js";
import { toggleSetting } from "../config/settings.js";
import type { SegmentFeature } from "./feature.js";
import type { SegmentData, SegmentRenderContext } from "../types.js";

function collectCost(ctx: SegmentRenderContext): SegmentData | undefined {
	if (ctx.config.cost.hideZero && (!Number.isFinite(ctx.state.usage.cost) || ctx.state.usage.cost <= 0))
		return undefined;
	return {
		primary: formatCost(ctx.state.usage.cost),
	};
}

export const costSegmentFeature = {
	id: "cost",
	label: "费用",
	defaultEnabled: true,
	settings: [
		toggleSetting(
			"cost.hideZero",
			"隐藏零费用",
			"费用大于零之前不显示本次会话花费。",
			(c) => c.cost.hideZero,
			(c, v) => {
				c.cost.hideZero = v;
			},
		),
	],
	collect: collectCost,
} as const satisfies SegmentFeature;
