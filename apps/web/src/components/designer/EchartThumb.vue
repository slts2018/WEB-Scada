<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { isMapPreset } from '@/shared/echart/catalog'
import { ensureGeo, geoReady } from '@/shared/echart/geo'
import { renderEchartThumb } from '@/shared/echart/render'

const props = defineProps<{ variant: string }>()
const src = ref('')

function paint() {
  const canvas = renderEchartThumb(props.variant)
  src.value = canvas ? canvas.toDataURL('image/png') : ''
}

onMounted(() => {
  paint()
  if (isMapPreset(props.variant) && !geoReady()) void ensureGeo().then(paint)
})
</script>

<template>
  <img v-if="src" class="shot" :src="src" alt="" draggable="false" />
</template>

<style scoped>
.shot {
  width: 100%;
  height: 84px;
  object-fit: contain;
  background: #0b1220;
  border-radius: 4px;
  pointer-events: none;
}
</style>
