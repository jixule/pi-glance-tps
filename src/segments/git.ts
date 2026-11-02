import { choiceSetting, toggleSetting } from "../config/settings.js";
import type { SegmentFeature } from "./feature.js";
import type { SegmentData, SegmentRenderContext } from "../types.js";

const POLL_INTERVALS = [2000, 5000, 10000, 30000] as const;

function gitBranchLabel(ctx: SegmentRenderContext): string {
	const git = ctx.state.git;
	if (git.branch) {
		if (ctx.config.git.shaMode === "always" && git.sha) return `${git.branch} ${git.sha}`;
		return git.branch;
	}
	if (git.detached && git.sha && ctx.config.git.shaMode !== "off") return git.sha;
	return "HEAD";
}

function gitStatusMark(ctx: SegmentRenderContext): string {
	const status = ctx.state.git.status;
	if (status === "conflict") return ctx.config.icons === "nerd" ? "⚠" : "!";
	if (status === "dirty") return ctx.config.icons === "nerd" ? "●" : "*";
	return "";
}

function collectGit(ctx: SegmentRenderContext): SegmentData | undefined {
	const git = ctx.state.git;
	if (!git.repo) return undefined;
	const branch = gitBranchLabel(ctx);
	const showMark = git.status === "conflict" || ctx.config.git.changes !== "hidden";
	const mark = [showMark ? gitStatusMark(ctx) : "", git.stale ? "?" : ""].filter(Boolean).join(" ");
	const core = [branch, mark].filter(Boolean).join(" ");
	const summary = ctx.config.git.changes === "summary" && git.status !== "clean" && !git.stale ? git.summary : undefined;
	const fileLabel = summary?.files ? `Δ${summary.files}` : "";
	const compact = fileLabel
		? [branch, git.status === "conflict" ? mark : "", fileLabel].filter(Boolean).join(" ")
		: core;
	const full = [compact];
	if (fileLabel && summary && summary.additions !== null && summary.deletions !== null) {
		if (summary.additions) full.push(`+${summary.additions}`);
		if (summary.deletions) full.push(`−${summary.deletions}`);
	}
	const upstream: string[] = [];
	if (ctx.config.git.showAheadBehind && !git.stale) {
		if (git.ahead) upstream.push(`↑${git.ahead}`);
		if (git.behind) upstream.push(`↓${git.behind}`);
	}
	full.push(...upstream);
	let detailFallbacks: string[] | undefined;
	if (fileLabel && ctx.widthMode !== "minimal") {
		detailFallbacks = ctx.widthMode === "full"
			? [[compact, ...upstream].join(" "), [core, ...upstream].join(" ")]
			: [core];
	}
	return {
		primary: full.join(" "),
		display: { compact, minimal: core },
		detailFallbacks,
	};
}

export const gitSegmentFeature = {
	id: "git",
	label: "Git",
	defaultEnabled: true,
	settings: [
		choiceSetting(
			"git.changes",
			"变更",
			"显示标记或紧凑的变更摘要，冲突始终可见。",
			[
				{ value: "hidden", label: "隐藏" },
				{ value: "marker", label: "标记" },
				{ value: "summary", label: "摘要" },
			],
			(c) => c.git.changes,
			(c, v) => {
				c.git.changes = v;
			},
		),
		toggleSetting(
			"git.aheadBehind",
			"领先 / 落后",
			"显示相对上游分支的领先或落后提交数。",
			(c) => c.git.showAheadBehind,
			(c, v) => {
				c.git.showAheadBehind = v;
			},
		),
		choiceSetting(
			"git.sha",
			"提交 ID",
			"选择何时显示短提交 ID。",
			[
				{ value: "off", label: "隐藏" },
				{ value: "detached", label: "分离时", hint: "没有检出分支时显示。" },
				{ value: "always", label: "总是" },
			],
			(c) => c.git.shaMode,
			(c, v) => {
				c.git.shaMode = v;
			},
		),
		toggleSetting(
			"git.fetch", "自动获取",
			"每 5 分钟刷新上游分支；不会弹出登录提示，失败后会稍后重试。",
			c => c.git.autoFetch,
			(c, value) => { c.git.autoFetch = value; },
		),
		choiceSetting(
			"git.polling",
			"刷新间隔",
			"检查 Pi 之外的 Git 变更的频率。",
			POLL_INTERVALS.map((value) => ({ value, label: `${value / 1000} 秒` })),
			(c) => c.git.pollIntervalMs,
			(c, v) => {
				c.git.pollIntervalMs = v;
			},
			(value) => `${value / 1000} 秒`,
		),
	],
	collect: collectGit,
} as const satisfies SegmentFeature;
