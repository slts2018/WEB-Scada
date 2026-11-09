<script setup lang="ts">
import { computed } from 'vue'
import { animationLinkTypeLabel } from '@web-scada/core'
import HelpTip from '@/components/designer/HelpTip.vue'
import { useProjectStore } from '@/stores/project'

const project = useProjectStore()
const widget = computed(() => project.selectedWidget)
const links = computed(() => widget.value?.animationLinks ?? [])
</script>

<template>
  <div v-if="widget" class="anim-summary">
    <div class="anim-head">
      <el-button type="primary" size="small" @click="project.openAnimationConnection()">
        动画连接…
      </el-button>
      <HelpTip content="也可在画布上右键 → 动画连接" />
    </div>
    <div v-if="links.length" class="summary-list">
      <div v-for="l in links" :key="l.id" class="summary-item">
        <span>{{ animationLinkTypeLabel(l.type) }}</span>
        <el-tag size="small" :type="l.enabled ? 'success' : 'info'">
          {{ l.enabled ? '已激活' : '未激活' }}
        </el-tag>
      </div>
    </div>
  </div>
</template>

<style scoped>
.anim-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.anim-head .el-button {
  flex: 1;
}

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
</style>
