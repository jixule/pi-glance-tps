import { test } from "node:test";
import { strict as assert } from "node:assert";
import { defaultConfig } from "../../src/config/model.js";
import { stripControls } from "../../src/surface/format.js";
import { renderGlanceTpsLine } from "../../src/surface/status-line.js";
import { SPEED_SPINNER_FRAMES } from "../../src/runtime/live-speed.js";
import { testState } from "../support/helpers.js";
import type { LiveSpeedReading, GlanceTpsConfig, GlanceTpsState } from "../../src/types.js";

const frame = SPEED_SPINNER_FRAMES[0]!;

function throughputOnly(config: GlanceTpsConfig): GlanceTpsConfig {
	(config).segments = [{ id: "throughput", enabled: true }];
	return config;
}

function withLiveSpeed(state: GlanceTpsState, liveSpeed: LiveSpeedReading | null): GlanceTpsState {
	(state).liveSpeed = liveSpeed;
	return state;
}

function line(state: GlanceTpsState, config: GlanceTpsConfig, width: number): string {
	return stripControls(renderGlanceTpsLine(state, config, width));
}

const plainConfig = () => throughputOnly({ ...defaultConfig(), icons: "plain" });

test("live speed renders the spinner and rate while generating", () => {
	const config = plainConfig();
	const generating: LiveSpeedReading = { tokensPerSecond: 42.4, generating: true, spinnerFrame: frame };
	assert.equal(line(withLiveSpeed(testState(), generating), config, 120), `spd ${frame} 42 t/s`, "generating shows the spinner frame");
});

test("live speed renders a check mark with the final average", () => {
	const config = plainConfig();
	const finished: LiveSpeedReading = { tokensPerSecond: 42.4, generating: false, spinnerFrame: frame };
	assert.equal(line(withLiveSpeed(testState(), finished), config, 120), "spd ✓ 42 t/s", "finished shows the check mark");
	assert.equal(line(withLiveSpeed(testState(), finished), config, 80), "spd ✓ 42/s", "compact density drops the unit prefix");
});

test("an unknown live rate renders an ellipsis instead of a number", () => {
	const config = plainConfig();
	const early: LiveSpeedReading = { tokensPerSecond: 0, generating: true, spinnerFrame: frame };
	assert.equal(line(withLiveSpeed(testState(), early), config, 120), `spd ${frame} … t/s`, "too few tokens keeps the rate unknown");
});

test("live speed wins over the request-level throughput fallback", () => {
	const config = plainConfig();
	const state = withLiveSpeed(testState(), { tokensPerSecond: 42.4, generating: false, spinnerFrame: frame });
	(state).throughput = {
		lastRun: { elapsedMs: 1_000, outputTokens: 20, tokensPerSecond: 20 },
		currentRun: null,
	};
	assert.equal(line(state, config, 120), "spd ✓ 42 t/s", "the live reading takes precedence");
});

test("low and mid rates use the precision setting", () => {
	const config = plainConfig();
	(config).throughput = { precision: 1 };
	const generating: LiveSpeedReading = { tokensPerSecond: 7.04, generating: true, spinnerFrame: frame };
	assert.equal(line(withLiveSpeed(testState(), generating), config, 120), `spd ${frame} 7.0 t/s`, "precision=1 keeps one decimal");
	const finished: LiveSpeedReading = { tokensPerSecond: 1_234, generating: false, spinnerFrame: frame };
	assert.equal(line(withLiveSpeed(testState(), finished), config, 120), "spd ✓ 1.2k t/s", "large rates use compact k notation");
});
