import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_VERSION, configToText, defaultConfig, normalizeConfig } from "./model.js";
import type { GlanceTpsConfig } from "../types.js";

export type ConfigLoadStatus = "loaded" | "missing" | "invalid" | "unreadable" | "future";

export interface ConfigLoadResult {
	config: GlanceTpsConfig;
	status: ConfigLoadStatus;
	writable: boolean;
	diagnostic?: string;
}

/** Read and atomically replace the config at the supplied path. */
export function createConfigStore(configPath: string) {
	function errorMessage(error: unknown): string {
		return error instanceof Error && error.message ? error.message : String(error);
	}

	function isMissingConfigError(error: unknown): boolean {
		return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
	}

	function configLoadResultFromText(text: string): ConfigLoadResult {
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch (error) {
			return {
				config: defaultConfig(),
				status: "invalid",
				writable: false,
				diagnostic: `pi-glance-tps 配置无效；在修复或删除 ${configPath} 之前使用默认值并禁止保存（${errorMessage(error)}）`,
			};
		}

		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			return {
				config: defaultConfig(),
				status: "invalid",
				writable: false,
				diagnostic: `pi-glance-tps 配置必须是 JSON 对象；在修复或删除 ${configPath} 之前使用默认值并禁止保存`,
			};
		}

		const rawVersion = (raw as Record<string, unknown>).version;
		if (typeof rawVersion === "number" && Number.isFinite(rawVersion) && rawVersion > CONFIG_VERSION) {
			return {
				config: normalizeConfig(raw),
				status: "future",
				writable: false,
				diagnostic: `pi-glance-tps 配置版本 ${rawVersion} 高于支持的版本 ${CONFIG_VERSION}；仅使用已知字段，不会覆盖该文件`,
			};
		}

		return { config: normalizeConfig(raw), status: "loaded", writable: true };
	}

	function configReadErrorResult(error: unknown): ConfigLoadResult {
		if (isMissingConfigError(error)) return { config: defaultConfig(), status: "missing", writable: true };
		return {
			config: defaultConfig(),
			status: "unreadable",
			writable: false,
			diagnostic: `pi-glance-tps 配置读取失败；在 ${configPath} 可访问之前使用默认值并禁止保存（${errorMessage(error)}）`,
		};
	}

	function loadConfigSync(): ConfigLoadResult {
		try {
			return configLoadResultFromText(readFileSync(configPath, "utf8"));
		} catch (error) {
			return configReadErrorResult(error);
		}
	}

	async function loadConfig(): Promise<ConfigLoadResult> {
		try {
			return configLoadResultFromText(await readFile(configPath, "utf8"));
		} catch (error) {
			return configReadErrorResult(error);
		}
	}

	async function saveConfig(config: GlanceTpsConfig): Promise<void> {
		const configDir = dirname(configPath);
		const temporaryPath = join(configDir, `.config.json.${process.pid}.${randomUUID()}.tmp`);
		await mkdir(configDir, { recursive: true });
		try {
			await writeFile(temporaryPath, configToText(config), { encoding: "utf8", flag: "wx", mode: 0o600 });
			await rename(temporaryPath, configPath);
		} catch (error) {
			await rm(temporaryPath, { force: true }).catch(() => undefined);
			throw error;
		}
	}

	return { loadConfigSync, loadConfig, saveConfig };
}
