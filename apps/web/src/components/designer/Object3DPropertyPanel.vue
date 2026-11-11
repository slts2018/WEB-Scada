<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type {
  AnimationLinkFlow,
  Object3DPanel,
  Page2D,
  Page3DPresentation,
} from '@web-scada/core'
import {
  animationLinkTypeLabel,
  createDefaultObject3DPanel,
  DEFAULT_PAGE3D_PRESENTATION,
  DEFAULT_PANEL_CONTENT_HEIGHT,
  DEFAULT_PANEL_CONTENT_WIDTH,
  MAX_PANEL_CONTENT_SIZE,
  MIN_PANEL_CONTENT_HEIGHT,
  MIN_PANEL_CONTENT_WIDTH,
  patchObject3dSizeMeters,
  resolvePage3DPresentation,
  resolvePanelContentSize,
  sizeMetersFromObject3d,
} from '@web-scada/core'
import HelpTip from '@/components/designer/HelpTip.vue'
import { useProjectStore } from '@/stores/project'

const project = useProjectStore()
const obj = computed(() => project.selectedObject3d)
const multiCount = computed(() => project.selectedObject3dIds.length)
const page3d = computed(() => project.activePage3d)
const scenePres = computed(() => resolvePage3DPresentation(page3d.value?.presentation))
/** 场景 / 对象属性分类：默认全部展开 */
const sceneCollapse = ref<string[]>(['env', 'grid', 'sun', 'camera'])
const objectCollapse = ref<string[]>(['basic', 'transform', 'panel', 'liquid', 'flow', 'animLink'])

/** 纯面板：无模型，属性栏不显示旋转，缩放改控面板宽高 */
const isPanelOnly = computed(
  () => Boolean(obj.value?.panel) && !obj.value?.modelResourceId,
)

const animLinks = computed(() => obj.value?.animationLinks ?? [])

/** 当前选中的是液位层（配置入口在「液位」对话框里） */
const liquid = computed(() => obj.value?.liquid ?? null)
/** 流动连接挂在主选对象上（配置入口在「流动」对话框里） */
const flowLink = computed(() => {
  const link = (obj.value?.animationLinks ?? []).find((l) => l.type === 'flow')
  return link as AnimationLinkFlow | undefined
})
const FLOW_STYLE_LABELS: Record<string, string> = {
  skin: '贴皮箭头',
  ribbon: '浮空箭头',
  chevron: '管面斜箭',
  arrow: '锥形箭头',
  stripe: '条纹',
}
const flowStyleLabel = computed(
  () => FLOW_STYLE_LABELS[flowLink.value?.style ?? 'skin'] ?? '贴皮箭头',
)

const sizeMeters = computed(() =>
  obj.value ? sizeMetersFromObject3d(obj.value) : ([0, 0, 0] as [number, number, number]),
)

/** 变换栏的等比开关。只影响接下来的尺寸输入，不写入工程。 */
const scaleUniform = ref(true)

function patch(partial: Partial<NonNullable<typeof obj.value>>) {
  if (!obj.value) return
  project.updateObject3d(obj.value.id, partial as never)
}

function patchPresentation(partial: Partial<Page3DPresentation>) {
  project.updatePage3dPresentation(partial)
}

function formatCam(n: number) {
  return Number.isFinite(n) ? n.toFixed(2) : '--'
}

function captureDefaultCamera() {
  project.requestScene3dCamera('capture')
}

function applyDefaultCamera() {
  if (!page3d.value?.camera) {
    ElMessage.warning('尚未保存默认视角，请先「设为默认视角」')
    return
  }
  project.requestScene3dCamera('apply')
}

function resetPresentationDefaults() {
  project.updatePage3dPresentation({ ...DEFAULT_PAGE3D_PRESENTATION })
  ElMessage.success('已恢复场景默认观感')
}

function groupMulti() {
  if (project.selectedObject3dIds.length < 2) {
    ElMessage.warning('请先多选至少 2 个对象')
    return
  }
  const g = project.groupSelectedObject3ds()
  if (!g) ElMessage.warning('只能组合同一层级下的对象')
  else ElMessage.success(`已组合为「${g.name}」`)
}

