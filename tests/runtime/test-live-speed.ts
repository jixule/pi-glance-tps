import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
	charactersFromMessage,
	estimatedTokensFromCharacters,
	LiveSpeedTracker,
} from "../../src/runtime/live-speed.js";

function assistant(content: unknown[]): unknown {
	return { role: "assistant", content };
}

test("charactersFromMessage counts text, thinking and tool-call payloads", () => {
	assert.equal(charactersFromMessage(assistant([])), 0, "empty content has no characters");
	assert.equal(charactersFromMessage({ role: "user", content: [{ type: "text", text: "abc" }] }), 3, "non-message input still counts its blocks");
	assert.equal(
		charactersFromMessage(assistant([
			{ type: "text", text: "abcd" },
			{ type: "thinking", thinking: "abcdefgh" },
			{ type: "toolCall", name: "read", arguments: { path: "x" } },
		])),
		4 + 8 + "read".length + JSON.stringify({ path: "x" }).length,
		"text, thinking and tool calls all contribute characters",
	);
	assert.equal(estimatedTokensFromCharacters(9), 3, "estimate rounds characters up to tokens");
});

test("live speed stays unknown below ten estimated tokens", () => {
	const tracker = new LiveSpeedTracker();
	tracker.start();
	tracker.observe(8, 100);
	const reading = tracker.reading();
	assert.ok(reading, "generating always has a reading");
	assert.equal(reading.tokensPerSecond, 0, "tiny samples stay unknown");
});

test("live speed samples deltas over the 250ms window and smooths them", () => {
	const tracker = new LiveSpeedTracker();
	tracker.start();
	// 40 tokens after 1s of generation: opening sample only, no rate yet.
	tracker.observe(160, 1_000);
	assert.equal(tracker.reading()?.tokensPerSecond, 0, "the first sample only opens the window");
	// +40 tokens over 250ms = 160 t/s; EMA starts from the first instant rate.
	tracker.observe(320, 1_250);
	assert.equal(tracker.reading()?.tokensPerSecond, 160, "first window sets the rate");
	// +20 tokens over 250ms = 80 t/s; EMA α = 0.3 → 160*0.7 + 80*0.3 = 136.
	tracker.observe(400, 1_500);
	assert.equal(Math.round(tracker.reading()!.tokensPerSecond), 136, "later windows are smoothed");
	// Samples closer than the window are ignored.
	const before = tracker.reading()!.tokensPerSecond;
	tracker.observe(800, 1_510);
	assert.equal(tracker.reading()!.tokensPerSecond, before, "samples inside the window are ignored");
});

test("finish publishes the generation-window average and clears on reset", () => {
	const tracker = new LiveSpeedTracker();
	tracker.start();
	tracker.observe(160, 2_000);
	tracker.observe(400, 2_500);
	const reading = tracker.finish(120, 400, 3_000);
	assert.ok(reading, "a valid window produces a final reading");
	assert.equal(reading.generating, false, "finish ends generation");
	// 120 reported output tokens over 1s from first content.
	assert.equal(reading.tokensPerSecond, 120, "final rate uses reported output over the generation window");
	assert.equal(tracker.finish(0, 0, 4_000), null, "finishing twice is a no-op");
	tracker.reset();
	assert.equal(tracker.reading(), null, "reset clears the reading");
	assert.equal(tracker.isGenerating(), false, "reset stops generation");
});

test("finish without a generation window leaves the fallback in charge", () => {
	const tracker = new LiveSpeedTracker();
	tracker.start();
	const reading = tracker.finish(0, 0, 5_000);
	assert.equal(reading, null, "no elapsed content means no live reading");
	assert.equal(tracker.isGenerating(), false, "generation still ends");
});

test("not generating ignores observations and frames", () => {
	const tracker = new LiveSpeedTracker();
	assert.equal(tracker.observe(400, 100), false, "observe is inert before start");
	assert.equal(tracker.advanceFrame(), false, "frames are inert before start");
});
