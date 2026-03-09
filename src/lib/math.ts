import type { Combination, Metal, Ore, OreInfo, Params, Result, Settings } from "./interfaces"

export const defaultQuantity = 32;
const normalizeId = (value: string) => value.trim().toLowerCase();
const getOreName = (ore: Ore) => ore.name?.trim() || "<unnamed ore>";

const fail = (error: string): Result => ({
	combinations: [],
	approximation: false,
	timedout: false,
	time: 0,
	error
});

function validateInput(metals: Metal[], params: Params): string | undefined {
	const { multipleOf, min, max } = params;

	if (multipleOf <= 0)
		return "Multiple of must be greater than 0";
	if (min > max)
		return "Min mB cannot be greater than Max mB";
	if (metals.length === 0)
		return "No metals configured";

	const unique = new Set<string>();
	let sumMin = 0;
	let sumMax = 0;

	for (const metal of metals) {
		const key = normalizeId(metal.id);
		if (!key)
			return "Metal id cannot be empty";
		if (unique.has(key))
			return `Duplicate metal id: ${metal.id}`;
		unique.add(key);

		if (metal.percent.min < 0 || metal.percent.max > 100 || metal.percent.min > metal.percent.max)
			return `Invalid percentage range for metal ${metal.id}`;

		sumMin += metal.percent.min;
		sumMax += metal.percent.max;
	}

	if (sumMin > 100)
		return `Invalid configuration: sum of minimum percentages is ${sumMin}% (> 100%)`;
	if (sumMax < 100)
		return `Invalid configuration: sum of maximum percentages is ${sumMax}% (< 100%)`;

	return undefined;
}

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

	const inputError = validateInput(metals, params);
	if (inputError)
		return fail(inputError);

	if (ores.length === 0)
		return fail("No ores configured");

	const metalById = metals.reduce((acc, metal) => {
		acc[normalizeId(metal.id)] = metal;
		return acc;
	}, {} as Record<string, Metal>);

	const unresolvedOres = ores
		.filter(ore => !metalById[normalizeId(ore.id)])
		.map(getOreName);

	if (unresolvedOres.length > 0)
		return fail(`Ores with unknown metal id: ${unresolvedOres.join(", ")}`);

	const invalidWeightOres = ores.filter(ore => ore.weight <= 0).map(getOreName);
	if (invalidWeightOres.length > 0)
		return fail(`Ores with non-positive weight: ${invalidWeightOres.join(", ")}`);

	const zeroLimitOres = ores.filter(ore => (ore.quantity ?? defaultQuantity) <= 0).map(getOreName);
	const cappedByMaxOres: string[] = [];

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
		.map(ore => {
			const quantity = ore.quantity ?? defaultQuantity;
			const maxQtyByWeight = Math.floor(max / ore.weight);
			const effectiveMaxQty = Math.min(quantity, Math.max(0, maxQtyByWeight));
			if (quantity > 0 && effectiveMaxQty === 0)
				cappedByMaxOres.push(getOreName(ore));
			return { ...ore, quantity, effectiveMaxQty };
		})
		.filter(ore => ore.quantity > 0);

	if (sortedOres.length === 0)
		return fail(`No ores with quantity > 0. Ores with zero limit: ${zeroLimitOres.join(", ")}`);

	const oreQuantities = sortedOres
		.map(ore => Array.from({ length: ore.effectiveMaxQty + 1 }, (_, i) => i))

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

		if (error && zeroLimitOres.length > 0)
			error = `${error}. Ores with zero limit: ${zeroLimitOres.join(", ")}`;
		if (error && cappedByMaxOres.length > 0)
			error = `${error}. Ignored by Max mB limit: ${cappedByMaxOres.join(", ")}`;
	}

	return {
		approximation: !hasValid,
		combinations,
		time: (Date.now() - start) / 1000,
		timedout,
		error
	};
}
