import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { GitRefresher } from "../../src/runtime/git.js";
import { emptyGitSnapshot, parseGitStatus } from "../../src/runtime/git-snapshot.js";
import type { GitSnapshot } from "../../src/types.js";

test("idle Git polls back off, still discover external edits, and yield to activity", { timeout: 10_000 }, async t => {
	const cwd = mkdtempSync(join(tmpdir(), "glance-tps-git-idle-"));
	const config = defaultConfig().git; config.autoFetch = false;
	let scheduled: { run(): void; delay: number } | undefined;
	let deliver: (snapshot: GitSnapshot) => void = () => {};
	const refresher = new GitRefresher(() => config, () => cwd, (_cwd, snapshot) => deliver(snapshot), {
		setTimer: (run, delay) => {
			scheduled = { run, delay };
			return { unref() {} } as unknown as NodeJS.Timeout;
		},
	});
	t.after(() => { refresher.dispose(); rmSync(cwd, { recursive: true, force: true }); });
	const git = (...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
	git("init", "-q");
	writeFileSync(join(cwd, "note.txt"), "before\n");
	git("add", ".");
	git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base");

	async function poll(): Promise<GitSnapshot> {
		const next = scheduled;
		assert.ok(next, "idle polling must retain a fallback");
		scheduled = undefined;
		const result = new Promise<GitSnapshot>(resolve => { deliver = resolve; });
		next.run();
		return result;
	}
	const delay = () => scheduled?.delay;
	refresher.schedule(true);
	for (const expected of [5_000, 10_000, 20_000, 30_000, 30_000]) {
		const snapshot = await poll();
		assert.equal(snapshot.dirty, false);
		assert.equal(delay(), expected, "unchanged polls slow down to a bounded idle interval");
	}
	writeFileSync(join(cwd, "note.txt"), "after\nextra\n");
	const changed = await poll();
	assert.equal(changed.dirty, true, "a change made outside Pi is found by the fallback poll");
	assert.deepEqual(changed.summary, { files: 1, additions: 2, deletions: 1 });
	assert.equal(delay(), 5_000, "changed facts restore the active polling interval");
	await poll();
	assert.equal(delay(), 10_000);
	refresher.schedule();
	assert.equal(delay(), config.refreshDebounceMs, "activity brings an idle poll forward");
	await poll();
	assert.equal(delay(), 5_000, "activity resets the idle history even if Git is unchanged");

	config.pollIntervalMs = 60_000;
	refresher.schedule(true);
	await poll(); await poll();
	assert.equal(delay(), 60_000, "an explicit interval longer than the idle cap is respected");
	config.pollIntervalMs = 2_147_483_647;
	refresher.schedule(true);
	await poll(); await poll();
	assert.equal(delay(), 2_147_483_647, "backoff cannot overflow Node's timer range");
});

test("pending activity, collection failure and workspace changes reset Git idle history", { timeout: 2_000 }, async t => {
	const config = defaultConfig().git; config.autoFetch = false;
	const good = parseGitStatus("# branch.head main\n");
	let cwd = "/one", fail = false, block = false;
	let complete: ((snapshot: GitSnapshot) => void) | undefined;
	let scheduled: { run(): void; delay: number } | undefined;
	let deliver: (snapshot: GitSnapshot) => void = () => {};
	const refresher = new GitRefresher(() => config, () => cwd, (_cwd, snapshot) => deliver(snapshot), {
		collect: async () => block ? new Promise<GitSnapshot>(resolve => { complete = resolve; })
			: fail ? { ...emptyGitSnapshot(), stale: true } : { ...good },
		setTimer: (run, delay) => { scheduled = { run, delay }; return { unref() {} } as unknown as NodeJS.Timeout; },
	});
	t.after(() => refresher.dispose());
	const delay = () => scheduled?.delay;
	function poll(): Promise<GitSnapshot> {
		const next = scheduled!;
		scheduled = undefined;
		const result = new Promise<GitSnapshot>(resolve => { deliver = resolve; });
		next.run();
		return result;
	}
	refresher.schedule(true);
	await poll(); await poll(); await poll(); await poll();
	assert.equal(delay(), 30_000);
	block = true;
	const collecting = poll();
	refresher.schedule();
	assert.ok(complete); complete(good);
	await collecting;
	assert.equal(delay(), config.refreshDebounceMs);
	block = false;
	await poll();
	assert.equal(delay(), 5_000, "activity received during collection also resets the next poll");
	await poll();
	fail = true;
	assert.equal((await poll()).stale, true);
	assert.equal(delay(), 5_000, "a transient failure keeps recovery responsive");
	fail = false;
	assert.equal((await poll()).stale, undefined);
	assert.equal(delay(), 5_000, "recovery starts a fresh idle history");
	await poll();
	assert.equal(delay(), 10_000);
	cwd = "/two";
	await poll();
	assert.equal(delay(), 5_000, "another workspace does not inherit an idle delay");
});
