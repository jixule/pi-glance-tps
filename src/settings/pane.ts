import {
	Input,
	Key,
	decodeKittyPrintable,
	matchesKey,
	parseKey,
	SelectList,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type Focusable,
	type Keybinding,
	type KeyId,
	type TUI,
} from "@earendil-works/pi-tui";
import type { ExtensionUIContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	createPaneModel,
	createPaneViewModel,
	updatePaneModel,
	type PaneIntent,
	type PaneModelState,
	type GlanceTpsPaneViewModel,
	type HelpShortcut,
} from "./model.js";
import { shortcutConflict } from "../input/keybinding.js";
import { normalizeStashShortcut, shortcutLabel } from "../input/shortcut.js";
import { SETTINGS_SECTIONS } from "./catalog.js";
import { ActivityClock, activityMotion, type ScheduleActivityFrame } from "../runtime/activity-animation.js";
import { ExtensionStatusCache, EXTENSION_STATUS_RESET } from "../surface/extension-statuses.js";
import { truncateStyledText } from "../surface/text.js";
import { createInputSurfaceRenderer } from "../surface/renderer.js";
import type { GlanceTpsRenderStyleContext } from "../theme/adapter.js";
import type { ExtensionStatusSource, GlanceTpsConfig, GlanceTpsState } from "../types.js";

type PaneResult = { action: "save"; config: GlanceTpsConfig } | { action: "cancel" };
export interface GlanceTpsPaneOptions {
	readonly getPreviewState?: () => GlanceTpsState;
	readonly getExtensionStatuses?: ExtensionStatusSource;
	readonly previewNowMs?: () => number;
	readonly schedulePreviewFrame?: ScheduleActivityFrame;
	readonly renderStyleContext?: GlanceTpsRenderStyleContext;
}

/** Reserve bounded content slots so changing pages does not move the preview in regular mode. */
const LIST_ROWS = 8;
const HINT_ROWS = 2;
const SHORTCUT_ROWS = 4;
function fitRows(lines: string[], count: number): string[] {
	return [...lines.slice(0, count), ...Array(Math.max(0, count - lines.length)).fill("")];
}

/** Keep settings reachable when preview, terminal height or palette names change. */
function viewport(total: number, selected: number, count: number): { start: number; end: number } {
	const start = Math.max(0, Math.min(total - count, selected - Math.floor(count / 2)));
	return { start, end: Math.min(total, start + count) };
}
function spread(left: string, right: string, width: number): string {
	const rightWidth = visibleWidth(right);
	if (rightWidth + 4 >= width) return truncateStyledText(`${left} ${right}`, width, "");
	const first = truncateStyledText(left, width - rightWidth - 2, "…");
	return first + " ".repeat(Math.max(1, width - visibleWidth(first) - rightWidth)) + right;
}

function wrapShortcuts(items: string[], width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const item of items) {
		if (line && visibleWidth(`${line}  ${item}`) > width) {
			lines.push(line);
			line = "";
		}
		line += (line ? "  " : "") + item;
	}
	if (line) lines.push(line);
	return lines;
}

export class GlanceTpsConfigPane implements Component, Focusable {
	private model: PaneModelState;
	private view: GlanceTpsPaneViewModel;
	private readonly renderSurface: ReturnType<typeof createInputSurfaceRenderer>;
	private readonly extensionStatuses = new ExtensionStatusCache();
	private previewVisible = true;
	private readonly clock: ActivityClock;
	private input = new Input();
	private replaceNumberOnType = false;
	private numberPasting = false;
	private shortcutPasting = false;
	private disposed = false;
	private hasFocus = false;
	private pageSize = 5;

	get focused(): boolean {
		return this.hasFocus;
	}
	set focused(value: boolean) {
		this.hasFocus = value;
		this.input.focused = value && this.model.page.kind === "number";
	}

