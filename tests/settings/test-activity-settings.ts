import { strict as assert } from "node:assert";
import { test } from "node:test";
import { getSettingsRows } from "../../src/settings/catalog.js";
import { paneHarness, keys as k } from "../support/pane-harness.js";

test("Activity offers one display choice and five retained effect controls, inactive in Text", () => {
	const h = paneHarness();
	try {
		h.press(k.tab, k.tab);
		assert.match(h.text(), /\[ 活动状态 \]/);
		assert.deepEqual(getSettingsRows(h.config, "working").map(r => r.label), ["显示方式", "动效范围", "扫光速度", "动效颜色", "压缩 / 摘要速度", "重试闪烁频率"]);
		assert.match(h.text(), /显示方式\s+Text/);
		assert.equal(h.pending(), 0);
		h.press(k.down, k.down, k.right);
		assert.match(h.text(), /48 列\/秒/);
		assert.match(h.text(), /仅在 Sweep 模式下生效/);
		assert.equal(h.pending(), 0, "editing stored effect parameters must not turn Text into Sweep");
		h.press("s");
		const done = h.completion(); assert.ok(done?.action === "save");
		assert.equal(done.config.editor.activityMode, "text");
		assert.equal(done.config.editor.workingSweepSpeed, 48);
	} finally { h.pane.dispose(); }
});

test("fractional fields have their own steps, limits and local confirmation/cancellation", () => {
	const h = paneHarness();
	try {
		h.press(k.tab, k.tab, ...Array(4).fill(k.down), k.enter, "1.35", k.enter);
		assert.match(h.text(), /1\.35× · 63\.45 列\/秒/);
		h.press(k.right); assert.match(h.text(), /1\.40×/);
		h.press(k.enter, "0.2", k.enter);
		assert.match(h.text(), /0.25 到 2/);
		h.press(k.esc); assert.match(h.text(), /1\.40×/);
		h.press(k.down, k.enter, "0.75", k.enter, k.right);
		assert.match(h.text(), /1\.00 Hz/);
		h.press(k.enter, "1.234", k.enter);
		assert.match(h.text(), /2 位小数/);
		h.press(k.esc, "s");
		const done = h.completion(); assert.ok(done?.action === "save");
		assert.equal(done.config.editor.summarySpeedMultiplier, 1.4);
		assert.equal(done.config.editor.retryBlinkHz, 1);
		assert.equal(done.config.editor.activityMode, "text");
		assert.equal(h.config.editor.summarySpeedMultiplier, 0.5);
	} finally { h.pane.dispose(); }
});

test("Activity previews follow the field and chosen mode, with transient scenarios and no hidden clock", () => {
	const h = paneHarness();
	try {
		h.press(k.tab, k.tab);
		assert.match(h.text(), /预览 · 示例 · Text · 工作中/);
		assert.equal(h.pending(), 0);
		h.press("p"); assert.match(h.text(), /Text · 压缩上下文中/);
		assert.match(h.text(), /无修改/);
		h.press(k.right); h.text(); assert.equal(h.pending(), 1);
		h.press(...Array(4).fill(k.down));
		assert.match(h.text(), /Sweep · 压缩上下文中 · 23\.5 列\/秒/);
		h.press(k.down); assert.match(h.text(), /Sweep · 重试中 · 0\.50 Hz/);
		const bright = h.pane.render(180).at(-1);
		h.advance(1000); const normal = h.pane.render(180).at(-1);
		assert.notEqual(bright, normal);
		h.advance(1000); assert.equal(h.pane.render(180).at(-1), bright);
		h.press("p"); assert.match(h.text(), /空闲（有草稿）/); assert.equal(h.pending(), 0);
		h.press("p", k.right); assert.match(h.text(), /Sweep · 工作中/);
		h.height(12); h.text(); assert.equal(h.pending(), 0);
		h.advance(5000); h.height(40); h.text(); assert.equal(h.pending(), 1);
		h.press(...Array(5).fill(k.up), k.left); h.text(); assert.equal(h.pending(), 0);
		h.press("s"); assert.equal(h.pending(), 0);
		const done = h.completion(); assert.ok(done?.action === "save");
		assert.equal(done.config.editor.activityMode, "text");
		assert.equal(done.config.editor.retryBlinkHz, 0.75);
		assert.ok(!JSON.stringify(done.config).includes("preview"));
	} finally { h.pane.dispose(); }
});
