import { test } from "node:test";
import { strict as assert } from "node:assert";
import { visibleWidth } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { stripControls } from "../../src/surface/format.js";
import { renderGlanceTpsLine } from "../../src/surface/status-line.js";
import { testState } from "../support/helpers.js";
import type { GlanceTpsConfig, GlanceTpsState } from "../../src/types.js";

import type { SegmentConfig as SegmentConfigLike, ThroughputPrecision, ModelSpeedMeasurement as ThroughputTurnFixture } from "../../src/types.js";

function setSegments(config: GlanceTpsConfig, segments: SegmentConfigLike[]): GlanceTpsConfig {
	(config).segments = segments;
	return config;
}

function setPrecision(config: GlanceTpsConfig, precision: ThroughputPrecision): GlanceTpsConfig {
	(config).throughput = { precision };
	return config;
}

function withThroughput(state: GlanceTpsState, lastRun: ThroughputTurnFixture | null, currentRun: ThroughputTurnFixture | null = null): GlanceTpsState {
	(state).throughput = { lastRun, currentRun };
	return state;
}

function plain(state: GlanceTpsState, config: GlanceTpsConfig, width: number): string {
	return stripControls(renderGlanceTpsLine(state, config, width));
}

function plainPreservingSpaces(state: GlanceTpsState, config: GlanceTpsConfig, width: number): string {
	return renderGlanceTpsLine(state, config, width)
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\r\n\t]/g, " ")
		.trim();
}

const sample: ThroughputTurnFixture = { elapsedMs: 2500, outputTokens: 50, tokensPerSecond: 20 };

function turn(rate: number): ThroughputTurnFixture {
	return { elapsedMs: 1_000, outputTokens: rate, tokensPerSecond: rate };
}

await test("default status line should show finalized Output throughput between Cost and Context while keeping Model last", async () => {
	const config = defaultConfig();
	const state = withThroughput(testState(), sample);
	assert.equal(
		plain(state, config, 120),
		"󰈸 $0.000 ·  20 t/s · 󰔟 23% 47k/200k · 󰄨 ↑100 ↓50 󰑐0% · 󰚩 GPT 5.5",
		"default status line should show finalized Output throughput between Cost and Context while keeping Model last",
	);
});

await test("explicitly disabled throughput segment should render nothing, including no placeholder", async () => {
	const config = setSegments(defaultConfig(), [{ id: "throughput", enabled: false }]);
	assert.equal(plain(withThroughput(testState(), null), config, 120), "", "explicitly disabled throughput segment should render nothing, including no placeholder");
});

await test("enabled throughput full status should render unknown ? placeholder when both slots are null", async () => {
	const config = setSegments({ ...defaultConfig(), icons: "plain" }, [{ id: "throughput", enabled: true }]);
	assert.equal(plain(withThroughput(testState(), null), config, 120), "spd ? t/s", "enabled throughput full status should render unknown ? placeholder when both slots are null");
	assert.equal(plain(withThroughput(testState(), null), config, 80), "spd ?/s", "enabled throughput compact status should render compact ?/s placeholder");
	assert.equal(plain(withThroughput(testState(), null), config, 48), "spd ?/s", "enabled throughput minimal status should render compact ?/s placeholder");

	const nerdConfig = setSegments({ ...defaultConfig(), icons: "nerd" }, [{ id: "throughput", enabled: true }]);
	assert.equal(plainPreservingSpaces(withThroughput(testState(), null), nerdConfig, 120), "  ? t/s", "nerd Output throughput icon should keep extra visual spacing before the placeholder");
});

await test("enabled throughput full status should render final plain icon plus t/s copy", async () => {
	const config = setSegments({ ...defaultConfig(), icons: "plain" }, [{ id: "throughput", enabled: true }]);
	const state = withThroughput(testState(), sample);
	assert.equal(plain(state, config, 120), "spd 20 t/s", "full status keeps the concise t/s label");
	assert.equal(plain(state, config, 80), "spd 20/s", "enabled throughput compact status should render final compact /s copy");
	assert.equal(plain(state, config, 48), "spd 20/s", "enabled throughput minimal status should render final compact /s copy");
});

await test("currentRun should win over lastRun and render with a provisional ~ marker in full width", async () => {
	const config = setSegments({ ...defaultConfig(), icons: "plain" }, [{ id: "throughput", enabled: true }]);
	const current = turn(42);
	const state = withThroughput(testState(), sample, current);
	assert.equal(plain(state, config, 120), "spd ~42 t/s", "currentRun should win over lastRun and render with a provisional ~ marker in full width");
	assert.equal(plain(state, config, 80), "spd ~42/s", "currentRun should render with a provisional ~ marker in compact width");
});

await test("invalid currentRun should fall back to a valid final lastRun", async () => {
	const config = setSegments({ ...defaultConfig(), icons: "plain" }, [{ id: "throughput", enabled: true }]);
	const invalidCurrent = turn(0);
	const invalidFinal = turn(Number.NaN);
	assert.equal(plain(withThroughput(testState(), sample, invalidCurrent), config, 120), "spd 20 t/s", "invalid currentRun should fall back to a valid final lastRun");
	assert.equal(plain(withThroughput(testState(), invalidFinal, invalidCurrent), config, 120), "spd ? t/s", "invalid currentRun and invalid lastRun should fall back to the unknown placeholder");
});

