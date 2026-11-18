<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useOutputLogStore } from '@/stores/outputLog'

const log = useOutputLogStore()

/** 固定行高以便虚拟滚动；超长消息单行省略，避免逐条测量 */
const ROW_H = 22
const OVERSCAN = 8

const scroller = ref<HTMLElement | null>(null)
const viewportH = ref(160)
const scrollTop = ref(0)

function formatTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleTimeString()
}

const total = computed(() => log.paneList.length)
const start = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN))
const visibleCount = computed(() => Math.ceil((viewportH.value || ROW_H) / ROW_H) + OVERSCAN * 2)
const end = computed(() => Math.min(total.value, start.value + visibleCount.value))
const visible = computed(() => log.paneList.slice(start.value, end.value))
const totalH = computed(() => total.value * ROW_H)

function onScroll(e: Event) {
  const el = e.currentTarget as HTMLElement
  scrollTop.value = el.scrollTop
}

function measure() {
  if (scroller.value) viewportH.value = scroller.value.clientHeight
}

let ro: ResizeObserver | null = null
onMounted(() => {
  measure()
  if (scroller.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => measure())
    ro.observe(scroller.value)
  }
})
onUnmounted(() => {
  ro?.disconnect()
  ro = null
})

watch(
  () => log.paneList.length,
  async (n) => {
    if (n === 0) {
      scrollTop.value = 0
      await nextTick()
      if (scroller.value) scroller.value.scrollTop = 0
    }
  },
)
</script>

<template>
  <div class="output-panel">
    <div class="ops">
      <el-button size="small" text @click="log.clear()">清空</el-button>
    </div>
    <div v-if="total" ref="scroller" class="lines" @scroll.passive="onScroll">
      <div class="sizer" :style="{ height: totalH + 'px' }">
        <div
          v-for="(item, i) in visible"
          :key="item.id"
          class="line"
          :class="item.level"
          :style="{ top: (start + i) * ROW_H + 'px', height: ROW_H + 'px' }"
        >
          <span class="t">{{ formatTime(item.time) }}</span>
          <span class="s">[{{ item.source }}]</span>
          <span class="m">{{ item.message }}</span>
        </div>
      </div>
    </div>
    <div v-else class="empty">暂无输出</div>
  </div>
</template>

<style scoped>
.output-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
}

.ops {
  display: flex;
  justify-content: flex-end;
  padding: 0 8px;
  flex-shrink: 0;
}

.lines {
  margin: 0;
  padding: 0 10px 8px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.sizer {
  position: relative;
  width: 100%;
}

.line {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 0;
  line-height: 1.45;
  color: var(--scada-text);
  box-sizing: border-box;
  overflow: hidden;
}

.t {
  color: var(--scada-muted);
  flex-shrink: 0;
}

.s {
  color: #7dd3fc;
  flex-shrink: 0;
}

.m {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.info .m {
  color: var(--scada-text);
}

.success .m {
  color: #4ade80;
}

.warn .m {
  color: #fbbf24;
}

.error .m {
  color: #f87171;
}

.empty {
  padding: 12px;
  color: var(--scada-muted);
}
</style>