function updateTransform(
  axis: 'position' | 'rotation' | 'scale',
  index: 0 | 1 | 2,
  value: number,
) {
  if (!obj.value) return
  const next = [...obj.value.transform[axis]] as [number, number, number]
  next[index] = value
  patch({ transform: { ...obj.value.transform, [axis]: next } })
}

/**
 * 缩放栏在失焦或回车后才写入。打字中间的空值和 .000 不进模型，
 * 否则等比锁定会用这个半成品去乘另外两轴。
 */
function commitSizeMeters(index: 0 | 1 | 2, value: number | undefined | null) {
  if (value == null || !Number.isFinite(value)) return
  updateSizeMeters(index, value)
}

/** 缩放栏编辑的是轴向真实尺寸（米），三位小数。锁定时三轴乘同一个倍数。 */
function updateSizeMeters(index: 0 | 1 | 2, value: number) {
  if (!obj.value) return
  const cur = sizeMetersFromObject3d(obj.value)
  const safe = Math.max(0.001, value)
  let next: [number, number, number]
  if (scaleUniform.value && cur[index] > 1e-9) {
    const factor = safe / cur[index]
    next = [
      Math.max(0.001, cur[0] * factor),
      Math.max(0.001, cur[1] * factor),
      Math.max(0.001, cur[2] * factor),
    ]
  } else {
    next = [...cur]
    next[index] = safe
  }
  patch(patchObject3dSizeMeters(obj.value, next))
}

function updatePanelSize(wh: 'width' | 'height', value: number) {
  if (!obj.value?.panel) return
  const sized = resolvePanelContentSize(
    wh === 'width' ? value : obj.value.panel.width,
    wh === 'height' ? value : obj.value.panel.height,
  )
  patchPanel({ ...obj.value.panel, ...sized })
  const pageId = obj.value.panel.page2dId?.trim()
  if (pageId) {
    project.updatePageSettings(pageId, { width: sized.width, height: sized.height })
  }
}

function patchPanel(next: Object3DPanel | undefined) {
  patch({ panel: next })
}

function openPanelIn2dEditor() {
  if (!obj.value) return
  if (!isPanelOnly.value) {
    ElMessage.warning('跟镜头面板请从「基础图元」添加，不能挂在模型上')
    return
  }
  if (!obj.value.panel) {
    patchPanel(createDefaultObject3DPanel(obj.value.name || '操作面板'))
    project.ensurePanelPage2d(obj.value.id)
  }
  project.openObject3dPanelEditor(obj.value.id)
  if (!project.object3dPanelEditorOpen) ElMessage.warning('无法打开面板编辑器')
}

function openModelEditor() {
  if (!obj.value) return
  if (isPanelOnly.value) {
    ElMessage.warning('纯面板对象请使用「编辑 2D 内容」')
    return
  }
  project.openObject3dModelEditor()
}

const liquidHelp = computed(() => {
  const base =
    '给罐体加一层液体，变量驱动液位（0%~100%）。变量、量程、颜色、生成方式、内缩、罐壁透明度都在对话框里配。'
  if (!liquid.value) return base
  return `${base}液位层已锁定变换：位置与高度由连接 / 液面裁剪接管。`
})

const flowHelp = computed(() => {
  const batch = multiCount.value > 1 ? `对 ${multiCount.value} 个选中对象批量生效。` : ''
  return `管道流动：贴管壁滚动的箭头，速度由变量驱动（不依赖模型 UV）。变量、速度、样式、箭头长度、间隔、颜色都在对话框里配。${batch}运行时按变量速度滚动；变量为 0 或测点坏 → 停流并隐藏箭头。`
})

const panelSummary = computed(() => {
  const p = obj.value?.panel
  if (!p) return ''
  const id = p.page2dId?.trim()
  const page = id
    ? project.document.pages.find((x): x is Page2D => x.type === '2d' && x.id === id)
    : undefined
  if (page) return `${page.width}×${page.height}`
  return `${p.width}×${p.height}`
})
</script>

