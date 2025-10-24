<script setup lang="ts">
defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'close', files?: File[]): void
}>()

const dragActive = ref(false)

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  dragActive.value = true
}

function handleDragLeave() {
  dragActive.value = false
}

function handleInput(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files && files.length) {
    emit('close', Array.from(files))
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  dragActive.value = false
  if (e.dataTransfer?.files && e.dataTransfer.files.length) {
    emit('close', Array.from(e.dataTransfer.files))
  }
}

/* 
TODO: use vueuse
function handleEsc(e: KeyboardEvent) {
	if (e.key === 'Escape') emit('close')
}

onMounted(() => {
	window.addEventListener('keydown', handleEsc)
})
onUnmounted(() => {
	window.removeEventListener('keydown', handleEsc)
}) */
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="emit('close')">
      <div class="relative w-full max-w-md rounded-md bg-neutral-100 px-8 py-10 text-center dark:bg-neutral-900">
        <!-- Close button top right -->
        <button
          type="button"
          class="absolute right-3 top-3 block size-7 rounded-sm bg-neutral-100 p-1 text-neutral-600 transition hover:bg-neutral-200 hover:text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
          aria-label="Close"
          @click="emit('close')">
          <NuxtIcon name="lucide:x" class="size-5" />
        </button>
        <h2 class="font-semibold mb-7 text-lg">Upload Media</h2>
        <!-- Drag area only -->
        <label class="block cursor-pointer select-none" tabindex="0">
          <div
            class="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-400 bg-neutral-50 py-16 transition-colors hover:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
            :class="{ 'border-blue-500 bg-blue-50 dark:bg-blue-950': dragActive }"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @drop="handleDrop">
            <NuxtIcon name="lucide:upload" class="h-10 w-10 text-blue-500" />
            <span class="font-semibold mb-2 mt-1 block text-lg">Drop files here to upload</span>
            <span class="mb-2 block text-sm text-neutral-500 dark:text-neutral-400">or click to browse</span>
          </div>
          <input type="file" multiple accept="image/*,video/*" class="hidden" aria-label="Upload files" @change="handleInput" />
        </label>
      </div>
    </div>
  </transition>
</template>
