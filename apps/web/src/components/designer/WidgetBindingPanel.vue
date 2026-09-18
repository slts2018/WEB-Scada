<script setup lang="ts">
import { computed } from 'vue'
import { animationLinkTypeLabel } from '@web-scada/core'
import { useProjectStore } from '@/stores/project'

const project = useProjectStore()
const widget = computed(() => project.selectedWidget)
const links = computed(() => widget.value?.animationLinks ?? [])
</script>

<template>
  <div v-if="widget" class="anim-summary">
    <el-button type="primary" size="small" style="width: 100%" @click="project.openAnimationConnection()">
      动画连接…
    </el-button>
    <div v-if="links.length" class="summary-list">
      <div v-for="l in links" :key="l.id" class="summary-item">
        <span>{{ animationLinkTypeLabel(l.type) }}</span>
        <el-tag size="small" :type="l.enabled ? 'success' : 'info'">
          {{ l.enabled ? '已激活' : '未激活' }}
        </el-tag>
      </div>
    </div>
    <p v-else class="hint">也可在画布上右键 → 动画连接</p>
    <div class="quick">
      <el-button size="small" plain @click="project.openAnimationConnection('property')">
        属性绑定
      </el-button>
      <el-button size="small" plain @click="project.openAnimationConnection('event')">
        事件绑定
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.anim-summary {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}

.summary-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 4px;
  background: #12151c;
  border: 1px solid var(--scada-border);
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--scada-muted);
}

.quick {
  display: flex;
  gap: 6px;
}
</style>