<template>
  <div v-if="multiCount > 1" class="prop3d">
    <div class="panel-title">
      已选 {{ multiCount }} 个对象
      <HelpTip content="属性编辑针对主选（列表首项）。可批量组合。" />
    </div>
    <div class="ops">
      <el-button size="small" @click="groupMulti">组合</el-button>
    </div>
    <div v-if="obj" class="panel-title">主选：{{ obj.name }}</div>
  </div>
  <div v-if="obj" class="prop3d object-edit">
    <el-collapse v-model="objectCollapse" class="scene-collapse">
      <el-collapse-item title="1 · 基础" name="basic">
        <label class="row">
          <span>名称</span>
          <el-input
            size="small"
            :model-value="obj.name"
            @update:model-value="(v: string) => patch({ name: v })"
          />
        </label>
        <div class="flag-line">
          <label>
            <span>颜色</span>
            <el-color-picker
              size="small"
              :model-value="obj.style?.color || '#3d8bfd'"
              @update:model-value="(v: string | null) => v && patch({ style: { ...obj!.style, color: v } })"
            />
          </label>
          <el-checkbox
            :model-value="obj.visible !== false"
            @update:model-value="(v: boolean | string | number) => patch({ visible: Boolean(v) })"
          >
            可见
          </el-checkbox>
          <el-checkbox
            :model-value="Boolean(obj.locked)"
            @update:model-value="(v: boolean | string | number) => patch({ locked: Boolean(v) })"
          >
            锁定变换
          </el-checkbox>
        </div>
        <template v-if="!isPanelOnly">
          <div class="sub-label">
            模型外观
            <HelpTip content="颜色、金属度/粗糙度与贴图；修改后写入工程并实时预览。" />
          </div>
          <el-button size="small" type="primary" style="width: 100%" @click="openModelEditor">
            编辑模型…
          </el-button>
        </template>
      </el-collapse-item>

      <el-collapse-item title="2 · 变换" name="transform">
        <div class="sub-label">位置</div>
        <div class="xyz">
          <el-input-number
            v-for="(axis, i) in (['X', 'Y', 'Z'] as const)"
            :key="'p' + axis"
            size="small"
            :disabled="Boolean(obj.locked)"
            :model-value="obj.transform.position[i]"
            :step="0.1"
            controls-position="right"
            @update:model-value="(v: number | undefined) => updateTransform('position', i as 0 | 1 | 2, Number(v) || 0)"
          />
        </div>
        <template v-if="!isPanelOnly">
          <div class="sub-label">旋转（°）</div>
          <div class="xyz">
            <el-input-number
              v-for="(axis, i) in (['X', 'Y', 'Z'] as const)"
              :key="'r' + axis"
              size="small"
              :disabled="Boolean(obj.locked)"
              :model-value="obj.transform.rotation[i]"
              :step="1"
              controls-position="right"
              @update:model-value="(v: number | undefined) => updateTransform('rotation', i as 0 | 1 | 2, Number(v) || 0)"
            />
          </div>
          <div class="sub-label scale-head">
            <span>缩放（米）</span>
            <button
              type="button"
              class="scale-lock"
              :class="{ on: scaleUniform }"
              :aria-pressed="scaleUniform"
              :disabled="Boolean(obj.locked)"
              @click="scaleUniform = !scaleUniform"
            >
              <span class="scale-lock-box" aria-hidden="true" />
              等比锁定
            </button>
          </div>
          <div class="xyz">
            <el-input-number
              v-for="(axis, i) in (['X', 'Y', 'Z'] as const)"
              :key="'s' + axis"
              size="small"
              :disabled="Boolean(obj.locked)"
              :model-value="sizeMeters[i]"
              :step="0.001"
              :min="0.001"
              :precision="3"
              controls-position="right"
              @change="(v: number | undefined) => commitSizeMeters(i as 0 | 1 | 2, v)"
            />
          </div>
        </template>
        <template v-else>
          <div class="sub-label">面板大小</div>
          <div class="xyz panel-size">
            <label>
              <span>宽</span>
              <el-input-number
                size="small"
                :disabled="Boolean(obj.locked)"
                :model-value="obj.panel?.width ?? DEFAULT_PANEL_CONTENT_WIDTH"
                :min="MIN_PANEL_CONTENT_WIDTH"
                :max="MAX_PANEL_CONTENT_SIZE"
                :step="8"
                controls-position="right"
                @update:model-value="(v: number | undefined) => updatePanelSize('width', Number(v) || DEFAULT_PANEL_CONTENT_WIDTH)"
              />
            </label>
            <label>
              <span>高</span>
              <el-input-number
                size="small"
                :disabled="Boolean(obj.locked)"
                :model-value="obj.panel?.height ?? DEFAULT_PANEL_CONTENT_HEIGHT"
                :min="MIN_PANEL_CONTENT_HEIGHT"
                :max="MAX_PANEL_CONTENT_SIZE"
                :step="8"
                controls-position="right"
                @update:model-value="(v: number | undefined) => updatePanelSize('height', Number(v) || DEFAULT_PANEL_CONTENT_HEIGHT)"
              />
            </label>
          </div>
        </template>
      </el-collapse-item>

      <el-collapse-item v-if="isPanelOnly" name="panel">
        <template #title>
          <span class="collapse-title">
            3 · 跟镜头面板
            <HelpTip content="始终朝向相机。双击场景中的面板也可打开编辑弹窗。" />
          </span>
        </template>
        <p v-if="panelSummary" class="multi-hint">{{ panelSummary }}</p>
        <div class="ops">
          <el-button size="small" type="primary" style="flex: 1" @click="openPanelIn2dEditor">
            编辑面板内容
          </el-button>
        </div>
      </el-collapse-item>

      <el-collapse-item
        v-if="!isPanelOnly"
        name="liquid"
      >
        <template #title>
          <span class="collapse-title">
            3 · 液位
            <HelpTip :content="liquidHelp" />
          </span>
        </template>
        <div class="ops">
          <el-button
            type="primary"
            size="small"
            style="flex: 1"
            @click="project.openLiquidConfig()"
          >
            {{ liquid ? '液位配置…' : '添加液位层…' }}
          </el-button>
        </div>
        <div v-if="liquid" class="summary-list">
          <div class="summary-item">
            <span>变量</span>
            <span>{{ liquid.tagId || '未选择' }}</span>
          </div>
          <div class="summary-item">
            <span>量程</span>
            <span>{{ liquid.inMin }} ~ {{ liquid.inMax }}</span>
          </div>
          <div class="summary-item">
            <span>生成方式</span>
            <span>{{ liquid.mode === 'primitive' ? '圆柱 / 长方体图元' : '沿用罐体形状' }}</span>
          </div>
          <div class="summary-item">
            <span>液体色</span>
            <span class="swatch"><i :style="{ background: liquid.color }" />{{ liquid.color }}</span>
          </div>
        </div>
      </el-collapse-item>

      <el-collapse-item
        v-if="!isPanelOnly"
        name="flow"
      >
        <template #title>
          <span class="collapse-title">
            4 · 流动
            <HelpTip :content="flowHelp" />
          </span>
        </template>
        <div class="ops">
          <el-button
            type="primary"
            size="small"
            style="flex: 1"
            @click="project.openFlowConfig()"
          >
            {{ flowLink ? '流动配置…' : '添加流动效果…' }}
          </el-button>
        </div>
        <div v-if="flowLink" class="summary-list">
          <div class="summary-item">
            <span>变量</span>
            <span>{{ flowLink.tagId || '未选择' }}</span>
          </div>
          <div class="summary-item">
            <span>基准速度</span>
            <span>{{ flowLink.speed }} m/s</span>
          </div>
          <div class="summary-item">
            <span>样式</span>
            <span>{{ flowStyleLabel }}</span>
          </div>
          <div class="summary-item">
            <span>颜色</span>
            <span class="swatch">
              <i :style="{ background: flowLink.color || '#67e8f9' }" />{{ flowLink.color || '默认青' }}
            </span>
          </div>
        </div>
      </el-collapse-item>

      <el-collapse-item name="animLink">
        <template #title>
          <span class="collapse-title">
            {{ isPanelOnly ? '6 · 动画连接' : '5 · 动画连接' }}
            <HelpTip content="位移、颜色、拖拽写、属性绑定、事件等均在此配置（与对话框为同一份数据）" />
          </span>
        </template>
        <div class="anim-summary">
          <el-button
            type="primary"
            size="small"
            style="width: 100%"
            @click="project.openAnimationConnection()"
          >
            动画连接…
          </el-button>
          <div v-if="animLinks.length" class="summary-list">
            <div v-for="l in animLinks" :key="l.id" class="summary-item">
              <span>{{ animationLinkTypeLabel(l.type, '3d') }}</span>
              <el-tag size="small" :type="l.enabled ? 'success' : 'info'">
                {{ l.enabled ? '已激活' : '未激活' }}
              </el-tag>
            </div>
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>
  <div v-else-if="multiCount > 0" class="empty">
    选中对象未找到，请再点一次模型
  </div>
  <div v-else class="prop3d scene-edit">
    <div class="panel-title">
      编辑场景
      <HelpTip content="未选中模型时，按分类编辑本页场景（随工程保存）" />
    </div>

    <el-collapse v-model="sceneCollapse" class="scene-collapse">
      <el-collapse-item name="env">
        <template #title>
          <span class="collapse-title">
            1 · 环境
            <HelpTip content="背景色与整体明暗" />
          </span>
        </template>
        <label class="row">
          <span>背景色</span>
          <el-color-picker
            size="small"
            :model-value="scenePres.background"
            @update:model-value="(v: string | null) => patchPresentation({ background: v || DEFAULT_PAGE3D_PRESENTATION.background })"
          />
        </label>
        <label class="row">
          <span>背景模式</span>
          <el-select
            size="small"
            :model-value="scenePres.backgroundMode"
            @update:model-value="(v: string) => patchPresentation({ backgroundMode: v === 'hemi' ? 'hemi' : 'color' })"
          >
            <el-option label="纯色" value="color" />
            <el-option label="天空感" value="hemi" />
          </el-select>
        </label>
        <label class="row">
          <span>环境亮度</span>
          <el-slider
            class="scene-slider"
            :min="0"
            :max="2"
            :step="0.05"
            :model-value="scenePres.environmentIntensity"
            @update:model-value="(v: number | number[]) => patchPresentation({ environmentIntensity: Number(v) })"
          />
          <el-input-number
            size="small"
            :min="0"
            :max="2"
            :step="0.05"
            controls-position="right"
            :model-value="scenePres.environmentIntensity"
            @update:model-value="(v: number | undefined) => patchPresentation({ environmentIntensity: Number(v) || 0 })"
          />
        </label>
        <label class="row">
          <span>环境光</span>
          <el-slider
            class="scene-slider"
            :min="0"
            :max="2"
            :step="0.05"
            :model-value="scenePres.ambientIntensity"
            @update:model-value="(v: number | number[]) => patchPresentation({ ambientIntensity: Number(v) })"
          />
          <el-input-number
            size="small"
            :min="0"
            :max="2"
            :step="0.05"
            controls-position="right"
            :model-value="scenePres.ambientIntensity"
            @update:model-value="(v: number | undefined) => patchPresentation({ ambientIntensity: Number(v) || 0 })"
          />
        </label>
      </el-collapse-item>

      <el-collapse-item name="grid">
        <template #title>
          <span class="collapse-title">
            2 · 网格地面
            <HelpTip content="辅助网格与地面阴影接收面" />
          </span>
        </template>
        <label class="row">
          <span>显示网格</span>
          <el-checkbox
            :model-value="scenePres.gridVisible"
            @update:model-value="(v: boolean | string | number) => patchPresentation({ gridVisible: Boolean(v) })"
          />
        </label>
        <div class="pair">
          <label>
            <span>主线颜色</span>
            <el-color-picker
              size="small"
              :disabled="!scenePres.gridVisible"
              :model-value="scenePres.gridColor"
              @update:model-value="(v: string | null) => patchPresentation({ gridColor: v || DEFAULT_PAGE3D_PRESENTATION.gridColor })"
            />
          </label>
          <label>
            <span>次线颜色</span>
            <el-color-picker
              size="small"
              :disabled="!scenePres.gridVisible"
              :model-value="scenePres.gridDivisionColor"
              @update:model-value="(v: string | null) => patchPresentation({ gridDivisionColor: v || DEFAULT_PAGE3D_PRESENTATION.gridDivisionColor })"
            />
          </label>
        </div>
        <label class="row">
          <span>地面不透明度</span>
          <el-slider
            class="scene-slider"
            :min="0"
            :max="1"
            :step="0.01"
            :model-value="scenePres.groundOpacity"
            @update:model-value="(v: number | number[]) => patchPresentation({ groundOpacity: Number(v) })"
          />
          <el-input-number
            size="small"
            :min="0"
            :max="1"
            :step="0.01"
            controls-position="right"
            :model-value="scenePres.groundOpacity"
            @update:model-value="(v: number | undefined) => patchPresentation({ groundOpacity: Number(v) || 0 })"
          />
        </label>
      </el-collapse-item>

      <el-collapse-item name="sun">
        <template #title>
          <span class="collapse-title">
            3 · 阳光与阴影
            <HelpTip content="平行光方向、亮度与阴影质量" />
          </span>
        </template>
        <div class="flag-line">
          <el-checkbox
            :model-value="scenePres.sunEnabled"
            @update:model-value="(v: boolean | string | number) => patchPresentation({ sunEnabled: Boolean(v) })"
          >
            开启太阳光
          </el-checkbox>
          <el-checkbox
            :model-value="scenePres.shadowsEnabled"
            :disabled="!scenePres.sunEnabled"
            @update:model-value="(v: boolean | string | number) => patchPresentation({ shadowsEnabled: Boolean(v) })"
          >
            产生阴影
          </el-checkbox>
        </div>
        <label class="row">
          <span>阳光亮度</span>
          <el-slider
            class="scene-slider"
            :min="0"
            :max="3"
            :step="0.05"
            :disabled="!scenePres.sunEnabled"
            :model-value="scenePres.sunIntensity"
            @update:model-value="(v: number | number[]) => patchPresentation({ sunIntensity: Number(v) })"
          />
          <el-input-number
            size="small"
            :min="0"
            :max="3"
            :step="0.05"
            controls-position="right"
            :disabled="!scenePres.sunEnabled"
            :model-value="scenePres.sunIntensity"
            @update:model-value="(v: number | undefined) => patchPresentation({ sunIntensity: Number(v) || 0 })"
          />
        </label>
        <label class="row">
          <span>水平角 (°)</span>
          <el-slider
            class="scene-slider"
            :min="0"
            :max="360"
            :step="1"
            :disabled="!scenePres.sunEnabled"
            :model-value="scenePres.sunAzimuthDeg"
            @update:model-value="(v: number | number[]) => patchPresentation({ sunAzimuthDeg: Number(v) })"
          />
          <el-input-number
            size="small"
            :min="0"
            :max="360"
            :step="1"
            controls-position="right"
            :disabled="!scenePres.sunEnabled"
            :model-value="scenePres.sunAzimuthDeg"
            @update:model-value="(v: number | undefined) => patchPresentation({ sunAzimuthDeg: Number(v) || 0 })"
          />
        </label>
        <label class="row">
          <span>高度角 (°)</span>
          <el-slider
            class="scene-slider"
            :min="1"
            :max="89"
            :step="1"
            :disabled="!scenePres.sunEnabled"
            :model-value="scenePres.sunElevationDeg"
            @update:model-value="(v: number | number[]) => patchPresentation({ sunElevationDeg: Number(v) })"
          />
          <el-input-number
            size="small"
            :min="1"
            :max="89"
            :step="1"
            controls-position="right"
            :disabled="!scenePres.sunEnabled"
            :model-value="scenePres.sunElevationDeg"
            @update:model-value="(v: number | undefined) => patchPresentation({ sunElevationDeg: Number(v) || 55 })"
          />
        </label>
        <div class="pair">
          <label>
            <span>阴影质量</span>
            <el-select
              size="small"
              :disabled="!scenePres.sunEnabled || !scenePres.shadowsEnabled"
              :model-value="scenePres.shadowMapSize"
              @update:model-value="(v: number) => patchPresentation({ shadowMapSize: v })"
            >
              <el-option label="低 (512)" :value="512" />
              <el-option label="中 (1024)" :value="1024" />
              <el-option label="高 (2048)" :value="2048" />
              <el-option label="极高 (4096)" :value="4096" />
            </el-select>
          </label>
          <label>
            <span>阴影偏移</span>
            <el-input-number
              size="small"
              :step="0.0001"
              :disabled="!scenePres.sunEnabled || !scenePres.shadowsEnabled"
              controls-position="right"
              :model-value="scenePres.shadowBias"
              @update:model-value="(v: number | undefined) => patchPresentation({ shadowBias: Number(v) || 0 })"
            />
          </label>
        </div>
      </el-collapse-item>

      <el-collapse-item name="camera">
        <template #title>
          <span class="collapse-title">
            4 · 相机
            <HelpTip content="默认视角与运行时操作限位" />
          </span>
        </template>
        <div class="cam-readout">
          <template v-if="page3d?.camera">
            <div>
              位置
              <code>
                {{ formatCam(page3d.camera.position[0]) }},
                {{ formatCam(page3d.camera.position[1]) }},
                {{ formatCam(page3d.camera.position[2]) }}
              </code>
            </div>
            <div>
              目标
              <code>
                {{ formatCam(page3d.camera.target[0]) }},
                {{ formatCam(page3d.camera.target[1]) }},
                {{ formatCam(page3d.camera.target[2]) }}
              </code>
            </div>
          </template>
          <p v-else class="scene-hint">尚未保存默认视角</p>
        </div>
        <div class="ops">
          <el-button size="small" type="primary" @click="captureDefaultCamera">设为默认视角</el-button>
          <el-button size="small" @click="applyDefaultCamera">恢复默认视角</el-button>
        </div>
        <div class="sub-label">距离限位</div>
        <div class="pair">
          <label>
            <span>最小</span>
            <el-input-number
              size="small"
              :min="0.05"
              :max="scenePres.cameraMaxDistance - 0.1"
              :step="0.1"
              controls-position="right"
              :model-value="scenePres.cameraMinDistance"
              @update:model-value="(v: number | undefined) => patchPresentation({ cameraMinDistance: Number(v) || 0.5 })"
            />
          </label>
          <label>
            <span>最大</span>
            <el-input-number
              size="small"
              :min="scenePres.cameraMinDistance + 0.1"
              :max="10000"
              :step="10"
              controls-position="right"
              :model-value="scenePres.cameraMaxDistance"
              @update:model-value="(v: number | undefined) => patchPresentation({ cameraMaxDistance: Number(v) || 500 })"
            />
          </label>
        </div>
        <div class="sub-label">
          俯仰限位
          <HelpTip content="0°=顶视，90°≈平视；上限建议 ≤89，避免钻到地面下。" />
        </div>
        <div class="pair">
          <label>
            <span>下限 (°)</span>
            <el-input-number
              size="small"
              :min="0"
              :max="178"
              :step="1"
              controls-position="right"
              :model-value="scenePres.cameraMinPolarDeg"
              @update:model-value="(v: number | undefined) => patchPresentation({ cameraMinPolarDeg: Number(v) ?? 5 })"
            />
          </label>
          <label>
            <span>上限 (°)</span>
            <el-input-number
              size="small"
              :min="1"
              :max="180"
              :step="1"
              controls-position="right"
              :model-value="scenePres.cameraMaxPolarDeg"
              @update:model-value="(v: number | undefined) => patchPresentation({ cameraMaxPolarDeg: Number(v) ?? 89 })"
            />
          </label>
        </div>
        <div class="sub-label">
          旋转
          <HelpTip content="1 为默认。越大，左键同样拖动转过的角度越大。" />
        </div>
        <label class="row">
          <span>灵敏度</span>
          <el-input-number
            size="small"
            :min="0.1"
            :max="5"
            :step="0.1"
            :precision="1"
            controls-position="right"
            :model-value="scenePres.cameraRotateSpeed"
            @change="(v: number | undefined) => patchPresentation({ cameraRotateSpeed: Number(v) || 1 })"
          />
        </label>
      </el-collapse-item>
    </el-collapse>

    <div class="ops">
      <el-button size="small" plain @click="resetPresentationDefaults">恢复全部观感默认值</el-button>
    </div>
  </div>
