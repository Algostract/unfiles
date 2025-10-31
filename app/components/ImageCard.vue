<script setup lang="ts">
const props = defineProps<{
  view: 'grid' | 'list'
  media: {
    index: string
    name: string
    mime: string | false
    size: number
    thumbnail: string
    image: string
    driveUri: string
  }
}>()

const img = ref<HTMLImageElement | null>(null)
const aspect = ref<string | null>(null)

const mediaFormatedSize = computed(() => {
  if (!props.media.size) return '?'
  if (props.media.size > 1e9) return (props.media.size / 1e9).toFixed(2) + ' GB'
  if (props.media.size > 1e6) return (props.media.size / 1e6).toFixed(2) + ' MB'
  if (props.media.size > 1e3) return (props.media.size / 1e3).toFixed(2) + ' KB'
  return props.media.size + ' B'
})

const mediaBaseName = computed(() => {
  const n = props.media.name || ''
  const i = n.lastIndexOf('.')
  return i > 0 ? n.slice(0, i) : n
})

const mediaKind = computed<'image' | 'video' | 'audio' | 'other'>(() => {
  return props.media.mime && (props.media.mime.split('/')[0] as 'image' | 'video' | 'audio' | 'other')
})

const mediaExt = computed(() => {
  return props.media.mime && props.media.mime.split('/')[1]
})

const mediaIcon = computed(() => {
  switch (mediaKind.value) {
    case 'image':
      return 'lucide:file-image'
    case 'video':
      return 'lucide:file-video'
    case 'audio':
      return 'lucide:file-music'
    default:
      return 'lucide:file-text'
  }
})

onMounted(() => {
  if (img.value && img.value.complete) {
    aspect.value = img.value.naturalWidth && img.value.naturalHeight ? `${img.value.naturalWidth}:${img.value.naturalHeight}` : null
  }
})

const showRenamePopup = ref(false)
const newName = ref(props.media.name)
const saving = ref(false)
const error = ref('')

// Emit save event (send new name and media id to parent)
async function handleAction(action: 'rename' | 'thumbnail') {
  saving.value = true
  error.value = ''
  try {
    // Emit to parent, you can change the payload structure as needed
    const res = await $fetch('/api/project/:projectId/asset/:assetId', {
      method: 'PUT',
      body: {
        action,
        uri: props.media.driveUri,
        name: newName.value,
      },
    })

    console.log(res)

    showRenamePopup.value = false
  } catch (e) {
    error.value = (e as Error).message || 'Rename failed'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div
    v-if="view === 'grid'"
    :key="media.index"
    class="relative flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
    style="min-width: 180px">
    <div class="relative aspect-square w-full overflow-hidden">
      <img ref="img" :src="media.thumbnail!" class="h-full w-full object-contain" alt="thumbnail" />
      <!-- Overlay -->
      <div
        class="absolute bottom-0 left-0 right-0 flex flex-col gap-2 bg-gradient-to-t from-black/70 via-black/10 to-transparent px-3 pb-2 pt-10 text-white transition focus-within:opacity-100"
        style="pointer-events: none">
        <div class="pointer-events-auto flex flex-col gap-0.5 text-xs">
          <span class="flex items-center gap-1 truncate"> <NuxtIcon name="lucide:file" size="14" /> {{ mediaBaseName }} </span>
          <div class="flex justify-between gap-6">
            <span class="flex items-center gap-1"> <NuxtIcon name="lucide:database" size="14" /> {{ mediaFormatedSize }} </span>
            <span v-if="aspect" class="flex items-center gap-1"> <NuxtIcon name="lucide:aspect-ratio" size="14" /> {{ aspect }} </span>
            <span class="flex items-center gap-1">
              <NuxtIcon :name="mediaIcon" size="12" />
              <span class="uppercase">{{ mediaExt }}</span>
            </span>
          </div>
        </div>
        <div class="pointer-events-auto flex gap-2">
          <button class="flex items-center gap-1 rounded bg-white/20 p-1 backdrop-blur hover:bg-white/30" @click.stop="handleAction('thumbnail')">
            <NuxtIcon name="lucide:refresh-cw" size="16" />
          </button>
          <NuxtLink v-if="media.image" :to="media.image" external target="_blank" class="flex items-center gap-1 rounded bg-white/20 p-1 backdrop-blur hover:bg-white/30">
            <NuxtIcon name="lucide:eye" size="16" />
          </NuxtLink>
          <NuxtLink
            v-if="mediaKind === 'image'"
            :to="`/media/w_1024&q_80/${mediaBaseName}`"
            target="_blank"
            class="ml-auto flex items-center gap-1 rounded bg-white/20 p-1 backdrop-blur hover:bg-white/30">
            <NuxtIcon name="lucide:share" size="16" />
          </NuxtLink>
          <button class="flex items-center gap-1 rounded bg-white/20 p-1 backdrop-blur hover:bg-white/30" @click.stop="showRenamePopup = true">
            <NuxtIcon name="lucide:edit-3" size="16" />
          </button>
        </div>
      </div>
    </div>
  </div>
  <!-- List view: overlay floats left of info for consistency, or info inline -->
  <div v-else class="relative flex items-center overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
    <img ref="img" class="m-2 h-16 w-16 rounded-md object-cover" :src="media.thumbnail!" alt="thumbnail" />
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div class="ml-auto flex items-center gap-2">
        <button class="flex items-center gap-1 rounded bg-white/20 p-1 backdrop-blur hover:bg-white/30" @click.stop="handleAction('thumbnail')">
          <NuxtIcon name="lucide:refresh-cw" size="16" />
        </button>
        <NuxtLink v-if="media.image" :to="media.image" external target="_blank" class="flex items-center gap-1 rounded bg-white/20 p-1 backdrop-blur hover:bg-white/30">
          <NuxtIcon name="lucide:eye" size="16" />
        </NuxtLink>
        <NuxtLink v-if="mediaKind === 'image'" :to="`/media/w_1024&q_80/${mediaBaseName}`" target="_blank" class="flex items-center gap-1 rounded bg-white/20 p-1 backdrop-blur hover:bg-white/30">
          <NuxtIcon name="lucide:share" size="16" />
        </NuxtLink>
        <button class="flex items-center gap-1 rounded bg-white/20 p-1 backdrop-blur hover:bg-white/30" @click.stop="showRenamePopup = true">
          <NuxtIcon name="lucide:edit-3" size="16" />
        </button>
      </div>
      <div class="flex gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <span class="flex items-center gap-1"> <NuxtIcon name="lucide:database" size="14" /> {{ mediaFormatedSize }} </span>
        <template v-if="aspect">
          <span class="flex items-center gap-1"> <NuxtIcon name="lucide:aspect-ratio" size="14" /> {{ aspect }} </span>
        </template>
      </div>
    </div>
  </div>

  <div v-if="showRenamePopup" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <div class="w-full max-w-xs rounded-xl bg-white p-6 shadow-lg dark:bg-neutral-900">
      <div class="mb-2 font-bold">Rename File</div>
      <input v-model="newName" class="mb-2 w-full rounded border px-2 py-1" :disabled="saving" />
      <div class="mt-2 flex justify-end gap-2">
        <button class="rounded bg-neutral-200 px-3 py-1 hover:bg-neutral-300" :disabled="saving" @click="showRenamePopup = false">Cancel</button>
        <button class="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700" :disabled="saving" @click="handleAction('rename')">Save</button>
      </div>
      <div v-if="error" class="mt-2 text-sm text-red-500">{{ error }}</div>
    </div>
  </div>
</template>
