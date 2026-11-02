import { displayDirectory, shortenModel } from "../surface/format.js";
import { emptyGitSnapshot, gitSnapshotsEqual } from "./git-snapshot.js";
import type { StateInputs } from "./snapshot.js";
import type { GitSnapshot, GlanceTpsConfig, GlanceTpsState, LiveSpeedReading, ModelSpeedMeasurement, UsageTotals } from "../types.js";

export function createInitialState(inputs: StateInputs, config: GlanceTpsConfig): GlanceTpsState {
	const state: GlanceTpsState = {
		workspace: {
			name: displayDirectory(inputs.cwd),
			path: inputs.cwd,
		},
		git: emptyGitSnapshot(),
		providers: {
			availableCount: inputs.availableProviderCount,
		},
		model: {
			id: inputs.model?.id,
			provider: inputs.model?.provider,
			displayName: shortenModel(inputs.model?.id, config.model.customNames, inputs.model?.name),
			thinking: inputs.thinkingLevel,
		},
		context: {
			tokens: null,
			window: inputs.model?.contextWindow ?? 0,
			percent: null,
		},
		usage: inputs.usage,
		throughput: {
			lastRun: null,
			currentRun: null,
		},
		liveSpeed: null,
		version: 0,
	};
	refreshContextUsage(state, inputs);
	return state;
}

function touch(state: GlanceTpsState): void {
	state.version++;
}

function usageTotalsEqual(a: UsageTotals, b: UsageTotals): boolean {
	return a.input === b.input && a.output === b.output && a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite && a.cost === b.cost;
}

function modelSpeedEqual(a: ModelSpeedMeasurement | null, b: ModelSpeedMeasurement | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.outputTokens === b.outputTokens &&
		a.elapsedMs === b.elapsedMs &&
		a.tokensPerSecond === b.tokensPerSecond
	);
}

export function setLastRunModelSpeed(state: GlanceTpsState, next: ModelSpeedMeasurement | null): boolean {
	if (modelSpeedEqual(state.throughput.lastRun, next)) return false;
	state.throughput.lastRun = next;
	touch(state);
	return true;
}

export function setCurrentRunModelSpeed(state: GlanceTpsState, next: ModelSpeedMeasurement | null): boolean {
	if (modelSpeedEqual(state.throughput.currentRun, next)) return false;
	state.throughput.currentRun = next;
	touch(state);
	return true;
}

export function clearCurrentRunModelSpeed(state: GlanceTpsState): boolean {
	return setCurrentRunModelSpeed(state, null);
}

function liveSpeedEqual(a: LiveSpeedReading | null, b: LiveSpeedReading | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.tokensPerSecond === b.tokensPerSecond &&
		a.generating === b.generating &&
		a.spinnerFrame === b.spinnerFrame
	);
}

export function setLiveSpeed(state: GlanceTpsState, next: LiveSpeedReading | null): boolean {
	if (liveSpeedEqual(state.liveSpeed, next)) return false;
	state.liveSpeed = next;
	touch(state);
	return true;
}

export function setUsageTotals(state: GlanceTpsState, usage: UsageTotals): boolean {
	if (usageTotalsEqual(state.usage, usage)) return false;
	state.usage = usage;
	touch(state);
	return true;
}

export function addUsageTotals(state: GlanceTpsState, delta: UsageTotals): boolean {
	if (delta.input === 0 && delta.output === 0 && delta.cacheRead === 0 && delta.cacheWrite === 0 && delta.cost === 0) return false;
	state.usage = {
		input: state.usage.input + delta.input,
		output: state.usage.output + delta.output,
		cacheRead: state.usage.cacheRead + delta.cacheRead,
		cacheWrite: state.usage.cacheWrite + delta.cacheWrite,
		cost: state.usage.cost + delta.cost,
	};
	touch(state);
	return true;
}

export function setProviderCount(state: GlanceTpsState, availableCount: number): boolean {
	if (state.providers.availableCount === availableCount) return false;
	state.providers.availableCount = availableCount;
	touch(state);
	return true;
}

export function refreshWorkspace(state: GlanceTpsState, inputs: Pick<StateInputs, "cwd">): boolean {
	const cwd = inputs.cwd;
	if (state.workspace.path === cwd) return false;
	state.workspace = {
		name: displayDirectory(cwd),
		path: cwd,
	};
	state.git = emptyGitSnapshot();
	touch(state);
	return true;
}

export function setGitSnapshot(state: GlanceTpsState, cwd: string, snapshot: GitSnapshot): boolean {
	if (state.workspace.path !== cwd) return false;
	if (gitSnapshotsEqual(state.git, snapshot)) {
		state.git.updatedAt = snapshot.updatedAt;
		return false;
	}
	state.git = snapshot;
	touch(state);
	return true;
}

export function refreshContextUsage(state: GlanceTpsState, inputs: Pick<StateInputs, "contextUsage" | "model">): boolean {
	const usage = inputs.contextUsage;
	const tokens = usage?.tokens ?? null;
	const window = usage?.contextWindow ?? inputs.model?.contextWindow ?? 0;
	const percent = usage?.percent ?? null;
	if (state.context.tokens === tokens && state.context.window === window && state.context.percent === percent) return false;
	state.context.tokens = tokens;
	state.context.window = window;
	state.context.percent = percent;
	touch(state);
	return true;
}

export function refreshModel(state: GlanceTpsState, inputs: Pick<StateInputs, "model" | "thinkingLevel">, config: GlanceTpsConfig): boolean {
	const id = inputs.model?.id;
	const provider = inputs.model?.provider;
	const displayName = shortenModel(inputs.model?.id, config.model.customNames, inputs.model?.name);
	// Selection metadata does not own Context: virtual and physical limits can differ.
	if (
		state.model.id === id &&
		state.model.provider === provider &&
		state.model.displayName === displayName &&
		state.model.thinking === inputs.thinkingLevel
	) {
		return false;
	}
	state.model.id = id;
	state.model.provider = provider;
	state.model.displayName = displayName;
	state.model.thinking = inputs.thinkingLevel;
	touch(state);
	return true;
}
