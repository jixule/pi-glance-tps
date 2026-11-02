import { THROUGHPUT_PRECISION_DESCRIPTOR } from "../config/schema.js";
import { choiceSetting } from "../config/settings.js";
import type { SegmentFeature } from "./feature.js";
import type { SegmentData, SegmentRenderContext, SegmentTone, ThroughputPrecision, LiveSpeedReading, ModelSpeedMeasurement } from "../types.js";

function formatThroughputRate(rate: number, precision: ThroughputPrecision): string {
	const scale = rate < 1_000 ? 1 : rate < 1_000_000 ? 1_000 : 1_000_000;
	const scaled = rate / scale;
	const decimals = precision === "auto" ? (scaled < 10 ? 1 : 0) : precision;
	const value = decimals === 0 ? `${Math.round(scaled)}` : scaled.toFixed(1);
	return `${value}${scale === 1 ? "" : scale === 1_000 ? "k" : "M"}`;
}

function validThroughput(turn: ModelSpeedMeasurement | null | undefined): turn is ModelSpeedMeasurement {
	const rate = turn?.tokensPerSecond;
	return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

/** Green-equivalent (normal), amber (warning) and red (error) speed bands. */
function toneForRate(rate: number): SegmentTone {
	if (rate <= 0) return "normal";
	if (rate >= 100) return "normal";
	if (rate >= 30) return "warning";
	return "error";
}

function liveSpeedData(live: LiveSpeedReading, precision: ThroughputPrecision): SegmentData {
	const rateText = live.tokensPerSecond > 0 ? formatThroughputRate(live.tokensPerSecond, precision) : "…";
	const marker = live.generating ? `${live.spinnerFrame} ` : "✓ ";
	const full = `${marker}${rateText} t/s`;
	return {
		primary: full,
		display: {
			full,
			compact: `${marker}${rateText}/s`,
			minimal: `${marker}${rateText}/s`,
		},
		tone: toneForRate(live.tokensPerSecond),
	};
}

function collectThroughput(ctx: SegmentRenderContext): SegmentData {
	if (ctx.state.liveSpeed) return liveSpeedData(ctx.state.liveSpeed, ctx.config.throughput.precision);
	const { currentRun, lastRun } = ctx.state.throughput;
	const turn = validThroughput(currentRun) ? currentRun : validThroughput(lastRun) ? lastRun : undefined;
	const formatted = turn
		? `${turn === currentRun ? "~" : ""}${formatThroughputRate(turn.tokensPerSecond, ctx.config.throughput.precision)}`
		: "?";
	return {
		primary: `${formatted} t/s`,
		display: {
			full: `${formatted} t/s`,
			compact: `${formatted}/s`,
			minimal: `${formatted}/s`,
		},
	};
}

export const throughputSegmentFeature = {
	id: "throughput",
	label: "实时速度",
	iconSpacing: { nerd: 2 },
	defaultEnabled: true,
	settings: [
		choiceSetting(
			"throughput.precision",
			"小数位",
			"生成中显示实时速度，结束后显示本条消息平均值；无实时数据时回退到请求级平均。",
			THROUGHPUT_PRECISION_DESCRIPTOR.values.map((value) => ({
				value,
				label: value === "auto" ? "自动" : value === 1 ? "1 位小数" : "取整",
			})),
			(c) => c.throughput.precision,
			(c, v) => {
				c.throughput.precision = v;
			},
		),
	],
	collect: collectThroughput,
} as const satisfies SegmentFeature;
