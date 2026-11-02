import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Type } from "typebox";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { RuntimeRefreshSession } from "../../src/runtime/refresh-session.js";

test("real Pi lifecycle reuses completed Context snapshots and includes persisted tool results", { timeout: 10_000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), "glance-tps-context-host-"));
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	t.after(async () => { session?.dispose(); await rm(root, { recursive: true, force: true }); });
	const config = defaultConfig();
	let now = 0, calls = 0, reads = 0;
	const observed: Array<{ event: string; reads: number; tokens: number | null }> = [];
	const failures: unknown[] = [];
	const tracked = new RuntimeRefreshSession({
		getConfig: () => config, ensureConfig: async () => config, getThinkingLevel: () => "off",
		nowMs: () => now, requestRender() {}, scheduleGitRefresh() {},
	});
	// Count reads through a public context adapter, without changing the real host.
	function measured(ctx: ExtensionContext): ExtensionContext {
		return { ...ctx, getContextUsage: () => { reads++; return ctx.getContextUsage(); } };
	}
	async function observe(event: string, ctx: ExtensionContext, update: (ctx: ExtensionContext) => void | Promise<void>): Promise<void> {
		const before = reads;
		await update(measured(ctx));
		const expected = ctx.getContextUsage();
		const actual = tracked.getState()!.context;
		try {
			assert.deepEqual(actual, { tokens: expected?.tokens ?? null, window: expected?.contextWindow ?? ctx.model?.contextWindow ?? 0,
				percent: expected?.percent ?? null }, `${event}: cached Context must agree with the actual host projection`);
		} catch (error) { failures.push(error); }
		observed.push({ event, reads: reads - before, tokens: actual.tokens });
	}
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, cacheWarming: "off", retry: { enabled: false } });
	const loader = new DefaultResourceLoader({
		cwd: root, agentDir: root, settingsManager, noExtensions: true, noSkills: true,
		noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionFactories: [pi => {
			pi.registerProvider("glance-tps-context-local", {
				api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "DEMO-not-a-credential",
				models: [{ id: "local", name: "DEMO local", reasoning: false, input: ["text"], contextWindow: 200_000,
					maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
				streamSimple(model, _context, options) {
					const stream = createAssistantMessageEventStream(), call = ++calls;
					const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
						content: [], stopReason: "pending", timestamp: Date.now(), usage: { input: call * 1_000, output: 40,
							cacheRead: 0, cacheWrite: 0, totalTokens: call * 1_000 + 40,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
					void (async () => {
						try {
							now += 1_000; await options?.onPayload?.({ demo: true }, model);
							stream.push({ type: "start", partial: message });
							message.content = call === 1 ? [{ type: "toolCall", id: "demo-tool", name: "demo_result", arguments: {} }]
								: [{ type: "text", text: "DEMO complete" }];
							message.stopReason = call === 1 ? "toolUse" : "stop";
							now += 1_000; stream.push({ type: "done", reason: message.stopReason, message }); stream.end();
						} catch (error) {
							message.stopReason = "error"; message.errorMessage = String(error);
							stream.push({ type: "error", reason: "error", error: message }); stream.end();
						}
					})();
					return stream;
				},
			});
			pi.on("session_start", (_event, ctx) => { tracked.sessionStart(measured(ctx)); });
			pi.on("agent_start", () => tracked.agentStart());
			pi.on("turn_start", (_event, ctx) => observe("turn_start", ctx, next => tracked.turnStart(next)));
			pi.on("before_provider_request", () => tracked.providerRequest());
			pi.on("tool_execution_end", (_event, ctx) => observe("tool_execution_end", ctx, next => tracked.toolExecutionEnd(next)));
			pi.on("message_end", (event, ctx) => event.message.role === "assistant"
				? observe("assistant_end", ctx, next => tracked.messageEnd(event, next)) : tracked.messageEnd(event, measured(ctx)));
			pi.on("turn_end", (event, ctx) => observe("turn_end", ctx, next => tracked.turnEnd(event, next)));
			pi.on("agent_end", (event, ctx) => observe("agent_end", ctx, next => tracked.agentEnd(event, next)));
			pi.on("agent_settled", (_event, ctx) => observe("agent_settled", ctx, next => tracked.agentSettled(next)));
		}],
	});
	await loader.reload();
	const modelRuntime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null,
		modelsStorePath: join(root, "models-store.json"), allowModelNetwork: false, refreshOnCreate: false });
	({ session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime, resourceLoader: loader, settingsManager,
		sessionManager: SessionManager.inMemory(root), tools: ["demo_result"], customTools: [{ name: "demo_result", label: "DEMO result",
			description: "Return a local fixture", parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "DEMO tool output ".repeat(100) }], details: undefined }) }],
	}));
	await session.setModel(modelRuntime.getModel("glance-tps-context-local", "local")!);
	await session.bindExtensions({});
	session.setActiveToolsByName(["demo_result"]);
	await session.prompt("DEMO context lifecycle");
	assert.deepEqual(failures, [], "extension handler failures cannot be swallowed by the host");
	assert.equal(calls, 2);
	assert.equal(observed.find(row => row.event === "agent_end")?.reads, 0);
	assert.equal(observed.find(row => row.event === "agent_settled")?.reads, 1);
	const turns = observed.filter(row => row.event === "turn_end");
	assert.ok(turns[0]!.tokens! > observed.find(row => row.event === "assistant_end")!.tokens!, "persisted tool content increases the first turn's Context");
	assert.equal(turns[1]!.tokens, 2_040, "turn_end observes final provider usage after the assistant entry is persisted");
	assert.equal(tracked.getState()!.throughput.lastRun?.tokensPerSecond, 40);
});