</template>

<style scoped>
.prop3d {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-title {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--scada-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.multi-hint {
  margin: 0;
  font-size: 11px;
  color: var(--scada-muted);
  line-height: 1.4;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

label {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--scada-muted);
}

.xyz {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
}

.xyz.panel-size {
  grid-template-columns: 1fr 1fr;
}

.xyz.liquid-range {
  grid-template-columns: 1fr 1fr;
}

.xyz.panel-size > label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--scada-muted);
}

.xyz :deep(.el-input-number) {
  width: 100%;
}

.ops {
  display: flex;
  gap: 8px;
}

.anim-summary {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 4px;
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

.summary-item > span:last-child {
  color: var(--scada-text);
}

.summary-item .swatch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.summary-item .swatch i {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--scada-border);
  display: inline-block;
}

.empty {
  font-size: 12px;
  color: var(--scada-muted);
}

.scene-hint {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--scada-muted);
  line-height: 1.4;
}

.scene-slider {
  flex: 1;
  min-width: 0;
  margin: 0 8px;
}

.cam-readout {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--scada-muted);
}

.cam-readout code {
  color: #e2e8f0;
  font-size: 11px;
}

.scene-edit .row {
  gap: 8px;
}

.scene-edit .row > span:first-child {
  flex: 0 0 72px;
  width: 72px;
}

