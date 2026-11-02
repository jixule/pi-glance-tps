import type { LiveSpeedReading } from "../types.js";

/** Spinner frames cycled while an assistant message streams. */
export const SPEED_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** How often the spinner advances; the runtime owns the actual timer. */
export const SPEED_FRAME_INTERVAL_MS = 80;

/** Minimum sampling gap before the instantaneous rate is recomputed. */
const SAMPLE_WINDOW_MS = 250;

/** Exponential moving average weight for a new rate sample. */
const SMOOTHING_FACTOR = 0.3;

/** Below this many streamed tokens the rate is shown as unknown. */
const MIN_TOKENS_FOR_RATE = 10;

/** Same heuristic Pi uses for assistant message estimates. */
const CHARACTERS_PER_TOKEN = 4;

interface ContentBlockLike {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
	name?: unknown;
	arguments?: unknown;
}

function messageContent(message: unknown): unknown {
	return typeof message === "object" && message !== null ? (message as { content?: unknown }).content : undefined;
}

function asContentBlocks(message: unknown): ContentBlockLike[] {
	const content = messageContent(message);
	return Array.isArray(content) ? (content as ContentBlockLike[]) : [];
}

/**
 * Content characters in a streamed assistant message: text, thinking, and tool
 * call names plus serialized arguments. Providers report final usage only in
 * the last chunk, so this estimate is what keeps the live rate moving.
 */
export function charactersFromMessage(message: unknown): number {
	let characters = 0;
	for (const block of asContentBlocks(message)) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "text" && typeof block.text === "string") {
			characters += block.text.length;
		} else if (block.type === "thinking" && typeof block.thinking === "string") {
			characters += block.thinking.length;
		} else if (block.type === "toolCall") {
			characters += typeof block.name === "string" ? block.name.length : 0;
			try {
				characters += JSON.stringify(block.arguments ?? {}).length;
			} catch {
				// Circular or non-serializable arguments contribute nothing.
			}
		}
	}
	return characters;
}

export function estimatedTokensFromCharacters(characters: number): number {
	return Math.ceil(characters / CHARACTERS_PER_TOKEN);
}

/**
 * Live streaming speed for the status line.
 *
 * The clock starts on the first update that carries content, never when the
 * stream opens, so prefill/TTFT wait time stays out of the rate. The rate uses
 * content-estimate deltas over ≥250 ms windows, smoothed with an EMA, because
 * provider usage usually lands in one final chunk and would otherwise spike.
 * `finish` switches to the provider-accurate generation-window average.
 */
export class LiveSpeedTracker {
	private generating = false;
	private generationStartedAtMs = 0;
	private previousSampleAtMs = 0;
	private previousTokens = 0;
	private liveTokens = 0;
	private smoothedRate = 0;
	private finalRate = 0;
	private spinnerIndex = 0;

	start(): void {
		this.generating = true;
		this.generationStartedAtMs = 0;
		this.previousSampleAtMs = 0;
		this.previousTokens = 0;
		this.liveTokens = 0;
		this.smoothedRate = 0;
		this.finalRate = 0;
		this.spinnerIndex = 0;
	}

	/** Feed the current content size; returns true when the reading changed. */
	observe(characters: number, nowMs: number): boolean {
		if (!this.generating) return false;
		const tokens = estimatedTokensFromCharacters(characters);
		if (tokens === 0) return false;
		this.liveTokens = tokens;
		// The generation window opens with the first content, excluding prefill.
		if (this.generationStartedAtMs === 0) this.generationStartedAtMs = nowMs;
		if (this.previousSampleAtMs === 0) {
			this.previousSampleAtMs = nowMs;
			this.previousTokens = tokens;
			return true;
		}
		const elapsedMs = nowMs - this.previousSampleAtMs;
		if (elapsedMs < SAMPLE_WINDOW_MS) return false;
		const tokenDelta = tokens - this.previousTokens;
		if (tokenDelta > 0) {
			const instantRate = tokenDelta / (elapsedMs / 1000);
			this.smoothedRate = this.smoothedRate === 0
				? instantRate
				: this.smoothedRate * (1 - SMOOTHING_FACTOR) + instantRate * SMOOTHING_FACTOR;
		}
		this.previousSampleAtMs = nowMs;
		this.previousTokens = tokens;
		return true;
	}

	/** Advance the spinner; returns true while a frame change is meaningful. */
	advanceFrame(): boolean {
		if (!this.generating) return false;
		this.spinnerIndex = (this.spinnerIndex + 1) % SPEED_SPINNER_FRAMES.length;
		return true;
	}

	/**
	 * Close the generation window and publish the final average over the time
	 * that actually produced tokens. Returns null when no valid window exists,
	 * leaving the status line to the request-level throughput fallback.
	 */
	finish(outputTokens: number, characters: number, nowMs: number): LiveSpeedReading | null {
		if (!this.generating) return null;
		this.generating = false;
		const elapsedSeconds = this.generationStartedAtMs > 0 ? (nowMs - this.generationStartedAtMs) / 1000 : 0;
		const totalTokens = Math.max(outputTokens, estimatedTokensFromCharacters(characters));
		if (elapsedSeconds > 0 && totalTokens > 0) this.finalRate = totalTokens / elapsedSeconds;
		return this.reading();
	}

	reset(): void {
		this.generating = false;
		this.generationStartedAtMs = 0;
		this.previousSampleAtMs = 0;
		this.previousTokens = 0;
		this.liveTokens = 0;
		this.smoothedRate = 0;
		this.finalRate = 0;
		this.spinnerIndex = 0;
	}

	isGenerating(): boolean {
		return this.generating;
	}

	/** Current readable state, or null when nothing should be shown. */
	reading(): LiveSpeedReading | null {
		const spinnerFrame = SPEED_SPINNER_FRAMES[this.spinnerIndex] ?? SPEED_SPINNER_FRAMES[0]!;
		if (this.generating) {
			const rate = this.liveTokens >= MIN_TOKENS_FOR_RATE ? this.smoothedRate : 0;
			return { tokensPerSecond: rate, generating: true, spinnerFrame };
		}
		if (this.finalRate <= 0) return null;
		return { tokensPerSecond: this.finalRate, generating: false, spinnerFrame };
	}
}
