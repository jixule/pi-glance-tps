import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { RuntimeRefreshSession } from "../../src/runtime/refresh-session.js";
import { createRuntimeRefreshContext } from "../support/runtime-refresh-harness.js";

function createSession() {
	const config = defaultConfig();
	return new RuntimeRefreshSession({
		getConfig: () => config, ensureConfig: async () => config,
		getThinkingLevel: () => "off", nowMs: () => 0,
		requestRender() {}, scheduleGitRefresh() {},
	});
}

test("unchanged lifecycle events reuse Context while new entries and final settlement refresh it", async () => {
	const root = { type: "message", id: "root", parentId: null, message: { role: "user" } };
	const h = createRuntimeRefreshContext({ entries: [root] });
	const session = createSession();
	const state = session.sessionStart(h.ctx);
	session.agentStart();
	await session.turnStart(h.ctx);
	h.setContextUsage({ tokens: 2_000, contextWindow: 200_000, percent: 1 });
	await session.messageEnd({ message: { role: "assistant" } }, h.ctx);
	const reads = h.getContextReads();
	for (let i = 0; i < 10; i++) {
		await session.toolExecutionEnd(h.ctx);
		await session.turnEnd({}, h.ctx);
		await session.agentEnd({}, h.ctx);
		await session.turnStart(h.ctx);
	}
	assert.equal(h.getContextReads(), reads, "a stable session position must not rebuild the host's Context projection");
	assert.equal(state.context.tokens, 2_000);

	h.setEntries([root, { type: "message", id: "tool", parentId: "root", message: { role: "toolResult" } }]);
	h.setContextUsage({ tokens: 3_000, contextWindow: 200_000, percent: 1.5 });
	await session.turnEnd({}, h.ctx);
	assert.equal(h.getContextReads(), reads + 1);
	assert.equal(state.context.tokens, 3_000, "persisted tool output changes Context even if the model is unchanged");
	await session.agentEnd({}, h.ctx);
	assert.equal(h.getContextReads(), reads + 1);

	h.setContextUsage({ tokens: 3_100, contextWindow: 200_000, percent: 1.55 });
	session.agentSettled(h.ctx);
	assert.equal(h.getContextReads(), reads + 2, "settlement takes an authoritative reading even at the same leaf");
	assert.equal(state.context.tokens, 3_100);
	assert.equal(h.getEntryReads(), 1, "ordinary events never rescan the whole ledger");
	assert.equal(h.getBranchReads(), 0);
});

test("authoritative events and model changes invalidate Context at the same persisted leaf", async () => {
	const model = { id: "auto", provider: "router", contextWindow: 1_000_000 };
	const h = createRuntimeRefreshContext({ model, entries: [{ type: "message", id: "same-leaf" }] });
	const session = createSession();
	const state = session.sessionStart(h.ctx);
	async function fresh(update: () => void | Promise<void>, tokens: number | null, window = 200_000) {
		const reads = h.getContextReads();
		const percent = tokens === null ? null : tokens / window * 100;
		h.setContextUsage({ tokens, contextWindow: window, percent });
		await update();
		assert.equal(h.getContextReads(), reads + 1);
		assert.deepEqual(state.context, { tokens, window, percent });
	}
	await fresh(() => session.modelSelect(h.ctx), 10_000, 128_000);
	await fresh(() => session.sessionCompact({ compactionEntry: { type: "compaction", id: "compact" } }, h.ctx), null);
	await session.turnEnd({}, h.ctx);
	assert.equal(state.context.tokens, null, "unknown Context stays unknown until Pi reports a new authoritative value");
	await fresh(() => session.messageEnd({ message: { role: "assistant" } }, h.ctx), 8_000);
	await fresh(() => session.sessionTree(h.ctx), 9_000);
	for (const mutate of [() => { model.contextWindow = 256_000; }, () => { model.id = "other"; }, () => { model.provider = "other-provider"; }]) {
		mutate();
		await fresh(() => session.turnStart(h.ctx), 12_000, 256_000);
	}
	const reads = h.getContextReads();
	h.setContextUsage(undefined);
	await session.modelSelect(h.ctx);
	await session.turnEnd({}, h.ctx);
	assert.equal(h.getContextReads(), reads + 1, "an absent public reading is also reusable");
	assert.deepEqual(state.context, { tokens: null, window: 256_000, percent: null });
	await fresh(async () => { session.agentStart(); await session.turnStart(h.ctx); }, 15_000);
	await fresh(async () => { await session.thinkingLevelSelect(h.ctx); await session.turnStart(h.ctx); }, 16_000);
	session.sessionShutdown();
	h.setContextUsage({ tokens: 50, contextWindow: 200_000, percent: 0.025 });
	assert.equal(session.sessionStart(h.ctx).context.tokens, 50, "a new session cannot reuse the retired snapshot");
});

test("Context remains live without a usable persisted cursor", async () => {
	const h = createRuntimeRefreshContext();
	const session = createSession();
	const state = session.sessionStart(h.ctx);
	for (const tokens of [1_000, 2_000]) {
		h.setContextUsage({ tokens, contextWindow: 200_000, percent: tokens / 2_000 });
		await session.toolExecutionEnd(h.ctx);
		assert.equal(state.context.tokens, tokens);
	}
});