.scene-edit .row :deep(.el-input-number) {
  width: 96px;
  flex-shrink: 0;
}

.scene-edit .row :deep(.el-select) {
  width: 140px;
}

.scene-edit .pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.scene-edit .pair > label {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.scene-edit .pair :deep(.el-input-number),
.scene-edit .pair :deep(.el-select) {
  width: 100%;
}

.scene-edit .flag-line,
.object-edit .flag-line {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px 12px;
}

.scene-edit .flag-line :deep(.el-checkbox),
.object-edit .flag-line :deep(.el-checkbox) {
  display: inline-flex;
  grid-template-columns: none;
  gap: 0;
  width: auto;
  margin-right: 0;
}

.object-edit .flag-line > label {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  width: auto;
}

.scene-collapse {
  border: none;
  --el-collapse-header-height: 36px;
}

.scene-collapse :deep(.el-collapse-item__header) {
  background: transparent;
  color: var(--scada-text);
  font-size: 12px;
  font-weight: 600;
  border-bottom-color: var(--scada-border);
  letter-spacing: 0.02em;
}

.scene-collapse :deep(.el-collapse-item__wrap) {
  background: transparent;
  border-bottom-color: var(--scada-border);
}

.scene-collapse :deep(.el-collapse-item__content) {
  padding: 8px 0 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-hint {
  margin: 0 0 2px;
}

.collapse-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.sub-label {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--scada-muted);
  letter-spacing: 0.04em;
}

.scale-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.scale-lock {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--scada-muted);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.scale-lock-box {
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border: 1px solid var(--scada-border);
  border-radius: 2px;
  position: relative;
  flex: 0 0 12px;
}

.scale-lock.on {
  color: var(--scada-accent);
}

.scale-lock.on .scale-lock-box {
  border-color: var(--scada-accent);
  background: var(--scada-accent);
}

.scale-lock.on .scale-lock-box::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 1px;
  width: 3px;
  height: 6px;
  border: solid #fff;
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

.scale-lock:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.object-edit .row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.object-edit .row > span:first-child {
  flex: 0 0 56px;
  width: 56px;
  font-size: 12px;
  color: var(--scada-muted);
}

.object-edit .row :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

.hidden-file {
  display: none;
}
</style>
