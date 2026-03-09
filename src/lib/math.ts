import type { Combination, Metal, Ore, OreInfo, Params, Result, Settings } from "./interfaces"

export const defaultQuantity = 32;
const normalizeId = (value: string) => value.trim().toLowerCase();
const getOreName = (ore: Ore) => ore.name?.trim() || "<unnamed ore>";
const epsilon = 1e-9;

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
	const metalIndexById = metals.reduce((acc, metal, index) => {
		acc[normalizeId(metal.id)] = index;
		return acc;
	}, {} as Record<string, number>);

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
			return { ...ore, quantity, effectiveMaxQty, metalIndex: metalIndexById[normalizeId(ore.id)] };
		})
		.filter(ore => ore.quantity > 0);

	if (sortedOres.length === 0)
		return fail(`No ores with quantity > 0. Ores with zero limit: ${zeroLimitOres.join(", ")}`);

	let rejectedByWeight = 0;
	let rejectedByPercent = 0;
	let rejectedByMultiple = 0;
	let checked = 0;

	const oreCount = sortedOres.length;
	const metalCount = metals.length;
	const quantities = new Array<number>(oreCount).fill(0);
	const metalWeights = new Array<number>(metalCount).fill(0);

	const suffixMaxWeight = new Array<number>(oreCount + 1).fill(0);
	const suffixMetalMax = Array.from({ length: oreCount + 1 }, () => new Array<number>(metalCount).fill(0));
	for (let i = oreCount - 1; i >= 0; i--) {
		const ore = sortedOres[i];
		suffixMaxWeight[i] = suffixMaxWeight[i + 1] + ore.weight * ore.effectiveMaxQty;
		suffixMetalMax[i] = [...suffixMetalMax[i + 1]];
		suffixMetalMax[i][ore.metalIndex] += ore.weight * ore.effectiveMaxQty;
	}

	const pushCombination = (finalWeight: number, valid: boolean) => {
		const details: OreInfo[] = [];
		for (let i = 0; i < oreCount; i++) {
			if (quantities[i] <= 0)
				continue;
			details.push({
				id: sortedOres[i].id,
				name: sortedOres[i].name,
				weight: quantities[i] * sortedOres[i].weight,
				quantity: quantities[i]
			});
		}

		(valid ? validCombinations : approximationCombinations).push({
			details,
			finalWeight: {
				total: finalWeight,
				quantity: Math.floor(finalWeight / multipleOf),
				additional: finalWeight - multipleOf * Math.floor(finalWeight / multipleOf),
				multipleOf
			}
		});
	};

	const dfs = (index: number, currentWeight: number) => {
		if (timedout || validCombinations.length >= count)
			return;
		if (Date.now() - start > timeout * 1000) {
			timedout = true;
			return;
		}

		if (currentWeight > max) {
			rejectedByWeight++;
			return;
		}

		const maxReachableWeight = currentWeight + suffixMaxWeight[index];
		if (maxReachableWeight < min) {
			rejectedByWeight++;
			return;
		}

		const possibleWeightMin = Math.max(min, currentWeight);
		const possibleWeightMax = Math.min(max, maxReachableWeight);

		for (let metalIndex = 0; metalIndex < metalCount; metalIndex++) {
			const currentMetalWeight = metalWeights[metalIndex];
			const maxMetalWeight = currentMetalWeight + suffixMetalMax[index][metalIndex];
			const minPercent = metals[metalIndex].percent.min;
			const maxPercent = metals[metalIndex].percent.max;

			if (minPercent > 0) {
				const maxWeightForMinConstraint = (maxMetalWeight * 100) / minPercent;
				if (possibleWeightMin - epsilon > maxWeightForMinConstraint) {
					rejectedByPercent++;
					return;
				}
			}

			if (maxPercent <= 0) {
				if (currentMetalWeight > 0) {
					rejectedByPercent++;
					return;
				}
			} else {
				const minWeightForMaxConstraint = (currentMetalWeight * 100) / maxPercent;
				if (possibleWeightMax + epsilon < minWeightForMaxConstraint) {
					rejectedByPercent++;
					return;
				}
			}
		}

		if (index === oreCount) {
			if (currentWeight <= 0 || currentWeight < min || currentWeight > max) {
				rejectedByWeight++;
				return;
			}

			for (let metalIndex = 0; metalIndex < metalCount; metalIndex++) {
				const percentage = (metalWeights[metalIndex] / currentWeight) * 100;
				const range = metals[metalIndex].percent;
				if (percentage + epsilon < range.min || percentage - epsilon > range.max) {
					rejectedByPercent++;
					return;
				}
			}

			const valid = currentWeight % multipleOf === 0;
			const approximation = Math.abs(currentWeight - multipleOf) <= tolerance;
			if (!valid && !approximation) {
				rejectedByMultiple++;
				return;
			}

			checked++;
			pushCombination(currentWeight, valid);
			return;
		}

		const ore = sortedOres[index];
		for (let qty = ore.effectiveMaxQty; qty >= 0; qty--) {
			const addedWeight = qty * ore.weight;
			const nextWeight = currentWeight + addedWeight;
			if (nextWeight > max)
				continue;

			quantities[index] = qty;
			if (qty > 0)
				metalWeights[ore.metalIndex] += addedWeight;

			dfs(index + 1, nextWeight);

			if (qty > 0)
				metalWeights[ore.metalIndex] -= addedWeight;
			quantities[index] = 0;

			if (timedout || validCombinations.length >= count)
				break;
		}
	};

	dfs(0, 0);

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
