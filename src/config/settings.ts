import type { GlanceTpsConfig } from "../types.js";

export interface SettingOption {
	label: string;
	hint?: string;
}

/** A config field's choices, labels and mutations, independent of its UI. */
export interface SettingDescriptor {
	id: string;
	label: string;
	hint: string;
	kind: "toggle" | "choice";
	options: readonly SettingOption[];
	value(config: GlanceTpsConfig): string;
	selectedIndex(config: GlanceTpsConfig): number;
	select(config: GlanceTpsConfig, index: number): void;
}

export function choiceSetting<T extends string | number | boolean>(
	id: string,
	label: string,
	hint: string,
	options: readonly (SettingOption & { value: T })[],
	read: (config: GlanceTpsConfig) => T,
	write: (config: GlanceTpsConfig, value: T) => void,
	format: (value: T) => string = String,
): SettingDescriptor {
	return {
		id,
		label,
		hint,
		kind: "choice",
		options,
		value: (config) => {
			const value = read(config);
			return options.find((option) => option.value === value)?.label ?? format(value);
		},
		selectedIndex: (config) => {
			const value = read(config);
			return options.findIndex((option) => option.value === value);
		},
		select: (config, index) => {
			const option = options[index];
			if (option) write(config, option.value);
		},
	};
}

export function toggleSetting(
	id: string,
	label: string,
	hint: string,
	read: (config: GlanceTpsConfig) => boolean,
	write: (config: GlanceTpsConfig, value: boolean) => void,
): SettingDescriptor {
	return {
		...choiceSetting(
			id,
			label,
			hint,
			[
				{ value: true, label: "开" },
				{ value: false, label: "关" },
			],
			read,
			write,
		),
		kind: "toggle",
	};
}
