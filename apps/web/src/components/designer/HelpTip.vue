<script setup lang="ts">
defineProps<{
  content: string
}>()
</script>

<template>
  <el-tooltip :content="content" placement="top" :show-after="200">
    <span class="help-tip" aria-label="说明" @click.stop>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4" />
        <path
          d="M5.8 6.1a2.2 2.2 0 0 1 4.3.7c0 1.2-1.1 1.7-1.7 2.1-.4.3-.6.5-.6 1"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
        />
        <circle cx="8" cy="12" r="0.85" fill="currentColor" />
      </svg>
    </span>
  </el-tooltip>
</template>

<style scoped>
.help-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--el-text-color-secondary);
  cursor: help;
  flex-shrink: 0;
  vertical-align: middle;
  border-radius: 50%;
}
.help-tip:hover {
  color: var(--el-color-primary);
}
</style>
