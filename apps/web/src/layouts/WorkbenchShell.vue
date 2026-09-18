<script setup lang="ts">
import { computed, ref, useSlots, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    mode: 'designer' | 'runtime'
    title?: string
    leftVisible?: boolean
    rightVisible?: boolean
    outputVisible?: boolean
    /** 运行端默认收起右侧 */
    defaultRightCollapsed?: boolean
    defaultOutputCollapsed?: boolean
  }>(),
  {
    title: '',
    leftVisible: true,
    rightVisible: true,
    outputVisible: true,
    defaultRightCollapsed: false,
    defaultOutputCollapsed: false,
  },
)

const emit = defineEmits<{
  'update:leftVisible': [boolean]
  'update:rightVisible': [boolean]
  'update:outputVisible': [boolean]
}>()

const slots = useSlots()
const leftTab = ref<'nav' | 'object' | 'property'>('nav')
const rightCollapsed = ref(props.defaultRightCollapsed)
const outputCollapsed = ref(props.defaultOutputCollapsed)

watch(
  () => props.defaultRightCollapsed,
  (v) => {
    rightCollapsed.value = v
  },
)

const showLeft = computed(() => props.leftVisible)
const showRight = computed(() => props.rightVisible && !rightCollapsed.value)
const showOutput = computed(() => props.outputVisible && !outputCollapsed.value)
const hasRightSlot = computed(() => Boolean(slots.right))

watch(
  () => props.rightVisible,
  (on) => {
    if (on) rightCollapsed.value = false
  },
)
watch(
  () => props.outputVisible,
  (on) => {
    if (on) outputCollapsed.value = false
  },
)

function toggleLeft() {
  emit('update:leftVisible', !props.leftVisible)
}
function toggleRightPanel() {
  if (!props.rightVisible) {
    emit('update:rightVisible', true)
    rightCollapsed.value = false
    return
  }
  rightCollapsed.value = !rightCollapsed.value
}
function toggleOutput() {
  if (!props.outputVisible) {
    emit('update:outputVisible', true)
    outputCollapsed.value = false
    return
  }
  outputCollapsed.value = !outputCollapsed.value
}

defineExpose({
  leftTab,
  toggleLeft,
  toggleRightPanel,
  toggleOutput,
  setLeftTab: (tab: 'nav' | 'object' | 'property') => {
    leftTab.value = tab
  },
})
</script>

<template>
  <div class="workbench">
    <header class="chrome">
      <div class="menubar">
        <div class="brand">
          <span class="logo">Flight</span>
          <span class="sub">{{ title || (mode === 'designer' ? '设计端' : '运行端') }}</span>
        </div>
        <div class="menu-slot">
          <slot name="menu" />
        </div>
      </div>
      <div class="toolbar">
        <slot name="toolbar" />
      </div>
    </header>

    <div class="body">
      <aside v-show="showLeft" class="left">
        <div class="tab-row">
          <button
            type="button"
            class="tab"
            :class="{ active: leftTab === 'nav' }"
            @click="leftTab = 'nav'"
          >
            页面
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: leftTab === 'object' }"
            @click="leftTab = 'object'"
          >
            对象浏览器
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: leftTab === 'property' }"
            @click="leftTab = 'property'"
          >
            属性
          </button>
        </div>
        <div class="left-body">
          <div v-show="leftTab === 'nav'" class="scroll">
            <slot name="left-nav" />
          </div>
          <div v-show="leftTab === 'object'" class="scroll">
            <slot name="left-object" />
          </div>
          <div v-show="leftTab === 'property'" class="scroll">
            <slot name="left-property" />
          </div>
        </div>
      </aside>

      <section class="center">
        <slot name="center" />
      </section>

      <aside v-if="hasRightSlot" v-show="showRight" class="right">
        <div class="dock-title row">
          <span>控件库</span>
          <button type="button" class="icon-btn" title="收起" @click="rightCollapsed = true">
            »
          </button>
        </div>
        <div class="scroll">
          <slot name="right" />
        </div>
      </aside>

      <button
        v-if="hasRightSlot && props.rightVisible && rightCollapsed"
        type="button"
        class="right-rail"
        title="展开控件库"
        @click="rightCollapsed = false"
      >
        控件库
      </button>
    </div>

    <section v-show="showOutput" class="output">
      <div class="dock-title row">
        <span>输出栏</span>
        <button type="button" class="icon-btn" title="收起" @click="outputCollapsed = true">
          ▬
        </button>
      </div>
      <div class="output-body">
        <slot name="output" />
      </div>
    </section>

    <footer class="status">
      <slot name="status" />
    </footer>
  </div>
</template>

<style scoped>
.workbench {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--scada-bg);
  color: var(--scada-text);
}

.chrome {
  flex-shrink: 0;
  border-bottom: 1px solid var(--scada-border);
  background: var(--scada-panel);
}

.menubar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  padding: 0 10px;
  border-bottom: 1px solid var(--scada-border);
}

.brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-shrink: 0;
}

.logo {
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--scada-accent);
  font-size: 13px;
}

.sub {
  font-size: 12px;
  color: var(--scada-muted);
}

.menu-slot {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 4px 10px;
  flex-wrap: wrap;
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
}

.left {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--scada-border);
  background: var(--scada-panel);
  min-height: 0;
}

.left-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.left-body .scroll,
.right .scroll {
  flex: 1;
  min-height: 0;
}

.tab-row {
  display: flex;
  border-bottom: 1px solid var(--scada-border);
  flex-shrink: 0;
}

.tab {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--scada-muted);
  font-size: 12px;
  padding: 7px 4px;
  cursor: pointer;
}

.tab.active {
  color: var(--scada-text);
  background: rgba(61, 139, 253, 0.12);
  box-shadow: inset 0 -2px 0 var(--scada-accent);
}

.scroll {
  overflow: auto;
  padding: 8px;
}

.dock-title {
  flex-shrink: 0;
  padding: 6px 10px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--scada-muted);
  border-bottom: 1px solid var(--scada-border);
  background: #12151c;
}

.dock-title.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.center {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #0b0d11;
}

.right {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--scada-border);
  background: var(--scada-panel);
}

.right-rail {
  position: absolute;
  right: 0;
  top: 40%;
  writing-mode: vertical-rl;
  border: 1px solid var(--scada-border);
  border-right: none;
  background: var(--scada-panel);
  color: var(--scada-muted);
  font-size: 11px;
  padding: 10px 4px;
  cursor: pointer;
  border-radius: 6px 0 0 6px;
  z-index: 2;
}

.right-rail:hover {
  color: var(--scada-text);
  background: #1c212b;
}

.icon-btn {
  border: none;
  background: transparent;
  color: var(--scada-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0 4px;
}

.icon-btn:hover {
  color: var(--scada-text);
}

.output {
  flex-shrink: 0;
  height: 120px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--scada-border);
  background: var(--scada-panel);
}

.output-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.status {
  flex-shrink: 0;
  height: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 10px;
  border-top: 1px solid var(--scada-border);
  background: #12151c;
  font-size: 11px;
  color: var(--scada-muted);
}
</style>
