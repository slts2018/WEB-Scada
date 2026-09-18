<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import {
  getModelThumbnail,
  invalidateModelThumbnail,
} from '@/shared/three/modelThumbnail'

const props = defineProps<{
  resourceId: string
  url: string
  /** 文件被替换时传入时间戳等，强制刷新 */
  bust?: string | number
  size?: number
}>()

const src = ref<string | null>(null)
const loading = ref(true)
const failed = ref(false)
let seq = 0

async function load() {
  const my = ++seq
  loading.value = true
  failed.value = false
  if (!props.url) {
    src.value = null
    failed.value = true
    loading.value = false
    return
  }
  const thumb = await getModelThumbnail(props.resourceId, props.url, {
    size: props.size ?? 128,
    bust: props.bust != null ? String(props.bust) : undefined,
  })
  if (my !== seq) return
  src.value = thumb
  failed.value = !thumb
  loading.value = false
}

watch(
  () => [props.resourceId, props.url, props.bust, props.size] as const,
  () => {
    void load()
  },
)

onMounted(() => {
  void load()
})

defineExpose({
  reload: () => {
    invalidateModelThumbnail(props.resourceId)
    return load()
  },
})
</script>

<template>
  <div class="thumb" :style="{ width: `${size ?? 128}px`, height: `${size ?? 128}px` }">
    <img v-if="src" class="img" :src="src" alt="" draggable="false" />
    <span v-else-if="loading" class="state">…</span>
    <span v-else class="state">3D</span>
  </div>
</template>

<style scoped>
.thumb {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: #0f1218;
  border: 1px solid var(--scada-border, #2a3140);
}

.img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

.state {
  font-size: 11px;
  color: var(--scada-muted, #8b93a7);
  letter-spacing: 0.04em;
}
</style>
