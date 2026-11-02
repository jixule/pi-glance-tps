import { PromptStash } from "../input/stash.js";
import { performance } from "node:perf_hooks";
import { getCapabilities } from "@earendil-works/pi-tui";
import type {
	AgentEndEvent,
	AgentSettledEvent,
	AgentStartEvent,
	BeforeProviderRequestEvent,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionEvent,
	MessageEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
	ReadonlyFooterDataProvider,
	SessionCompactEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	SessionTreeEvent,
	ToolExecutionEndEvent,
	TurnEndEvent,
	TurnStartEvent,
	UIPromptEndEvent,
	UIPromptStartEvent,
} from "@earendil-works/pi-coding-agent";
import type { ConfigLoadResult } from "../config/store.js";
import { GlanceTpsEditor } from "../surface/editor.js";
import { GlanceTpsFooter } from "../surface/footer.js";
import { GitRefresher } from "./git.js";
import type { ScheduleActivityFrame } from "./activity-animation.js";
import { RuntimeRefreshSession } from "./refresh-session.js";
import { SPEED_FRAME_INTERVAL_MS } from "./live-speed.js";
import type { GlanceTpsRenderStyleContext } from "../theme/adapter.js";
import type { ExtensionStatusSource, GitSnapshot, GlanceTpsConfig, GlanceTpsState } from "../types.js";

export type GlanceTpsPaneResult = { action: "save"; config: GlanceTpsConfig } | { action: "cancel" };

export interface RuntimeGitRefresher {
	schedule(immediate?: boolean): void;
	dispose(): void;
}

export interface CreateGitRefresherOptions {
	canFetch(): boolean;
	getConfig(): GlanceTpsConfig["git"];
	getCwd(): string | undefined;
	onSnapshot(cwd: string, snapshot: GitSnapshot): void;
}

export interface RuntimeShowPaneOptions {
	readonly getPreviewState?: () => GlanceTpsState;
	readonly getExtensionStatuses?: ExtensionStatusSource;
	readonly renderStyleContext?: GlanceTpsRenderStyleContext;
}

export interface GlanceTpsRuntimeAdapters {
	loadDraft?(sessionId: string): string | null;
	saveDraft?(sessionId: string, text: string | null): void;
	workingSweepNowMs?: () => number;
	scheduleSweepFrame?: ScheduleActivityFrame;
	getThinkingLevel(): string;
	loadConfigSync(): ConfigLoadResult;
	loadConfig(): Promise<ConfigLoadResult>;
	saveConfig(config: GlanceTpsConfig): Promise<void>;
	showPane(initial: GlanceTpsConfig, ctx: ExtensionCommandContext, previewState?: GlanceTpsState, options?: RuntimeShowPaneOptions): Promise<GlanceTpsPaneResult>;
	createGitRefresher?: (options: CreateGitRefresherOptions) => RuntimeGitRefresher;
	nowMs?: () => number;
	getTrueColor?: () => boolean;
}

type RuntimeModelSelectEvent = Extract<ExtensionEvent, { type: "model_select" }>;
type RuntimeThinkingLevelSelectEvent = Extract<ExtensionEvent, { type: "thinking_level_select" }>;
type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

