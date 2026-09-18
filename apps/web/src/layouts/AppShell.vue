<script setup lang="ts">
import { RouterLink } from 'vue-router'

defineProps<{
  mode: 'designer' | 'runtime'
  title: string
}>()
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="logo">SCADA</span>
        <span class="mode">{{ title }}</span>
      </div>
      <nav class="nav">
        <RouterLink
          class="nav-link"
          :class="{ active: mode === 'designer' }"
          to="/designer"
        >
          设计端
        </RouterLink>
        <RouterLink
          class="nav-link"
          :class="{ active: mode === 'runtime' }"
          to="/runtime"
        >
          运行端
        </RouterLink>
      </nav>
      <div class="actions">
        <slot name="actions" />
      </div>
    </header>
    <main class="main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--scada-bg);
}

.topbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--scada-border);
  background: var(--scada-panel);
}

.brand {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.logo {
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--scada-accent);
}

.mode {
  color: var(--scada-muted);
  font-size: 13px;
}

.nav {
  display: flex;
  gap: 4px;
}

.nav-link {
  padding: 6px 14px;
  border-radius: 6px;
  color: var(--scada-muted);
  font-size: 13px;
}

.nav-link:hover {
  color: var(--scada-text);
  background: rgba(255, 255, 255, 0.04);
}

.nav-link.active {
  color: var(--scada-text);
  background: rgba(61, 139, 253, 0.18);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.main {
  flex: 1;
  min-height: 0;
}
</style>
