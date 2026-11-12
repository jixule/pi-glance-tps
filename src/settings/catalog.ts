import { shortcutLabel } from "../input/shortcut.js";
import { cloneConfig } from "../config/model.js";
import { RETRY_BLINK, SUMMARY_SPEED, WORKING_SPEED, type NumericSettingSpec } from "../config/schema.js";
import { choiceSetting, toggleSetting, type SettingDescriptor, type SettingOption } from "../config/settings.js";
import { getSegmentSettings, segmentLabel } from "../segments/registry.js";
import { TACH_THEMES } from "../theme/themes.js";
import type { GlanceTpsThemeSlot } from "../theme/selection.js";
import type { GlanceTpsConfig, GlanceTpsThemeName, SegmentId } from "../types.js";

export type { GlanceTpsThemeSlot } from "../theme/selection.js";
export type SettingsSectionId = "appearance" | "status" | "working" | "input";
export const SETTINGS_SECTIONS = [
	{ id: "appearance", label: "外观" },
	{ id: "status", label: "状态栏" },
	{ id: "working", label: "活动状态" },
	{ id: "input", label: "输入" },
] as const;

interface RowBase {
	id: string;
	label: string;
	value: string;
	hint: string;
	inactive?: boolean;
}
export type SettingsRow = RowBase &
	(
		| {
				kind: "toggle" | "choice";
				selectedIndex: number;
				options: readonly SettingOption[];
				select(config: GlanceTpsConfig, index: number): GlanceTpsConfig;
		  }
		| { kind: "shortcut"; key: string }
		| { kind: "theme"; slot: GlanceTpsThemeSlot }
		| {
				kind: "number";
				number: number;
				min: number;
				max: number;
				step: number;
				precision: number;
				inputHint: string;
				setValue(config: GlanceTpsConfig, value: number): GlanceTpsConfig;
		  }
		| { kind: "segment"; segment: SegmentId; enabled: boolean }
	);

function descriptorRow(config: GlanceTpsConfig, descriptor: SettingDescriptor): SettingsRow {
	return {
		id: descriptor.id,
		label: descriptor.label,
		value: descriptor.value(config),
		hint: descriptor.hint,
		kind: descriptor.kind,
		selectedIndex: descriptor.selectedIndex(config),
		options: descriptor.options,
		select: (config, index) => {
			const next = cloneConfig(config);
			descriptor.select(next, index);
			return next;
		},
	};
}

const themeCatalogs = {
	light: Object.freeze([
		...TACH_THEMES.filter((theme) => theme.tone === "light"),
		...TACH_THEMES.filter((theme) => theme.tone === "dark"),
	]),
	dark: Object.freeze([
		...TACH_THEMES.filter((theme) => theme.tone === "dark"),
		...TACH_THEMES.filter((theme) => theme.tone === "light"),
	]),
};

export function getThemeCatalogForSlot(slot: GlanceTpsThemeSlot) {
	return themeCatalogs[slot];
}

export function getThemeLabel(id: GlanceTpsThemeName): string {
	return TACH_THEMES.find((theme) => theme.id === id)?.label ?? id;
}

const appearance = [
	toggleSetting(
		"appearance.enabled",
		"GlanceTps",
		"使用 GlanceTps 的输入框边框与状态栏。",
		(c) => c.enabled,
		(c, v) => {
			c.enabled = v;
		},
	),
	choiceSetting(
		"appearance.icons",
		"图标",
		"Nerd Font 需要兼容字体；图标显示异常时请选择 Plain，选择不显示则只保留文字。",
		[
			{ value: "nerd", label: "Nerd Font" },
			{ value: "plain", label: "Plain" },
			{ value: "none", label: "不显示" },
		],
		(c) => c.icons,
		(c, v) => {
			c.icons = v;
		},
	),
	choiceSetting(
		"appearance.workspace",
		"工作区标签",
		"选择显示在输入框顶边的名称。",
		[
			{ value: "name", label: "文件夹名" },
			{ value: "smart", label: "智能路径", hint: "按可用宽度自动缩短路径。" },
			{ value: "path", label: "完整路径", hint: "尽可能显示更长的路径。" },
		],
		(c) => c.display.workspaceLabel,
		(c, v) => {
			c.display.workspaceLabel = v;
		},
	),
];

const inputSettings = [
	choiceSetting(
		"input.rows",
		"编辑框高度",
		"输入框的最小行数，输入时会自动增长。",
		[2, 3, 4].map((value) => ({ value, label: `${value} 行` })),
		(c) => c.editor.minContentRows,
		(c, v) => {
			c.editor.minContentRows = v;
		},
	),
	choiceSetting(
		"input.spacing",
		"编辑框上方留白",
		"对话与输入框之间的空行数。",
		[
			{ value: 0, label: "无" },
			{ value: 1, label: "1 行" },
			{ value: 2, label: "2 行" },
		],
		(c) => c.editor.topMarginRows,
		(c, v) => {
			c.editor.topMarginRows = v;
		},
	),
	toggleSetting("input.stash", "提示词暂存", "提出下一个问题前暂存草稿，再次按快捷键可恢复或交换。",
		c => c.editor.stashEnabled, (c, value) => { c.editor.stashEnabled = value; }),
];

const activityDisplay = choiceSetting(
	"activity.mode", "显示方式", "Text 在底边显示原生活动文字，Sweep 使用状态驱动的边框动效。",
	[{ value: "text", label: "Text" }, { value: "sweep", label: "Sweep" }] as const,
	c => c.editor.activityMode, (c, value) => { c.editor.activityMode = value; },
);