	constructor(
		initial: GlanceTpsConfig,
		private readonly theme: Pick<Theme, "fg"> & Partial<Pick<Theme, "bg">>,
		private readonly done: (result: PaneResult) => void,
		private readonly requestRender: () => void,
		private readonly keybindings?: Pick<KeybindingsManager, "matches" | "getKeys"> & Partial<Pick<KeybindingsManager, "getEffectiveConfig">>,
		private readonly getTerminalRows: () => number | undefined = () => undefined,
		previewState?: GlanceTpsState,
		private readonly options: GlanceTpsPaneOptions = {},
	) {
		this.model = createPaneModel(initial);
		this.view = createPaneViewModel(this.model);
		this.renderSurface = createInputSurfaceRenderer(options.getPreviewState ?? previewState);
		this.clock = new ActivityClock({
			nowMs: options.previewNowMs,
			getMotion: () => activityMotion(this.model.draft, this.view.preview.activity === "idle" ? undefined : this.view.preview.activity),
			isPaused: () => this.disposed || !this.previewVisible,
			requestRender,
			schedule: options.schedulePreviewFrame,
		});
	}
	invalidate(): void {
		this.input.invalidate();
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clock.dispose();
	}
	private matches(data: string, action: Keybinding, fallback: KeyId): boolean {
		return this.keybindings ? this.keybindings.matches(data, action) : matchesKey(data, fallback);
	}
	private bindingLabel(action: Keybinding, fallback: string): string | undefined {
		const configured = this.keybindings?.getKeys?.(action);
		if (configured === undefined) return fallback;
		const key = configured.find((key) => key !== "ctrl+c"); // Ctrl-C always discards the entire pane.
		if (!key) return undefined;
		const labels: Record<string, string> = {
			ctrl: "Ctrl",
			shift: "Shift",
			alt: "Alt",
			super: "Super",
			enter: "Enter",
			escape: "Esc",
			tab: "Tab",
			up: "↑",
			down: "↓",
			left: "←",
			right: "→",
			space: "Space",
		};
		return key
			.split("+")
			.map((part) => labels[part] ?? (part.length === 1 ? part.toUpperCase() : part))
			.join("+");
	}
	private shortcut(item: HelpShortcut): string {
		let key: string | undefined = item.key;
		if (this.model.page.kind === "shortcut") key = item.key;
		else if (key === "Enter") key = this.bindingLabel("tui.select.confirm", "Enter");
		else if (key === "Esc") {
			key = this.bindingLabel("tui.select.cancel", "Esc");
			if (!key) return "[Ctrl+C] Discard & close";
		} else if (key === "↑↓") {
			const up = this.bindingLabel("tui.select.up", "↑"),
				down = this.bindingLabel("tui.select.down", "↓");
			key = up === "↑" && down === "↓" ? "↑↓" : [up, down].filter(Boolean).join("/");
		} else if (key === "Tab/Shift+Tab")
			key = [this.bindingLabel("tui.input.tab", "Tab"), "Shift+Tab"].filter(Boolean).join("/");
		return key ? `[${key}] ${item.label}` : "";
	}
	private editNumber(data: string): void {
		const startsPaste = data.includes("\x1b[200~");
		if (
			this.replaceNumberOnType &&
			(/^[\x20-\x7e]+$/.test(data) || decodeKittyPrintable(data) !== undefined || startsPaste)
		)
			this.input.setValue("");
		this.replaceNumberOnType = false;
		if (startsPaste) this.numberPasting = true;
		const pasteEnd = data.indexOf("\x1b[201~");
		const end = pasteEnd < 0 ? data.length : pasteEnd + 6;
		this.input.handleInput(data.slice(0, end));
		if (pasteEnd >= 0) this.numberPasting = false;
		this.dispatch({ type: "input", text: this.input.getValue() });
		if (end < data.length) this.handleInput(data.slice(end));
	}
	private dispatch(intent: PaneIntent): void {
		const wasNumber = this.model.page.kind === "number";
		const statusCount = intent.type === "move" && this.view.extensionStatusIndex !== undefined
			? this.extensionStatuses.read(this.options.getExtensionStatuses?.()).length : 0;
		const result = updatePaneModel(this.model, intent, statusCount);
		this.model = result.model;
		this.view = createPaneViewModel(this.model);
		if (result.completion) {
			this.dispose();
			this.done(result.completion);
			return;
		}
		if (this.model.page.kind === "number" && !wasNumber) {
			this.input = new Input();
			this.input.handleInput(`\x1b[200~${this.model.page.text}\x1b[201~`);
			this.replaceNumberOnType = true;
			this.numberPasting = false;
		}
		this.input.focused = this.hasFocus && this.model.page.kind === "number";
		this.clock.sync();
		this.requestRender();
	}
	handleInput(data: string): void {
		if (this.disposed) return;
		// Paste payload is text, even when delivered in chunks containing command keys.
		if (this.model.page.kind === "number" && (this.numberPasting || data.includes("\x1b[200~"))) {
			this.editNumber(data);
			return;
		}
		if (this.model.page.kind === "shortcut" && (this.shortcutPasting || data.includes("\x1b[200~"))) {
			this.shortcutPasting = true;
			const end = data.indexOf("\x1b[201~");
			this.dispatch({ type: "shortcut", error: "请按下快捷键；粘贴的文本无法绑定。" });
			if (end >= 0) {
				this.shortcutPasting = false;
				if (end + 6 < data.length) this.handleInput(data.slice(end + 6));
			}
			return;
		}
		if (matchesKey(data, Key.ctrl("c"))) {
			this.dispatch({ type: "cancel" });
			return;
		}
		if (this.model.page.kind === "shortcut") {
			if (matchesKey(data, "escape")) this.dispatch({ type: "back" });
			else if (matchesKey(data, "enter")) this.dispatch({ type: "activate" });
			else {
				const key = normalizeStashShortcut(parseKey(data));
				const getEffectiveConfig = this.keybindings?.getEffectiveConfig;
				const conflict = key && getEffectiveConfig ? shortcutConflict(data, key, { getEffectiveConfig: () => getEffectiveConfig.call(this.keybindings) }) : undefined;
				this.dispatch({ type: "shortcut", key, error: conflict ? `已被 Pi 占用：${conflict}。请换一个快捷键。` : undefined });
			}
			return;
		}
		if (this.matches(data, "tui.select.cancel", Key.escape)) {
			this.dispatch({ type: "back" });
			return;
		}
		if (this.matches(data, "tui.select.confirm", Key.enter)) {
			this.dispatch({ type: "activate" });
			return;
		}
		// Text entry owns letters and arrows; S/R/Q must not save/reset/close it.
		if (this.model.page.kind === "number") {
			this.editNumber(data);
			return;
		}
		if (this.matches(data, "tui.select.up", Key.up)) this.dispatch({ type: "move", direction: "up" });
		else if (this.matches(data, "tui.select.down", Key.down)) this.dispatch({ type: "move", direction: "down" });
		else if (this.matches(data, "tui.select.pageUp", Key.pageUp))
			this.dispatch({ type: "move", direction: "up", amount: this.pageSize });
		else if (this.matches(data, "tui.select.pageDown", Key.pageDown))
			this.dispatch({ type: "move", direction: "down", amount: this.pageSize });
		else if (this.matches(data, "tui.input.tab", Key.tab)) this.dispatch({ type: "section", direction: 1 });
		else if (matchesKey(data, Key.shift("tab"))) this.dispatch({ type: "section", direction: -1 });
		else if (matchesKey(data, Key.left)) this.dispatch({ type: "adjust", direction: -1 });
		else if (matchesKey(data, Key.right)) this.dispatch({ type: "adjust", direction: 1 });
		else if (matchesKey(data, Key.space)) this.dispatch({ type: "toggle" });
		else if (/^[sS]$/.test(data)) this.dispatch({ type: "save" });
		else if (/^[rR]$/.test(data)) this.dispatch({ type: "reset" });
		else if (/^[qQ]$/.test(data)) this.dispatch({ type: "back" });
		else if (/^[pP]$/.test(data)) this.dispatch({ type: "previewActivity" });
		else if (/^[dD]$/.test(data)) this.dispatch({ type: "density" });
		else if (/^[jJ]$/.test(data)) this.dispatch({ type: "reorder", direction: 1 });
		else if (/^[kK]$/.test(data)) this.dispatch({ type: "reorder", direction: -1 });
	}

