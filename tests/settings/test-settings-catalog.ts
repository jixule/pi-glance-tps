import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig, configToText, configFromText } from "../../src/config/model.js";
import { getSettingsRows, getThemeCatalogForSlot, SETTINGS_SECTIONS, type SettingsSectionId } from "../../src/settings/catalog.js";
import { SEGMENT_IDS, type SegmentId } from "../../src/segments/registry.js";

test("four sections have stable, user-facing labels and one home for each setting", () => {
	const config = defaultConfig();
	assert.deepEqual(SETTINGS_SECTIONS.map(s => s.label), ["外观", "状态栏", "活动状态", "输入"]);
	assert.deepEqual(getSettingsRows(config, "appearance").map(row => [row.label, row.value]), [
		["GlanceTps", "开"], ["浅色主题", "Light"], ["深色主题", "Dark"], ["图标", "Nerd Font"],
		["工作区标签", "智能路径"],
	]);
	assert.deepEqual(getSettingsRows(config, "input").map(row => [row.label, row.value]), [
		["编辑框高度", "3 行"], ["编辑框上方留白", "1 行"], ["提示词暂存", "开"], ["暂存快捷键", "alt+s"],
	]);
	assert.deepEqual(getSettingsRows(config, "working").map(row => [row.label, row.value]), [["显示方式", "Text"], ["动效范围", "整圈边框"], ["扫光速度", "47 列/秒"], ["动效颜色", "跟随主题"], ["压缩 / 摘要速度", "0.50× · 23.5 列/秒"], ["重试闪烁频率", "0.50 Hz"]]);
	const rows = [...SETTINGS_SECTIONS.flatMap(s => getSettingsRows(config, s.id)), ...SEGMENT_IDS.flatMap(id => getSettingsRows(config, "status", id))];
	assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
	for (const row of rows) {
		assert.ok(row.hint.length && row.hint.length < 130);
		assert.ok(row.label.length <= 26);
		assert.ok(!["input-output", "percent+tokens", "read-write", "nerd", "auto"].includes(row.value));
	}
});

test("all choices are directly selectable, immutable and round-trip through saved config", () => {
	const config = defaultConfig(), before = structuredClone(config);
	const rows = [...getSettingsRows(config, "appearance"), ...getSettingsRows(config, "input"), ...getSettingsRows(config, "working"), ...SEGMENT_IDS.flatMap(id => getSettingsRows(config, "status", id))];
	for (const row of rows) {
		if (row.kind !== "choice" && row.kind !== "toggle") continue;
		assert.equal(new Set(row.options.map(o => o.label)).size, row.options.length);
		for (let index = 0; index < row.options.length; index++) {
			const next = row.select(config, index);
			const section: SettingsSectionId = row.id.startsWith("appearance") ? "appearance" : row.id.startsWith("input") ? "input" : row.id.startsWith("working") || row.id.startsWith("activity") ? "working" : "status";
			const segment: SegmentId | undefined = SEGMENT_IDS.find(id => row.id.startsWith(id + "."));
			assert.equal(getSettingsRows(next, section, segment).find(r => r.id === row.id)!.value, row.options[index]!.label);
			assert.deepEqual(configFromText(configToText(next)), next);
			assert.deepEqual(config, before);
		}
	}
});

test("status order, disabled entries, custom refresh values and all 22 palettes survive regrouping", () => {
	const config = defaultConfig();
	config.segments.reverse(); config.segments[0]!.enabled = false;
	config.git.pollIntervalMs = 7500;
	assert.deepEqual(getSettingsRows(config, "status").map(r => r.value), ["关", "开", "开", "开", "开", "开", "开"]);
	assert.equal(getSettingsRows(config, "status")[0]!.label, "模型");
	assert.equal(getSettingsRows(config, "status", "git").find(r => r.id === "git.polling")!.value, "7.5 秒");
	for (const slot of ["light", "dark"] as const) {
		const catalog = getThemeCatalogForSlot(slot);
		assert.equal(catalog.length, 22);
		assert.equal(new Set(catalog.map(c => c.id)).size, 22);
		assert.equal(catalog[0]!.tone, slot);
	}
});
