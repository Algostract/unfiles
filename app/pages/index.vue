<script setup lang="ts">
const query = ref<string>('')
const sort = ref<'Relevance' | 'Newest' | 'Oldest'>('Relevance')
const view = ref<'grid' | 'list'>('grid')

const sortItems = ['Relevance', 'Newest', 'Oldest'] as const

const { data: project } = await useFetch('/api/project')

if (!project.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
}

const filteredProjects = computed(() => {
  const q = query.value.trim().toLowerCase()
  let arr = project.value?.filter(({ name }) => name.toLowerCase().includes(q)) ?? []
  if (sort.value === 'Newest') arr = [...arr].reverse()
  if (sort.value === 'Oldest') arr = [...arr]
  return arr
})

/* Dark mode toggle using the 'dark' class on <html> */
const isDark = ref(false)
const applyDark = (v: boolean) => {
  const root = document.documentElement
  root.classList.toggle('dark', v)
  localStorage.setItem('theme:dark', v ? '1' : '0')
  isDark.value = v
}
const toggleDark = () => applyDark(!isDark.value)

onMounted(() => {
  const saved = localStorage.getItem('theme:dark')
  applyDark(saved === '1')
})

const showFileUpload = ref(false)
function toggleFileUpload(value: boolean) {
  showFileUpload.value = value
}

function uploadFiles(files?: File[]) {
  toggleFileUpload(false)

  if (!(files && files.length)) return

  console.log({ files })
}
</script>

<template>
  <div class="min-h-screen bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
    <div class="container mx-auto px-4 py-6">
      <!-- Top bar -->
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <!-- Home icon -->
          <NuxtIcon name="lucide:home" class="h-4 w-4" />
          <span>Home</span>
        </div>

        <div class="flex items-center gap-2">
          <!-- Color mode button -->
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            aria-label="Toggle theme"
            title="Toggle theme"
            @click="toggleDark">
            <NuxtIcon v-if="!isDark" name="lucide:sun" class="h-4 w-4" />

            <NuxtIcon v-else name="lucide:moon" class="h-4 w-4" />
          </button>

          <button
            type="button"
            class="font-medium inline-flex h-8 items-center justify-center gap-2 rounded-md bg-neutral-900 px-3 text-sm text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            @click="toggleFileUpload(true)">
            <NuxtIcon name="lucide:upload" class="h-4 w-4" />
            <span>Upload Files</span>
          </button>
        </div>
      </div>

      <!-- Controls -->
      <div class="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div class="flex items-center gap-3">
          <span class="text-sm text-neutral-500 dark:text-neutral-400">Sort by:</span>
          <select
            v-model="sort"
            class="h-8 w-40 rounded-md border border-neutral-200 bg-white px-2 text-sm text-neutral-700 outline-none ring-0 focus:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
            <option v-for="o in sortItems" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>

        <div class="flex items-center gap-3">
          <!-- Search -->
          <label class="relative block">
            <span class="absolute inset-y-0 left-3 flex items-center text-neutral-400">
              <NuxtIcon name="lucide:search" class="h-4 w-4" />
            </span>
            <input
              v-model="query"
              type="text"
              placeholder="Search Media Library"
              class="h-8 w-full rounded-md border border-neutral-200 bg-white pl-9 pr-3 text-sm text-neutral-700 placeholder-neutral-400 outline-none focus:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
          </label>

          <!-- View toggle -->
          <div class="flex overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
            <button
              type="button"
              :class="[
                'inline-flex h-8 w-9 items-center justify-center text-neutral-600 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-700',
                view === 'grid' ? 'bg-neutral-100 dark:bg-neutral-700' : 'bg-transparent',
              ]"
              aria-label="Grid view"
              title="Grid view"
              @click="view = 'grid'">
              <NuxtIcon name="lucide:layout-grid" class="h-4 w-4" />
            </button>
            <button
              type="button"
              :class="[
                'inline-flex h-8 w-9 items-center justify-center text-neutral-600 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-700',
                view === 'list' ? 'bg-neutral-100 dark:bg-neutral-700' : 'bg-transparent',
              ]"
              aria-label="List view"
              title="List view"
              @click="view = 'list'">
              <NuxtIcon name="lucide:list" class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <!-- Count -->
      <p class="mt-6 text-sm text-neutral-500 dark:text-neutral-400">Showing {{ filteredProjects?.length }} items</p>

      <!-- Grid/List -->
      <div v-if="view === 'grid'" class="flex flex-col gap-12">
        <div v-for="filteredProject in filteredProjects" :key="filteredProject.id" class="mt-4 grid gap-6 bg-light-500 p-8 dark:bg-dark-500">
          <h1>{{ filteredProject.name }}</h1>
          <div class="grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            <ImageCard v-for="mediaItem in filteredProject.media" :key="mediaItem.id" view="grid" :media="mediaItem" />
          </div>
        </div>
      </div>

      <div v-else class="mt-4 space-y-4">
        <div v-for="filteredProject in filteredProjects" :key="filteredProject.id">
          <ImageCard v-for="mediaItem in filteredProject.media" :key="mediaItem.id" view="list" :media="mediaItem" />
        </div>
      </div>
    </div>
    <FileUpload :show="showFileUpload" @close="uploadFiles" />
  </div>
</template>
