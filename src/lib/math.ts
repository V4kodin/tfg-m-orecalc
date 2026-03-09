import type { Combination, Metal, Ore, OreInfo, Params, Result, Settings } from "./interfaces"

export const defaultQuantity = 32;
const normalizeId = (value: string) => value.trim().toLowerCase();

function* product<T>(...pools: T[][]): Iterable<T[]> {
    const head = pools[0];
    const tail = pools.slice(1);
    const remainder = tail.length > 0 ? product(...tail) : [[]];
    for (let r of remainder)
		for (let h of head)
			yield [h, ...r];
}

export function generateAlloyCombinations(metals: Metal[], ores: Ore[], params: Params, settings: Settings): Result {
	const { multipleOf, tolerance, min, max } = params;
	const { count, timeout } = settings;

	const validCombinations: Combination[] = [];
	const approximationCombinations: Combination[] = [];

	const start = Date.now();
	let timedout = false;

	if (metals.length === 0)
		return { combinations: [], approximation: false, timedout: false, time: 0, error: "No metals configured" };

	if (ores.length === 0)
		return { combinations: [], approximation: false, timedout: false, time: 0, error: "No ores configured" };

	const metalById = metals.reduce((acc, metal) => {
		acc[normalizeId(metal.id)] = metal;
		return acc;
	}, {} as Record<string, Metal>);

	const unresolvedOres = ores
		.filter(ore => !metalById[normalizeId(ore.id)])
		.map(ore => ore.name || "<unnamed ore>");

	if (unresolvedOres.length > 0)
		return {
			combinations: [],
			approximation: false,
			timedout: false,
			time: 0,
			error: `Ores with unknown metal id: ${unresolvedOres.join(", ")}`
		};

	// Sort ores first by metal percentage and then by weight
	const sortedMetals = [...metals]
		.sort((a, b) => b.percent.min - a.percent.min)
		.reduce((acc, v, k) => ({ ...acc, [normalizeId(v.id)]: k }), {} as Record<string, number>);

	const sortedOres = [...ores]
		.map(ore => ({ ...ore, id: metalById[normalizeId(ore.id)]?.id ?? ore.id }))
		.sort((a , b) => 
			sortedMetals[normalizeId(a.id)] - sortedMetals[normalizeId(b.id)] ||
			b.weight - a.weight
		)
		.map(ore => ({ ...ore, quantity: ore.quantity ?? defaultQuantity }))
		.filter(ore => ore.quantity > 0);

	if (sortedOres.length === 0)
		return { combinations: [], approximation: false, timedout: false, time: 0, error: "No ores with quantity > 0" };

	const oreQuantities = sortedOres
		.map(ore => Array.from({ length: (ore.quantity ?? defaultQuantity) + 1 }, (_, i) => i))

	let rejectedByWeight = 0;
	let rejectedByPercent = 0;
	let rejectedByMultiple = 0;
	let checked = 0;

	for (const quantities of product(...oreQuantities)) {
		if ((timedout = Date.now() - start > timeout * 1000) || validCombinations.length >= count)
			break;

		let finalWeight = 0;
		const totalQuantity = quantities.reduce((acc, val) => acc + val, 0);
		const details: OreInfo[] = [];

		if (totalQuantity == 0)
			continue;

		sortedOres.forEach((ore, i) => {
			if (quantities[i] > 0) {
				const weight = quantities[i] * ore.weight;
				finalWeight += weight;
				details.push({ id: ore.id, name: ore.name, weight, quantity: quantities[i] });
			}
		});

		if (finalWeight < min || finalWeight > max)
		{
			rejectedByWeight++;
			continue;
		}

		let percentagesMet = true;
		metals.forEach((metal) => {
			const metalWeight = details
				.filter(w => w.id === metal.id)
				.reduce((acc, val) => acc + val.weight, 0);
			const percentage = (metalWeight / finalWeight) * 100;

			if (!(metal.percent.min <= percentage && percentage <= metal.percent.max))
				percentagesMet = false;
		});

		if (!percentagesMet)
		{
			rejectedByPercent++;
			continue;
		}

		const valid = finalWeight % multipleOf === 0 && finalWeight > 0;
		const approximation = Math.abs(finalWeight - multipleOf) <= tolerance && finalWeight > 0;
		
		if (!valid && !approximation)
		{
			rejectedByMultiple++;
			continue;
		}

		checked++;

		(valid ? validCombinations : approximationCombinations).push({
			details,
			finalWeight: {
				total: finalWeight,
				quantity: Math.floor(finalWeight / multipleOf),
				additional: finalWeight - multipleOf * Math.floor(finalWeight / multipleOf),
				multipleOf
			}
		});
	}

	const hasValid = validCombinations.length > 0;
	const combinations = hasValid
		? validCombinations.sort((a, b) => a.finalWeight.total - b.finalWeight.total)
		: approximationCombinations.sort((a, b) => a.finalWeight.total - b.finalWeight.total).slice(0, count);

	let error: string | undefined;
	if (combinations.length === 0) {
		if (timedout)
			error = "Calculation timed out before finding any matching combinations";
		else if (rejectedByPercent > 0 && rejectedByPercent >= rejectedByWeight && rejectedByPercent >= rejectedByMultiple)
			error = "No combinations match the configured metal percentage ranges";
		else if (rejectedByWeight > 0 && rejectedByWeight >= rejectedByPercent && rejectedByWeight >= rejectedByMultiple)
			error = "No combinations fit within Min/Max weight limits";
		else if (rejectedByMultiple > 0)
			error = "No combinations match multiple/tolerance constraints";
		else if (checked === 0)
			error = "No candidate combinations generated from current ore quantity limits";
	}

	return {
		approximation: !hasValid,
		combinations,
		time: (Date.now() - start) / 1000,
		timedout,
		error
	};
}