export interface GlanceTpsRuntime {
	commands: {
		openPane(args: string, ctx: ExtensionCommandContext): Promise<void>;
	};
	events: {
		sessionStart(event: SessionStartEvent, ctx: ExtensionContext): void;
		sessionShutdown(event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void>;
		modelSelect(event: RuntimeModelSelectEvent, ctx: ExtensionContext): Promise<void>;
		thinkingLevelSelect(event: RuntimeThinkingLevelSelectEvent, ctx: ExtensionContext): Promise<void>;
		turnStart(event: TurnStartEvent, ctx: ExtensionContext): Promise<void>;
		toolExecutionEnd(event: ToolExecutionEndEvent, ctx: ExtensionContext): Promise<void>;
		sessionTree(event: SessionTreeEvent, ctx: ExtensionContext): Promise<void>;
		sessionCompact(event: SessionCompactEvent, ctx: ExtensionContext): Promise<void>;
		providerRequest(event: BeforeProviderRequestEvent, ctx: ExtensionContext): void;
		uiPromptStart(event: UIPromptStartEvent, ctx: ExtensionContext): void;
		uiPromptEnd(event: UIPromptEndEvent, ctx: ExtensionContext): void;
		messageEnd(event: MessageEndEvent, ctx: ExtensionContext): Promise<void>;
	messageStart(event: MessageStartEvent, ctx: ExtensionContext): void;
	messageUpdate(event: MessageUpdateEvent, ctx: ExtensionContext): void;
		turnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<void>;
		agentStart(event: AgentStartEvent, ctx: ExtensionContext): void;
		agentEnd(event: AgentEndEvent, ctx: ExtensionContext): Promise<void>;
		agentSettled(event: AgentSettledEvent, ctx: ExtensionContext): void;
	};
}

function createDefaultGitRefresher(options: CreateGitRefresherOptions): RuntimeGitRefresher {
	return new GitRefresher(options.getConfig, options.getCwd, options.onSnapshot, { canFetch: options.canFetch });
}

function isTuiMode(ctx: ExtensionContext): boolean {
	return ctx.mode === "tui";
}

function runtimeRenderStyleContext(ctx: ExtensionContext, getTrueColor: () => boolean): GlanceTpsRenderStyleContext {
	return {
		getAmbientTone: () => ctx.ui.theme.appearance,
		getTrueColor,
	};
}

export function createGlanceTpsRuntime(adapters: GlanceTpsRuntimeAdapters): GlanceTpsRuntime {
	let config: GlanceTpsConfig | undefined;
	let configWritable = true;
	let configDiagnostic: string | undefined;
	let configDiagnosticStatus: ConfigLoadResult["status"] | undefined;
	let configDiagnosticNotified = false;
	let extensionStatusProvider: Pick<ReadonlyFooterDataProvider, "getExtensionStatuses"> | undefined;
	const getExtensionStatuses = () => extensionStatusProvider?.getExtensionStatuses();
	let footer: GlanceTpsFooter | undefined;
	let ownedEditorFactory: EditorFactory | undefined;
	let previousEditorFactory: EditorFactory | undefined;
	let gitRefresher: RuntimeGitRefresher | undefined;
	let requestRender: (() => void) | undefined;
	let speedFrameTimer: ReturnType<typeof setInterval> | undefined;
	let activeEditor: GlanceTpsEditor | undefined;
	let waitingForUi = false;
	let inputPaneOpen = false;
	let stash: PromptStash | undefined;
	let canFetch = () => false;
	let uiGeneration = 0;
	const nowMs = adapters.nowMs ?? (() => performance.now());
	const getTrueColor = adapters.getTrueColor ?? (() => getCapabilities().trueColor);

	function acceptConfigLoad(result: ConfigLoadResult): GlanceTpsConfig {
		config = result.config;
		configWritable = result.writable;
		configDiagnostic = result.diagnostic;
		configDiagnosticStatus = result.status;
		configDiagnosticNotified = false;
		return result.config;
	}

	function notifyConfigDiagnostic(ctx: ExtensionContext): void {
		if (!ctx.hasUI || !configDiagnostic || configDiagnosticNotified) return;
		configDiagnosticNotified = true;
		ctx.ui.notify(configDiagnostic, configDiagnosticStatus === "future" ? "warning" : "error");
	}

	async function ensureConfig(): Promise<GlanceTpsConfig> {
		if (!config) return acceptConfigLoad(await adapters.loadConfig());
		return config;
	}

	function getConfig(): GlanceTpsConfig {
		if (!config) throw new Error("pi-glance-tps config not loaded");
		return config;
	}

	function shouldRunGitRefresher(activeConfig: GlanceTpsConfig = getConfig()): boolean {
		return activeConfig.enabled && activeConfig.segments.some((segment) => segment.id === "git" && segment.enabled);
	}

	function isCurrentUiGeneration(generation: number): boolean {
		return generation === uiGeneration;
	}

	function setUiRequestRender(generation: number, callback: () => void): void {
		if (!isCurrentUiGeneration(generation)) return;
		requestRender = () => {
			if (isCurrentUiGeneration(generation)) callback();
		};
	}

	const refreshSession = new RuntimeRefreshSession({
		getConfig,
		ensureConfig,
		getThinkingLevel: () => adapters.getThinkingLevel(),
		nowMs: () => nowMs(),
		requestRender: () => requestRender?.(),
		scheduleGitRefresh,
	});

	function ensureGitRefresher(): RuntimeGitRefresher {
		gitRefresher ??= (adapters.createGitRefresher ?? createDefaultGitRefresher)({
			getConfig: () => getConfig().git,
			canFetch: () => canFetch(),
			getCwd: () => refreshSession.getState()?.workspace.path,
			onSnapshot: (cwd, snapshot) => {
				refreshSession.applyGitSnapshot(cwd, snapshot);
			},
		});
		return gitRefresher;
	}

	function scheduleGitRefresh(immediate = false): void {
		if (!shouldRunGitRefresher()) return;
		gitRefresher?.schedule(immediate);
	}

	function clearFooter(): void {
		footer?.dispose();
		footer = undefined;
	}

	function stopSpeedFrameTimer(): void {
		if (speedFrameTimer === undefined) return;
		clearInterval(speedFrameTimer);
		speedFrameTimer = undefined;
	}

	/** The speed segment only animates when the status line actually shows it. */
	function speedAnimationAllowed(): boolean {
		const activeConfig = config;
		return activeConfig !== undefined && activeConfig.enabled &&
			activeConfig.segments.some((segment) => segment.id === "throughput" && segment.enabled);
	}

	/** Spinner ticks exist only while an assistant message streams. */
	function ensureSpeedFrameTimer(): void {
		if (speedFrameTimer !== undefined || inputPaneOpen || waitingForUi) return;
		if (!refreshSession.isSpeedAnimating() || !speedAnimationAllowed()) return;
		speedFrameTimer = setInterval(() => {
			if (!refreshSession.advanceSpeedFrame()) {
				stopSpeedFrameTimer();
				return;
			}
			requestRender?.();
		}, SPEED_FRAME_INTERVAL_MS);
		speedFrameTimer.unref?.();
	}

	function invalidateUiOwnership(): number {
		activeEditor?.dispose();
		activeEditor = undefined;
		uiGeneration++;
		requestRender = undefined;
		extensionStatusProvider = undefined;
		clearFooter();
		return uiGeneration;
	}

	function clearGitRefresher(): void {
		gitRefresher?.dispose();
		gitRefresher = undefined;
	}

	function reconcileGitRefresher(immediate = false): void {
		if (!shouldRunGitRefresher()) {
			clearGitRefresher();
			return;
		}
		const refresher = ensureGitRefresher();
		if (immediate) refresher.schedule(true);
	}

	function restoreOwnedEditor(ctx: ExtensionContext, stillRendering = false): void {
		const ownedFactory = ownedEditorFactory;
		if (!ownedFactory) return;
		const restoreFactory = previousEditorFactory;
		ownedEditorFactory = undefined;
		previousEditorFactory = undefined;
		const current = ctx.ui.getEditorComponent();
		// Pi can report a wrapped factory after `setEditorComponent`, so an identity
		// mismatch alone must not skip restoration: that leaves no input line at all.
		// Restore when Pi still reports our factory, or when our editor was painted
		// recently, which proves Pi is still rendering it.
		if (current === ownedFactory || stillRendering) ctx.ui.setEditorComponent(restoreFactory);
	}

	function clearUI(ctx: ExtensionContext): void {
		if (!isTuiMode(ctx)) return;
		stopSpeedFrameTimer();
		const hadFooter = footer !== undefined;
		const editorWasRendering = activeEditor !== undefined && Date.now() - activeEditor.lastRenderedAt < 5_000;
		invalidateUiOwnership();
		clearGitRefresher();
		restoreOwnedEditor(ctx, editorWasRendering);
		if (hadFooter) ctx.ui.setFooter(undefined);
	}

	function installInputSurface(ctx: ExtensionContext): void {
		if (!isTuiMode(ctx)) return;
		const initialState = refreshSession.ensureState(ctx);
		const activeConfig = getConfig();
		if (!activeConfig.enabled) {
			clearUI(ctx);
			return;
		}

		const renderStyleContext = runtimeRenderStyleContext(ctx, getTrueColor);
		const generation = invalidateUiOwnership();

		reconcileGitRefresher(true);
		ctx.ui.setFooter((tui, _theme, footerData) => {
			const nextFooter = new GlanceTpsFooter(() => {
				if (isCurrentUiGeneration(generation) && footer === nextFooter) {
					extensionStatusProvider = undefined;
					footer = undefined;
				}
			});
			if (isCurrentUiGeneration(generation)) {
				extensionStatusProvider = footerData;
				setUiRequestRender(generation, () => tui.requestRender());
				footer = nextFooter;
			}
			return nextFooter;
		});

		const currentEditorFactory = ctx.ui.getEditorComponent();
		if (currentEditorFactory !== ownedEditorFactory) previousEditorFactory = currentEditorFactory;
		const nextEditorFactory: EditorFactory = (tui, theme, keybindings) => {
			if (isCurrentUiGeneration(generation)) activeEditor?.dispose();
			setUiRequestRender(generation, () => tui.requestRender());
			const editor: GlanceTpsEditor = new GlanceTpsEditor(
				tui,
				theme,
				keybindings,
				() => isCurrentUiGeneration(generation) ? refreshSession.ensureState(ctx) : initialState,
				() => getConfig(),
				{
					renderStyleContext, getExtensionStatuses, stash,
					animationNowMs: adapters.workingSweepNowMs,
					scheduleAnimationFrame: adapters.scheduleSweepFrame,
					ownsEditor: () => isCurrentUiGeneration(generation) && activeEditor === editor && ctx.ui.getEditorComponent() === nextEditorFactory,
					isActivityPaused: () => waitingForUi,
					onStashError: message => ctx.ui.notify(message, "warning"),
				},
			);
			if (isCurrentUiGeneration(generation)) activeEditor = editor;
			return editor;
		};
		ownedEditorFactory = nextEditorFactory;
		ctx.ui.setEditorComponent(nextEditorFactory);
	}

	async function handlePane(ctx: ExtensionCommandContext): Promise<void> {
		const current = await ensureConfig();
		notifyConfigDiagnostic(ctx);
		const previewState = refreshSession.ensureState(ctx);
		const generation = uiGeneration;
		const renderStyleContext = runtimeRenderStyleContext(ctx, getTrueColor);
		const result = await adapters.showPane(current, ctx, previewState, {
			renderStyleContext, getExtensionStatuses,
			getPreviewState: () => isCurrentUiGeneration(generation) ? refreshSession.ensureState(ctx) : previewState,
		});
		if (result.action === "cancel") {
			ctx.ui.notify("pi-glance-tps configuration cancelled", "info");
			return;
		}

		const previousConfig = current;
		const nextConfig = result.config;
		if (!configWritable) {
			ctx.ui.notify("pi-glance-tps configuration save blocked to protect the existing file; fix or remove it, then /reload", "error");
			return;
		}
		try {
			await adapters.saveConfig(nextConfig);
		} catch {
			ctx.ui.notify("pi-glance-tps configuration save failed; keeping previous configuration", "error");
			return;
		}

		config = nextConfig;
		configWritable = true;
		configDiagnostic = undefined;
		configDiagnosticStatus = "loaded";
		configDiagnosticNotified = false;
		if (previousConfig.enabled && nextConfig.enabled) {
			reconcileGitRefresher();
			activeEditor?.refreshActivity();
		}
		await refreshSession.configSaved(
			ctx,
			previousConfig.enabled === nextConfig.enabled ? undefined : () => installInputSurface(ctx),
		);
		ctx.ui.notify("pi-glance-tps configuration saved", "info");
	}

	return {
		commands: {
			openPane: async (_args, ctx) => {
				if (!isTuiMode(ctx)) {
					ctx.ui.notify("pi-glance-tps configuration pane requires TUI mode", "error");
					return;
				}
				// The pane owns the screen while it is open: pause the speed spinner so
				// its ticks cannot race the overlay redraw, then resume afterwards.
				inputPaneOpen = true;
				stopSpeedFrameTimer();
				try {
					await handlePane(ctx);
				} finally {
					inputPaneOpen = false;
					ensureSpeedFrameTimer();
				}
			},
		},
		events: {
			sessionStart: (_event, ctx) => {
				canFetch = () => configWritable && ctx.isProjectTrusted() && process.env.PI_OFFLINE !== "1";
				waitingForUi = false;
				stash = undefined;
				if (isTuiMode(ctx) && adapters.loadDraft && adapters.saveDraft) {
					const sessionId = ctx.sessionManager.getSessionId();
					const persistent = ctx.sessionManager.getSessionFile() !== undefined;
					try {
						stash = new PromptStash(persistent ? adapters.loadDraft(sessionId) : null, text => {
							if (persistent) adapters.saveDraft!(sessionId, text);
						});
					} catch {
						ctx.ui.notify("Could not read the saved draft. Stash is unavailable until /reload; the file was kept.", "warning");
					}
				}
				acceptConfigLoad(adapters.loadConfigSync());
				notifyConfigDiagnostic(ctx);
				refreshSession.sessionStart(ctx);
				installInputSurface(ctx);
			},
			sessionShutdown: async (_event, ctx) => {
				waitingForUi = false;
				stopSpeedFrameTimer();
				refreshSession.sessionShutdown();
				clearUI(ctx);
			},
			modelSelect: async (_event, ctx) => {
				await refreshSession.modelSelect(ctx);
			},
			thinkingLevelSelect: async (_event, ctx) => {
				await refreshSession.thinkingLevelSelect(ctx);
			},
			turnStart: async (_event, ctx) => {
				await refreshSession.turnStart(ctx);
			},
			toolExecutionEnd: async (_event, ctx) => {
				await refreshSession.toolExecutionEnd(ctx);
			},
			sessionTree: async (_event, ctx) => {
				await refreshSession.sessionTree(ctx);
			},
			sessionCompact: async (event, ctx) => {
				await refreshSession.sessionCompact(event, ctx);
			},
			providerRequest: (_event, _ctx) => {
				refreshSession.providerRequest();
			},
			uiPromptStart: (_event, _ctx) => {
				waitingForUi = true;
				stopSpeedFrameTimer();
				refreshSession.uiPromptStart();
				activeEditor?.refreshActivity();
			},
			uiPromptEnd: (_event, _ctx) => {
				waitingForUi = false;
				ensureSpeedFrameTimer();
				refreshSession.uiPromptEnd();
				activeEditor?.refreshActivity();
			},
			messageStart: (_event, _ctx) => {
				refreshSession.messageStart();
				if (!inputPaneOpen) ensureSpeedFrameTimer();
			},
			messageUpdate: (event, _ctx) => {
				// While the pane covers the editor, keep the bottom line still.
				if (inputPaneOpen) return;
				refreshSession.messageUpdate(event.message);
				ensureSpeedFrameTimer();
			},
			messageEnd: async (event, ctx) => {
				await refreshSession.messageEnd(event, ctx);
				if (!refreshSession.isSpeedAnimating()) stopSpeedFrameTimer();
			},
			turnEnd: async (event, ctx) => {
				await refreshSession.turnEnd(event, ctx);
			},
			agentStart: (_event, _ctx) => {
				stopSpeedFrameTimer();
				refreshSession.agentStart();
			},
			agentEnd: async (event, ctx) => {
				await refreshSession.agentEnd(event, ctx);
			},
			agentSettled: (_event, ctx) => {
				refreshSession.agentSettled(ctx);
			},
		},
	};
}
