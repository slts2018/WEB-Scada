<script setup lang="ts">
import { useOutputLogStore } from '@/stores/outputLog'

const log = useOutputLogStore()

function formatTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleTimeString()
}
</script>

<template>
  <div class="output-panel">
    <div class="ops">
      <el-button size="small" text @click="log.clear()">清空</el-button>
    </div>
    <ul v-if="log.list.length" class="lines">
      <li v-for="item in log.list" :key="item.id" :class="item.level">
        <span class="t">{{ formatTime(item.time) }}</span>
        <span class="s">[{{ item.source }}]</span>
        <span class="m">{{ item.message }}</span>
      </li>
    </ul>
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
  list-style: none;
  margin: 0;
  padding: 0 10px 8px;
  overflow: auto;
  flex: 1;
}

.lines li {
  display: flex;
  gap: 8px;
  padding: 2px 0;
  line-height: 1.45;
  color: var(--scada-text);
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
  word-break: break-all;
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
