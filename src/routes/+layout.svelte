<script>
	import "../app.css";
	
	import { PUBLIC_GITHUB } from "$env/static/public";

	import { DarkMode, Button } from "flowbite-svelte";
	import { GithubSolid } from "flowbite-svelte-icons";

	const { children } = $props()

	const btnClass = "text-center font-medium bg-transparent border border-gray-200 dark:border-gray-600 dark:bg-gray-800 focus-within:text-primary-700 dark:focus-within:text-white focus-within:ring-gray-200 dark:focus-within:ring-gray-700 focus-within:ring-4 focus-within:outline-hidden text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white rounded-lg text-xl p-2 h-[40px] w-[40px] flex items-center justify-center border-none";
</script>

<svelte:head>
	<title>Ore calculator</title>
</svelte:head>

<div class="flex flex-row justify-between h-[75px] px-8 py-4 items-center">
	<h1 class="text-3xl font-bold">TerraFirma ore calculator</h1>

	<div class="flex flex-row gap-2">
		{#if PUBLIC_GITHUB}
			<Button class={btnClass} href={PUBLIC_GITHUB} target="_blank" color="alternative"><GithubSolid /></Button>
		{/if}
		<DarkMode class={btnClass}/>
	</div>
</div>
<div class="h-[calc(100vh-75px)]">
	{@render children?.()}
</div>