const animation = choiceSetting(
	"working.mode",
	"动效范围",
	"扫光移动的位置，以及重试时闪烁的边框。",
	[
		{ value: "perimeter", label: "整圈边框", hint: "沿输入框顺时针移动。" },
		{ value: "top", label: "顶边", hint: "在工作区标题与连接线上扫过。" },
	],
	(c) => c.editor.workingSweep,
	(c, v) => {
		c.editor.workingSweep = v;
	},
);

const sweepColor = choiceSetting(
	"working.color",
	"动效颜色",
	"扫光与重试闪烁的强调色，与主题匹配；文字模式的颜色不变。",
	[
		{ value: "theme", label: "跟随主题" },
		{ value: "amber", label: "琥珀" },
		{ value: "rose", label: "玫瑰" },
		{ value: "violet", label: "紫罗兰" },
		{ value: "blue", label: "蓝色" },
		{ value: "teal", label: "青色" },
		{ value: "mint", label: "薄荷" },
		{ value: "coral", label: "珊瑚" },
		{ value: "copper", label: "铜色" },
	],
	c => c.editor.workingSweepColor,
	(c, value) => { c.editor.workingSweepColor = value; },
);

function activityNumber(config: GlanceTpsConfig, id: string, label: string,
	field: "workingSweepSpeed" | "summarySpeedMultiplier" | "retryBlinkHz", spec: NumericSettingSpec,
	value: string, unit: string, hint: string): SettingsRow {
	return {
		id, label, value, hint, kind: "number", number: config.editor[field],
		min: spec.min, max: spec.max, step: spec.step, precision: spec.precision,
		inputHint: `请输入 ${spec.min} 到 ${spec.max} ${unit} 之间的${spec.precision ? `数字（最多 ${spec.precision} 位小数）` : "整数"}，默认：${spec.defaultValue}。`,
		setValue: (config, value) => {
			const next = cloneConfig(config); next.editor[field] = spec.normalize(value); return next;
		},
	};
}

const segmentHints: Record<SegmentId, string> = {
	git: "分支、未提交变更与上游提交。",
	cost: "本次会话费用（美元），以紧凑金额显示。",
	throughput: "模型输出速度（tokens/秒），生成中实时更新。",
	context: "当前上下文用量与可用容量。",
	tokens: "本次会话的 token 数与提示词缓存使用量。",
	extensions: "其他 Pi 扩展发布的状态。为空时隐藏，并让位于内置信息。",
	model: "模型名称、提供商与思考级别；始终最后被移除。",
};

export function getSettingsRows(config: GlanceTpsConfig, section: SettingsSectionId, segment?: SegmentId): SettingsRow[] {
	if (section === "status") {
		if (segment) return getSegmentSettings(segment).map((descriptor) => descriptorRow(config, descriptor));
		return config.segments.map(({ id, enabled }) => ({
			id: `status.${id}`,
			label: segmentLabel(id),
			value: enabled ? "开" : "关",
			hint: segmentHints[id],
			kind: "segment",
			segment: id,
			enabled,
		}));
	}
	if (section === "input") return [
		...inputSettings.map(setting => descriptorRow(config, setting)),
		{
			id: "input.shortcut", label: "暂存快捷键", value: shortcutLabel(config.editor.stashShortcut),
			hint: "按 Enter 后按下快捷键；Pi 自带的按键无法替换。",
			kind: "shortcut", key: config.editor.stashShortcut,
		},
	];
	if (section === "working") {
		const editor = config.editor;
		return [
			descriptorRow(config, activityDisplay),
			descriptorRow(config, animation),
			activityNumber(config, "working.speed", "扫光速度", "workingSweepSpeed", WORKING_SPEED,
				`${editor.workingSweepSpeed} 列/秒`, "列/秒", "工作时扫光的移动速度：每秒 10–120 列。"),
			descriptorRow(config, sweepColor),
			activityNumber(config, "activity.summarySpeed", "压缩 / 摘要速度", "summarySpeedMultiplier", SUMMARY_SPEED,
				`${editor.summarySpeedMultiplier.toFixed(2)}× · ${Number((editor.workingSweepSpeed * editor.summarySpeedMultiplier).toFixed(2))} 列/秒`, "倍",
				"压缩与分支摘要时的速度倍率；小于 1 更慢，大于 1 更快。"),
			activityNumber(config, "activity.retryBlink", "重试闪烁频率", "retryBlinkHz", RETRY_BLINK,
				`${editor.retryBlinkHz.toFixed(2)} Hz`, "Hz", `每 ${Number((1 / editor.retryBlinkHz).toFixed(2))} 秒完成一次亮/常亮循环，不改变 Pi 的重试间隔。`),
		].map((row, index) => ({ ...row, inactive: index > 0 && editor.activityMode === "text" }));
	}
	const rows = appearance.map((descriptor) => descriptorRow(config, descriptor));
	rows.splice(
		1,
		0,
		...(["light", "dark"] as const).map((slot) => ({
			id: `appearance.palette.${slot}`,
			label: slot === "light" ? "浅色主题" : "深色主题",
			value: getThemeLabel(config.theme[slot]),
			hint:
				slot === "light"
					? "用于 Pi 浅色（或无法识别）主题的 GlanceTps 配色，不改变 Pi 自身的主题。"
					: "用于 Pi 深色主题的 GlanceTps 配色，不改变 Pi 自身的主题。",
			kind: "theme" as const,
			slot,
		})),
	);
	return rows;
}