await test("precision auto should keep one decimal below 10 t/s", async () => {
	const config = setSegments({ ...defaultConfig(), icons: "plain" }, [{ id: "throughput", enabled: true }]);
	assert.equal(plain(withThroughput(testState(), turn(7.04)), setPrecision(config, "auto"), 120), "spd 7.0 t/s", "precision auto should keep one decimal below 10 t/s");
	assert.equal(plain(withThroughput(testState(), turn(42.4)), setPrecision(defaultConfig(), "auto"), 120), "󰈸 $0.000 ·  42 t/s · 󰔟 23% 47k/200k · 󰄨 ↑100 ↓50 󰑐0% · 󰚩 GPT 5.5", "precision auto should round integer-rate values at normal widths");
});

await test("precision=1 should force one decimal for low rates", async () => {
	const config = setSegments(setPrecision({ ...defaultConfig(), icons: "plain" }, 1), [{ id: "throughput", enabled: true }]);
	assert.equal(plain(withThroughput(testState(), turn(7)), config, 120), "spd 7.0 t/s", "precision=1 should force one decimal for low rates");
	assert.equal(plain(withThroughput(testState(), turn(42)), config, 120), "spd 42.0 t/s", "precision=1 should force one decimal for normal rates");
	assert.equal(plain(withThroughput(testState(), turn(1_234)), config, 120), "spd 1.2k t/s", "precision=1 should apply to compact k mantissas for large rates");
	assert.equal(plain(withThroughput(testState(), turn(1_234_567)), config, 120), "spd 1.2M t/s", "precision=1 should apply to compact M mantissas for very large rates");
});

await test("precision=0 should round to integer for low rates", async () => {
	const config = setSegments(setPrecision({ ...defaultConfig(), icons: "plain" }, 0), [{ id: "throughput", enabled: true }]);
	assert.equal(plain(withThroughput(testState(), turn(7.4)), config, 120), "spd 7 t/s", "precision=0 should round to integer for low rates");
	assert.equal(plain(withThroughput(testState(), turn(42.4)), config, 120), "spd 42 t/s", "precision=0 should round to integer for normal rates");
	assert.equal(plain(withThroughput(testState(), turn(1_234)), config, 120), "spd 1k t/s", "precision=0 should apply to compact k mantissas for large rates");
});

await test("roomy default-order status should include Git when available", async () => {
	const config = defaultConfig();
	const richState = withThroughput(
		testState({
			git: { ...testState().git, repo: true, branch: "main", status: "dirty", dirty: true, unstaged: 1 },
			model: { id: "gpt-5.5", provider: "openai", displayName: "GPT 5.5", thinking: "high" },
			context: { tokens: 46_800, window: 200_000, percent: 23.4 },
			usage: { input: 12_400, output: 3_100, cacheRead: 800, cacheWrite: 20, cost: 0.042 },
		}),
		sample,
	);
	const roomy = plain(richState, config, 160);
	assert.ok(roomy.includes(" main ●"), "roomy default-order status should include Git when available");
	assert.ok(roomy.includes(" 20 t/s"), "roomy default-order status should include Output throughput by default");
	assert.ok(roomy.includes("󰚩 GPT 5.5 high"), "roomy default-order status should include Model");
	assert.ok(roomy.includes("󰄨 ↑12k ↓3.1k 󰑐6%"), "roomy default-order status should include Tokens and cache rate");
	assert.ok(roomy.indexOf("$0.042") < roomy.indexOf(" 20 t/s"), "Cost should render before Output throughput by default");
	assert.ok(roomy.indexOf(" 20 t/s") < roomy.indexOf("󰔟 23% 47k/200k"), "Output throughput should render before Context by default");
	assert.ok(roomy.indexOf("󰔟 23% 47k/200k") < roomy.indexOf("󰄨 ↑12k ↓3.1k 󰑐6%"), "Tokens should render after Context by default");
	assert.ok(roomy.indexOf("󰄨 ↑12k ↓3.1k 󰑐6%") < roomy.indexOf("󰚩 GPT 5.5 high"), "Model should stay last after Tokens");

	const withoutTokens = defaultConfig();
	withoutTokens.segments.find((segment) => segment.id === "tokens")!.enabled = false;
	const tokenLine = plain(richState, withoutTokens, 180);
	assert.ok(!tokenLine.includes("󰄨"), "explicitly disabled Tokens should stay hidden");
	assert.ok(tokenLine.includes("󰚩 GPT 5.5 high"), "disabling Tokens should retain the final Model");

	const narrow = plain(richState, config, 48);
	assert.ok(visibleWidth(narrow) <= 48, "fitted status line should stay within width budget");
});

console.log("✓ throughput status-line checks passed");
