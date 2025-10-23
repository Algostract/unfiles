<script setup lang="ts">
const props = defineProps<{
	view: 'grid' | 'list'
	media: {
		id: string;
		name: string;
		size: number;
		uri: string;
		thumbnail: string | null;
		original: string | undefined;
	}
}>()

const emit = defineEmits<{ (e: 'refetch', id: string): void }>()
const img = ref<HTMLImageElement | null>(null)
const aspect = ref<string | null>(null)

onMounted(() => {
	if (img.value && img.value.complete) {
		aspect.value = img.value.naturalWidth && img.value.naturalHeight
			? `${img.value.naturalWidth}:${img.value.naturalHeight}`
			: null
	}
})

function handleImgLoad(e: Event) {
	const t = e.target as HTMLImageElement
	aspect.value = t.naturalWidth && t.naturalHeight ? `${t.naturalWidth}:${t.naturalHeight}` : null
}

const formatedSize = computed(() => {
	if (!props.media.size) return '?'
	if (props.media.size > 1e9) return (props.media.size / 1e9).toFixed(2) + " GB"
	if (props.media.size > 1e6) return (props.media.size / 1e6).toFixed(2) + " MB"
	if (props.media.size > 1e3) return (props.media.size / 1e3).toFixed(2) + " KB"
	return props.media.size + " B"
})

const ext = computed(() => {
	const n = props.media.name || ''
	const i = n.lastIndexOf('.')
	return i > 0 ? n.slice(i + 1).toLowerCase() : ''
})

const baseName = computed(() => {
	const n = props.media.name || ''
	const i = n.lastIndexOf('.')
	return i > 0 ? n.slice(0, i) : n
})

const mediaKind = computed<'image' | 'video' | 'audio' | 'other'>(() => {
	const e = ext.value
	if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'tiff', 'bmp', 'heic', 'heif', 'svg', 'avif'].includes(e)) return 'image'
	if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'flv', 'mpeg', 'mpg', '3gp', '3g2', 'mts'].includes(e)) return 'video'
	if (['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma', 'opus', 'aiff', 'alac'].includes(e)) return 'audio'
	return 'other'
})

const mediaIcon = computed(() => {
	switch (mediaKind.value) {
		case 'image': return 'mdi:file-image'
		case 'video': return 'mdi:file-video'
		case 'audio': return 'mdi:file-music'
		default: return 'mdi:file-outline'
	}
})
</script>

<template>
	<div v-if="view === 'grid'" :key="media.id"
		class="relative overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:shadow-lg dark:border-neutral-700 dark:bg-neutral-800 flex flex-col"
		style="min-width:180px">
		<div class="aspect-square w-full relative overflow-hidden">
			<img ref="img" :src="media.thumbnail!" class="h-full w-full object-contain" alt="thumbnail" @load="handleImgLoad">
			<!-- Overlay -->
			<div
				class="absolute bottom-0 left-0 right-0 focus-within:opacity-100 transition bg-gradient-to-t from-black/70 via-black/10 to-transparent px-3 pb-2 pt-10 flex flex-col gap-2 text-white"
				style="pointer-events: none;">
				<div class="flex flex-col text-xs gap-0.5 pointer-events-auto">
					<span class="flex items-center gap-1 truncate">
						<Icon name="mdi:file-document-outline" size="14" /> {{ baseName }}
					</span>
					<div class="flex gap-6 justify-between">
						<span class="flex items-center gap-1">
							<Icon name="mdi:database" size="14" /> {{ formatedSize }}
						</span>
						<span v-if="aspect" class="flex items-center gap-1">
							<Icon name="mdi:aspect-ratio" size="14" /> {{ aspect }}
						</span>
						<span class="flex items-center gap-1">
							<Icon :name="mediaIcon" size="12" />
							<span class="uppercase">{{ ext }}</span>
						</span>
					</div>
				</div>
				<div class="flex gap-2 pointer-events-auto">
					<button class="bg-white/20 hover:bg-white/30 rounded p-1 flex items-center gap-1 backdrop-blur"
						@click.stop="emit('refetch', media.id)">
						<Icon name="mdi:refresh" size="16" />
					</button>
					<NuxtLink v-if="media.original" :to="media.original" external target="_blank"
						class="bg-white/20 hover:bg-white/30 rounded p-1 flex items-center gap-1 backdrop-blur">
						<Icon name="mdi:eye" size="16" />
					</NuxtLink>
					<NuxtLink v-if="mediaKind === 'image'" :to="`/media/${media.name}/w_1024&q_80`" target="_blank"
						class="ml-auto bg-white/20 hover:bg-white/30 rounded p-1 flex items-center gap-1 backdrop-blur">
						<Icon name="mdi:share" size="16" />
					</NuxtLink>
				</div>
			</div>
		</div>
	</div>
	<!-- List view: overlay floats left of info for consistency, or info inline -->
	<div v-else
		class="relative overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:shadow-lg dark:border-neutral-700 dark:bg-neutral-800 flex items-center">
		<img ref="img" class="h-16 w-16 rounded-md m-2 object-cover" :src="media.thumbnail!" alt="thumbnail"
			@load="handleImgLoad">
		<div class="flex flex-col gap-1 min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<span class="font-medium truncate flex items-center gap-1">
					<Icon name="mdi:document" size="14" /> {{ media.name }}
				</span>
				<NuxtLink v-if="media.original" :to="media.original" external target="_blank"
					class="ml-auto bg-white/20 hover:bg-white/30 rounded p-1 flex items-center gap-1 backdrop-blur">
					<Icon name="mdi:eye" size="14" />
				</NuxtLink>
				<button class="bg-white/20 hover:bg-white/30 rounded p-1 flex items-center gap-1 backdrop-blur"
					@click.stop="emit('refetch', media.id)">
					<Icon name="mdi:refresh" size="14" />
				</button>
			</div>
			<div class="flex gap-2 text-sm text-neutral-500 dark:text-neutral-400">
				<span class="flex items-center gap-1">
					<Icon name="mdi:database" size="14" /> {{ formatedSize }}
				</span>
				<template v-if="aspect">
					<span class="flex items-center gap-1">
						<Icon name="mdi:aspect-ratio" size="14" /> {{ aspect }}
					</span>
				</template>
			</div>
		</div>
	</div>
</template>