	private fg(tone: "accent" | "muted" | "dim" | "warning" | "success", text: string): string {
		return this.theme.fg(tone, text);
	}
	private renderPreview(view: GlanceTpsPaneViewModel, width: number, extensionStatuses: ReadonlyMap<string, string> | undefined): string[] {
		const config = view.preview.config;
		const scene = view.preview.activity;
		const cancelKey = this.keybindings?.getKeys?.("app.interrupt")?.[0] ?? "escape";
		const cancel = cancelKey === "escape" ? "esc" : cancelKey;
		const labels = { working: "工作中", compaction: "压缩上下文中", branchSummary: "生成分支摘要中", retry: "重试中", idle: "空闲（有草稿）" };
		const messages = {
			working: "◌ 工作中…", compaction: `◌ 压缩上下文中…（${cancel} 取消）`,
			branchSummary: `◌ 生成分支摘要中…（${cancel} 取消）`, retry: `◌ 正在重试（2/3），8 秒后…（${cancel} 取消）`,
		};
		const options = {
			...this.options.renderStyleContext,
			...(view.preview.ambientTone ? { ambientTone: view.preview.ambientTone } : {}),
			...(view.preview.density === "auto" ? {} : { previewDensity: view.preview.density }),
			extensionStatuses,
			activity: scene && scene !== "idle" ? { kind: scene, render: () => messages[scene] } : undefined,
			animation: this.clock.frame(),
			hasDraft: scene !== undefined,
			contentLines: ["输入下一条指令…"],
			focused: true,
		};
		const preview = this.renderSurface(config, width, options);
		if (!config.enabled)
			return fitRows(["预览 · GlanceTps 已关闭", "开启 GlanceTps 后可预览输入框。"]
				.map(text => this.fg("dim", truncateStyledText(text, width))), preview.length + 1);
		const densityLabels = { auto: "自动", full: "完整", compact: "紧凑", minimal: "极简" } as const;
		const densityLabel = densityLabels[view.preview.density];
		const motion = activityMotion(config, scene === "idle" ? undefined : scene);
		const rate = motion ? motion.kind === "sweep" ? ` · ${Number(motion.rate.toFixed(2))} 列/秒` : ` · ${motion.rate.toFixed(2)} Hz` : "";
		const label = scene
			? `预览 · 示例 · ${config.editor.activityMode === "text" ? "Text" : "Sweep"} · ${labels[scene]}${rate}`
			: view.section === "status" ? `预览 · ${densityLabel}` : "预览";
		return [this.fg("dim", truncateStyledText(label, width)), ...preview];
	}
	private renderRow(row: GlanceTpsPaneViewModel["rows"][number], width: number): string {
		const mark = row.selected ? "› " : "  ";
		const value =
			row.kind === "number"
				? `‹ ${row.value} ›`
				: row.value + (row.kind === "theme" || row.kind === "choice" || row.kind === "segment" || row.kind === "shortcut" ? "  ›" : "");
		const left = mark + row.label + (row.changed ? " *" : "");
		const tone = row.selected ? "accent" : row.inactive || row.value === "关" ? "dim" : "muted";
		const rendered = this.fg(tone, spread(left, value, width));
		return row.selected ? (this.theme.bg?.("selectedBg", rendered) ?? rendered) : rendered;
	}
	render(availableWidth: number): string[] {
		const previewWidth = Math.max(0, Math.floor(availableWidth));
		const width = Math.min(100, previewWidth);
		const indent = " ".repeat(Math.floor((previewWidth - width) / 2));
		const settingsLine = (line: string) => indent + truncateStyledText(line, width);
		const terminalRows = this.getTerminalRows();
		const height = Math.max(1, Number.isFinite(terminalRows) ? Math.floor(terminalRows!) - 2 : 30);
		const view = this.view;
		const sectionIndex = SETTINGS_SECTIONS.findIndex((section) => section.id === view.section);
		const tabs =
			width >= 64
				? SETTINGS_SECTIONS.map((section) =>
						section.id === view.section
							? this.fg("accent", `[ ${section.label} ]`)
							: this.fg("muted", `  ${section.label}  `),
					).join(" ")
				: this.fg("accent", `${SETTINGS_SECTIONS[sectionIndex]!.label} (${sectionIndex + 1}/${SETTINGS_SECTIONS.length})`);
		const header = [
			spread(
				this.fg("accent", "◌ GlanceTps"),
				this.fg(view.dirty ? "warning" : "dim", view.dirty ? "未保存的修改" : "无修改"),
				width,
			),
			tabs,
		];
		const help = view.help.map((item) => this.shortcut(item)).filter(Boolean);
		const footer = wrapShortcuts(help, Math.max(1, width))
			.slice(0, 2)
			.map((line) => this.fg("dim", line));
		const actions = view.actions.map((item) => this.shortcut(item)).filter(Boolean);
		footer.push(
			...wrapShortcuts(actions, Math.max(1, width))
				.slice(0, 2)
				.map((line) => this.fg("accent", line)),
		);
		const hint = wrapTextWithAnsi(
			this.fg(this.model.page.kind === "number" && this.model.page.error || this.model.page.kind === "shortcut" && this.model.page.error ? "warning" : "dim", view.hint),
			Math.max(1, width),
		).slice(0, HINT_ROWS);
		const statusSource = this.options.getExtensionStatuses?.();
		let preview = this.renderPreview(view, previewWidth, statusSource);
		const title = this.fg("muted", view.title);
		const base = header.length + 1 + 1 + HINT_ROWS + SHORTCUT_ROWS;
		const details = view.extensionStatusIndex === undefined ? undefined : this.extensionStatuses.read(statusSource);
		const showPreview = height - base - preview.length >= 4;
		if (showPreview !== this.previewVisible) {
			this.previewVisible = showPreview;
			this.clock.sync();
			if (showPreview) preview = this.renderPreview(view, previewWidth, statusSource);
		}
		const prefix = [...header, title];
		if (!showPreview) preview = [];
		const budget = Math.max(1, Math.min(LIST_ROWS + 1, height - base - preview.length));
		const body: string[] = [];
		if (details) {
			if (details.length === 0) body.push(this.fg("dim", statusSource === undefined
				? "扩展状态数据源未连接。" : "暂无扩展发布的状态。"));
			const count = Math.max(1, Math.min(LIST_ROWS, budget - (details.length > budget ? 1 : 0)));
			this.pageSize = count;
			const selected = Math.min(view.extensionStatusIndex!, Math.max(0, details.length - 1));
			const { start, end } = viewport(details.length, selected, count);
			for (const [index, entry] of details.slice(start, end).entries()) {
				const label = `${start + index === selected ? "› " : "  "}${entry.key}: `;
				body.push(this.fg("muted", label) + entry.text + EXTENSION_STATUS_RESET);
			}
			if (start > 0 || end < details.length) body.push(this.fg("dim", `${start + 1}–${end} of ${details.length}`));
		} else if (view.page === "shortcut" && this.model.page.kind === "shortcut") {
			body.push(this.fg("accent", shortcutLabel(this.model.page.key)));
		} else if (view.page === "number") {
			body.push(...this.input.render(Math.max(1, width)));
		} else if (view.page !== "list") {
			this.pageSize = Math.max(1, Math.min(LIST_ROWS, budget - 1));
			const list = new SelectList(
				view.choices.map((choice, index) => ({
					value: String(index),
					label: `${choice.checked ? "✓ " : "  "}${choice.label}`,
				})),
				this.pageSize,
				{
					selectedPrefix: (text) => this.fg("accent", text),
					selectedText: (text) => this.fg("accent", text),
					description: (text) => this.fg("dim", text),
					scrollInfo: (text) => this.fg("dim", text),
					noMatch: (text) => this.fg("warning", text),
				},
			);
			list.setSelectedIndex(
				Math.max(
					0,
					view.choices.findIndex((choice) => choice.selected),
				),
			);
			body.push(...list.render(Math.max(1, width)));
		} else {
			const count = Math.max(1, Math.min(LIST_ROWS, budget - (view.rows.length > budget ? 1 : 0)));
			this.pageSize = count;
			const selected = Math.max(
				0,
				view.rows.findIndex((row) => row.selected),
			);
			const { start, end } = viewport(view.rows.length, selected, count);
			body.push(...view.rows.slice(start, end).map((row) => this.renderRow(row, width)));
			if (start > 0 || end < view.rows.length)
				body.push(
					this.fg(
						"dim",
						`${start + 1}–${end} of ${view.rows.length} · ${this.shortcut({ key: "↑↓", label: "Scroll" })}`,
					),
				);
		}
		let lines = [...prefix, ...fitRows(body, budget), "", ...fitRows(hint, HINT_ROWS), ...fitRows(footer, SHORTCUT_ROWS)];
		// At tiny heights keep the selected setting and an exit hint, not a clipped header.
		if (lines.length + preview.length > height) {
			const selected = view.rows.find((row) => row.selected);
			const confirm = view.help.find((item) => item.key === "Enter") ?? view.actions[0]!;
			const cancel = view.actions.find((item) => item.key === "Esc")!;
			lines = [
				view.page === "list" && selected ? this.renderRow(selected, width) : (body[0] ?? title),
				this.fg("dim", `${this.shortcut(confirm)}  ${this.shortcut(cancel)}`),
			].slice(0, height);
		}
		// Only controls are width-bounded. The preview stays full-width at Pi's input-area bottom.
		return [...lines.map(settingsLine), ...preview];
	}
}

interface GlanceTpsPaneUI {
	custom<T>(
		factory: (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: T) => void) => Component,
		options?: Parameters<ExtensionUIContext["custom"]>[1],
	): Promise<T>;
}
export async function showGlanceTpsPane(
	initial: GlanceTpsConfig,
	ctx: { ui: GlanceTpsPaneUI },
	previewState?: GlanceTpsState,
	options: GlanceTpsPaneOptions = {},
): Promise<PaneResult> {
	let pane: GlanceTpsConfigPane | undefined;
	try {
		return await ctx.ui.custom<PaneResult>((tui, theme, keybindings, done) => {
			pane = new GlanceTpsConfigPane(
				initial,
				theme,
				done,
				() => tui.requestRender(),
				keybindings,
				() => tui.terminal?.rows,
				previewState,
				options,
			);
			return pane;
		}, {
			overlay: true,
			overlayOptions: { width: "100%", anchor: "bottom-left", margin: { bottom: 0 } },
		});
	} finally {
		pane?.dispose();
	}
}
