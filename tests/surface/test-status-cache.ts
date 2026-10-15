import { strict as assert } from "node:assert";
import { test } from "node:test";
import { cloneConfig, defaultConfig } from "../../src/config/model.js";
import { GlanceLineRenderer, renderGlanceLine } from "../../src/surface/status-line.js";
import { createInputSurfaceRenderer, renderInputSurface } from "../../src/surface/renderer.js";
import { resolveBuiltInGlanceStyles } from "../../src/theme/adapter.js";
import { ExtensionStatusCache } from "../../src/surface/extension-statuses.js";
import { richInputSurfaceState } from "../support/surface-test-harness.js";

test("external status snapshots are reused until keys or raw values change", () => {
	const cache = new ExtensionStatusCache();
	const statuses = new Map([["z", " Ready\t "], ["a", "\x1b[31mQuota\x1b[0m"]]);
	const initial = cache.read(statuses);
	assert.deepEqual(initial.map(entry => entry.key), ["a", "z"]);
	assert.equal(initial[1]!.text, "Ready");
	assert.strictEqual(cache.read(statuses), initial, "unchanged values reuse the normalized snapshot");
	assert.strictEqual(cache.read(new Map(statuses)), initial, "a fresh Map with the same contents reuses the snapshot");

	statuses.set("a", "\x1b[32mQuota\x1b[0m");
	const updated = cache.read(statuses);
	assert.notStrictEqual(updated, initial);
	assert.ok(updated[0]!.text.includes("\x1b[32m"));
	assert.ok(initial[0]!.text.includes("\x1b[31m"), "a retained snapshot is independent of later publisher changes");
	statuses.delete("a"); statuses.set("worker", "Busy");
	assert.deepEqual(cache.read(statuses).map(entry => entry.key), ["worker", "z"], "same-size key replacement is visible");
	assert.deepEqual(cache.read(undefined), []);
	assert.strictEqual(cache.read(new Map()), cache.read(undefined));
});

test("status cache skips collection until a render input changes", () => {
	let reads = 0;
	const sample = richInputSurfaceState();
	let state = { ...sample, get usage() { reads++; return sample.usage; } };
	let config = defaultConfig();
	let width = 160;
	let styles = resolveBuiltInGlanceStyles("light");
	let widthMode: "full" | "minimal" = "full";
	const renderer = new GlanceLineRenderer();
	const render = () => renderer.render(state, config, width, state.providers.availableCount, { styles, widthMode });
	const check = () => {
		const before = reads;
		const actual = render();
		assert.ok(reads > before, "changed inputs must refresh the status");
		const cached = reads;
		for (let i = 0; i < 30; i++) assert.equal(render(), actual);
		assert.equal(reads, cached, "unchanged frames do not recollect facts");
		assert.equal(actual, renderGlanceLine(state, config, width, state.providers.availableCount, { styles, widthMode }));
	};
	check();
	state.version++; check();
	state = { ...state, get usage() { reads++; return sample.usage; } }; check();
	config = cloneConfig(config); config.icons = "plain"; check();
	width = 80; check();
	styles = resolveBuiltInGlanceStyles("dark"); check();
	styles = resolveBuiltInGlanceStyles("dark", "ansi256"); check();
	state.providers.availableCount++; check();
	widthMode = "minimal"; check();
});

test("preview reuses status facts, not the animated frame or prompt contents", () => {
	let reads = 0;
	const sample = richInputSurfaceState();
	const state = { ...sample, get usage() { reads++; return sample.usage; } };
	const render = createInputSurfaceRenderer(state);
	const config = defaultConfig(); config.editor.activityMode = "sweep";
	const first = render(config, 100, { animation: { kind: "sweep", elapsedMs: 0, speed: 47 } });
	const baseline = reads;
	const next = render(config, 100, { animation: { kind: "sweep", elapsedMs: 900, speed: 47 }, contentLines: ["a different prompt"] });
	assert.equal(reads, baseline);
	assert.notDeepEqual(next, first);
	assert.ok(next.join("").includes("a different prompt"));
	assert.deepEqual(next, renderInputSurface(state, config, 100, { animation: { kind: "sweep", elapsedMs: 900, speed: 47 }, contentLines: ["a different prompt"] }));
	state.context.percent = 92; state.version++;
	assert.deepEqual(render(config, 100, { previewDensity: "full", trueColor: false }), renderInputSurface(state, config, 100, { previewDensity: "full", trueColor: false }));
});
