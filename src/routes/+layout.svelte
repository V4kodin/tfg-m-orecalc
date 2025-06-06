<script lang="ts">
	import "../app.css";
	
	import { PUBLIC_GITHUB } from "$env/static/public";

	import { DarkMode, Button, Select, type SelectOptionType, Toast } from "flowbite-svelte";
	import { GithubSolid, TrashBinSolid, ClipboardCheckSolid, CheckCircleSolid, CloseCircleSolid } from "flowbite-svelte-icons";

	import { preset, saved, settings } from "$lib/stores";
	import type { Preset } from "$lib/interfaces";
	
	const { children } = $props()

	const btnClass = "text-center font-medium bg-transparent border border-gray-200 dark:border-gray-600 dark:bg-gray-800 focus-within:text-primary-700 dark:focus-within:text-white focus-within:ring-gray-200 dark:focus-within:ring-gray-700 focus-within:ring-4 focus-within:outline-hidden text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white rounded-lg text-xl p-2 h-[40px] w-[40px] flex items-center justify-center border-none";

	// migration
	{
		const old = $settings as unknown as Preset;
		if (old.metals && old.ores && old.params) {
			$preset = old;
			settings.reset();
		}
	}

	let list: SelectOptionType<string>[] = $state([]);
	let selected: string = $state("");

	saved.subscribe(rec => list = Object.keys(rec).map(name => ({ name, value: name })));
	
	const setSelected = (selected: string) => {
		const newPreset = $saved[selected];

		if (newPreset) {
			$preset = newPreset;
		}
	}

	$effect(() => setSelected(selected));

	const savePreset = () => {
		let name = prompt("Preset name", selected);

		if (name) {
			saved.set({ ...$saved, [name]: $preset });
			selected = name
		}
	}

	let toastStatus = $state(false);
	let toastProps = $state({
		timeout: 0,
		clipboard: false,
		fail: false,
		message: "",
	});

	const showToast  = (message: string, props: { clipboard?: boolean, fail?: boolean } = {}) => {
		const { clipboard = false, fail = false } = props;

		clearTimeout(toastProps.timeout);

		toastProps = { message, clipboard, fail, timeout: setTimeout(() => toastStatus = false, 2500) };
		toastStatus = true;
	}

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);

		showToast("Copied to clipboard", { clipboard: true });
	}

	const importData = () => {
		const input = prompt("Paste data here");

		if (input) {
			try {
				const data = JSON.parse(input) as Preset | Record<string, Preset>;

				if (Object.values(data).length > 0) {
					if (Object.values(data).every(p => p.metals && p.ores && p.params)) {
						$saved = data as Record<string, Preset>;

						showToast("Imported saved presets");
					} else {
						const { metals, ores, params } = data as Preset;

						$preset = { metals, ores, params };

						showToast("Imported curent preset");
					}
				}
			} catch (e) {
				showToast("Error parsing JSON", { fail: true });
			}
		}
	}

	const exportPreset = () =>
		copyToClipboard(JSON.stringify($preset));

	const exportSaved = () =>
		copyToClipboard(JSON.stringify($saved));

	const deletePreset = () => {
		const confirmed = confirm("Are you sure you want to delete this preset?");

		if (confirmed) {
			delete $saved[selected];
			$saved = $saved
			selected = ""
		}
	}
</script>

<svelte:head>
	<title>Ore calculator</title>
</svelte:head>

<div class="flex flex-row justify-between h-[75px] px-8 py-4 items-center">
	<h1 class="text-3xl font-bold">TerraFirma ore calculator</h1>

	<div class="flex flex-row gap-4">
	<div class="flex flex-row gap-2">
		<Button onclick={savePreset}>Save</Button>
		<Select
			placeholder="Choose a preset..."
			class="min-w-[200px]"
			items={list}
			bind:value={selected}
		/>
		<Button 
			onclick={deletePreset}
			disabled={!selected}
			color="red"
		><TrashBinSolid/></Button>
		<Button color="alternative" onclick={importData}>Import</Button>
		<Button color="alternative" onclick={exportPreset}>Export</Button>
		<Button color="alternative" onclick={exportSaved} disabled={Object.keys($saved).length === 0}>Export All</Button>
	</div>
	<div class="flex flex-row gap-2">
		{#if PUBLIC_GITHUB}
			<Button class={btnClass} href={PUBLIC_GITHUB} target="_blank" color="alternative"><GithubSolid /></Button>
		{/if}
		<DarkMode class={btnClass}/>
	</div>
	</div>
</div>
<div class="h-[calc(100vh-75px)]">
	{@render children?.()}
</div>

<Toast position="bottom-right" bind:toastStatus>
	{#snippet icon()}
		{#if toastProps.fail}
			<CloseCircleSolid class="h-5 w-5" />
		{:else if toastProps.clipboard}
			<ClipboardCheckSolid class="h-5 w-5"/>
		{:else}
			<CheckCircleSolid class="h-5 w-5" />
		{/if}
	{/snippet}
	{toastProps.message}
</Toast>