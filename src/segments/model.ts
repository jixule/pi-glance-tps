import { choiceSetting } from "../config/settings.js";
import type { SegmentFeature } from "./feature.js";
import type { SegmentData, SegmentRenderContext } from "../types.js";

function shouldShowThinking(ctx: SegmentRenderContext, thinking: string): boolean {
	if (ctx.config.model.showThinking === "never") return false;
	if (ctx.config.model.showThinking === "always") return Boolean(thinking);
	return thinking !== "off" && ctx.widthMode === "full";
}

function withoutProviderPrefix(name: string, provider: string | undefined): string {
	if (!provider) return name;
	const prefix = `${provider}-`;
	return name.length > prefix.length && name.toLowerCase().startsWith(prefix.toLowerCase())
		? name.slice(prefix.length)
		: name;
}

function collectModel(ctx: SegmentRenderContext): SegmentData | undefined {
	const modelId = ctx.state.model.id;
	const originalName = ctx.state.model.displayName || modelId || "no-model";
	const hasCustomName = Boolean(
		modelId && Object.keys(ctx.config.model.customNames).some((pattern) => modelId.includes(pattern)),
	);
	const shortName = hasCustomName ? originalName : withoutProviderPrefix(originalName, ctx.state.model.provider);
	const name = ctx.widthMode === "minimal" ? shortName : originalName;
	let provider = ctx.showProvider && ctx.state.model.provider ? `${ctx.state.model.provider}/` : "";
	const thinking = ctx.state.model.thinking || "off";
	const visibleThinking = shouldShowThinking(ctx, thinking) ? thinking : undefined;
	let suffix = visibleThinking ? ` ${visibleThinking}` : "";
	const model = `${provider}${name}`;
	const alternatives: string[] = [];
	if (provider && ctx.config.display.showProvider === "auto") {
		provider = "";
		alternatives.push(`${name}${suffix}`);
	}
	if (suffix && ctx.config.model.showThinking === "auto") {
		suffix = "";
		alternatives.push(`${provider}${name}`);
	}
	if (shortName !== name) alternatives.push(`${provider}${shortName}${suffix}`);
	return {
		primary: model,
		secondary: visibleThinking,
		fit: {
			alternatives,
			name: { prefix: provider, value: shortName, suffix },
		},
	};
}

export const modelSegmentFeature = {
	id: "model",
	label: "模型",
	defaultEnabled: true,
	settings: [
		choiceSetting(
			"model.providerLabel",
			"提供商名称",
			"在模型名旁显示提供商。",
			[
				{ value: "auto", label: "自动", hint: "仅在有用且有足够空间时显示。" },
				{ value: "always", label: "总是" },
				{ value: "never", label: "从不" },
			],
			(c) => c.display.showProvider,
			(c, v) => {
				c.display.showProvider = v;
			},
		),
		choiceSetting(
			"model.thinkingLabel",
			"思考级别",
			"显示模型当前的思考级别。",
			[
				{ value: "auto", label: "自动", hint: "关闭或空间不足时隐藏。" },
				{ value: "always", label: "Always" },
				{ value: "never", label: "Never" },
			],
			(c) => c.model.showThinking,
			(c, v) => {
				c.model.showThinking = v;
			},
		),
	],
	collect: collectModel,
} as const satisfies SegmentFeature;
