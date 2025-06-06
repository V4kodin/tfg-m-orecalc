import { persisted } from "svelte-persisted-store"
import type { Preset, Settings } from "./interfaces"

export const preset = persisted<Preset>("preset", {
	metals: [
		{
			id: "",
			percent: {
				min: 0,
				max: 50
			}
		}
	],
	ores: [
		{
			name: "",
			id: "",
			weight: 0,
			quantity: 0
		}
	],
	params: {
		multipleOf: 144,
		tolerance: 30,
		min: 144,
		max: 1440
	}
});

export const settings = persisted<Settings>("settings", {
	count: 10,
	timeout: 5
});

export const saved = persisted<Partial<Record<string, Preset>>>("saved", {});