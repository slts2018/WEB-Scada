<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { Object3DPanel, Page2D, Page3DPresentation } from '@web-scada/core'
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
import { useProjectStore } from '@/stores/project'

const project = useProjectStore()
const obj = computed(() => project.selectedObject3d)
const multiCount = computed(() => project.selectedObject3dIds.length)
const page3d = computed(() => project.activePage3d)
const scenePres = computed(() => resolvePage3DPresentation(page3d.value?.presentation))
/** 场景 / 对象属性分类：默认全部折叠，点标题再展开 */
const sceneCollapse = ref<string[]>([])
const objectCollapse = ref<string[]>([])

/** 纯面板：无模型，属性栏不显示旋转，缩放改控面板宽高 */
const isPanelOnly = computed(
  () => Boolean(obj.value?.panel) && !obj.value?.modelResourceId,
)

const animLinks = computed(() => obj.value?.animationLinks ?? [])

const sizeMeters = computed(() =>
  obj.value ? sizeMetersFromObject3d(obj.value) : ([0, 0, 0] as [number, number, number]),
)

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

/** 缩放栏编辑的是轴向真实尺寸（米），三位小数 */
function updateSizeMeters(index: 0 | 1 | 2, value: number) {
  if (!obj.value) return
  const cur = sizeMetersFromObject3d(obj.value)
  const next: [number, number, number] = [...cur]
  next[index] = Math.max(0.001, Number.isFinite(value) ? value : 0.001)
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

function enablePanel() {
  if (!obj.value) return
  if (obj.value.panel) return
  patchPanel(createDefaultObject3DPanel(obj.value.name || '操作面板'))
  const page = project.ensurePanelPage2d(obj.value.id)
  if (page) ElMessage.success(`已启用：${page.name}`)
}

function disablePanel() {
  patchPanel(undefined)
}

function openPanelIn2dEditor() {
  if (!obj.value) return
  if (!obj.value.panel) enablePanel()
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
    <div class="panel-title">已选 {{ multiCount }} 个对象</div>
    <p class="multi-hint">属性编辑针对主选（列表首项）。可批量复制 / 删除 / 组合。</p>
    <div class="ops">
      <el-button size="small" @click="project.duplicateObject3ds(project.selectedObject3dIds)">
        批量复制
      </el-button>
      <el-button size="small" @click="groupMulti">组合</el-button>
      <el-button
        size="small"
        type="danger"
        plain
        @click="project.removeObject3ds(project.selectedObject3dIds)"
      >
        批量删除
      </el-button>
    </div>
    <div v-if="obj" class="panel-title">主选：{{ obj.name }}</div>
  </div>
  <div v-if="obj" class="prop3d object-edit">
    <div class="panel-title">对象属性</div>
    <p class="multi-hint">按分类编辑当前选中对象</p>

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
        <label class="row">
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
        <template v-if="!isPanelOnly">
          <div class="sub-label">模型外观</div>
          <el-button size="small" type="primary" style="width: 100%" @click="openModelEditor">
            编辑模型…
          </el-button>
          <p class="multi-hint">颜色、金属度/粗糙度与贴图；修改后写入工程并实时预览。</p>
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
          <div class="sub-label">缩放（米）</div>
          <p class="multi-hint">X/Y/Z 为各轴向真实尺寸（米）；模型文件按米建模。</p>
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
              @update:model-value="(v: number | undefined) => updateSizeMeters(i as 0 | 1 | 2, Number(v) || 0.001)"
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

      <el-collapse-item title="3 · 跟镜头面板" name="panel">
        <div v-if="!obj.panel" class="ops">
          <el-button size="small" type="primary" plain style="width: 100%" @click="enablePanel">
            启用面板
          </el-button>
          <p class="multi-hint">给模型挂一块跟镜头面板；纯面板请从「基础图元」拖入。</p>
        </div>
        <template v-else>
          <p class="multi-hint">{{ panelSummary }} · 始终朝向相机</p>
          <div class="ops">
            <el-button size="small" type="primary" style="flex: 1" @click="openPanelIn2dEditor">
              编辑面板内容
            </el-button>
            <el-button
              v-if="!isPanelOnly"
              size="small"
              type="danger"
              plain
              @click="disablePanel"
            >
              关闭面板
            </el-button>
          </div>
          <p class="multi-hint">双击场景中的面板也可打开编辑弹窗。</p>
        </template>
      </el-collapse-item>

      <el-collapse-item title="4 · 动画连接" name="animLink">
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
          <p class="multi-hint">
            位移、颜色、拖拽写、属性绑定、事件等均在此配置（与对话框为同一份数据）
          </p>
        </div>
      </el-collapse-item>
    </el-collapse>

    <div class="ops">
      <el-button size="small" @click="project.duplicateObject3d(obj.id)">复制</el-button>
      <el-button size="small" type="danger" plain @click="project.removeObject3d(obj.id)">
        删除对象
      </el-button>
    </div>
  </div>
  <div v-else-if="multiCount > 0" class="empty">
    选中对象未找到，请再点一次模型
  </div>
  <div v-else class="prop3d scene-edit">
    <div class="panel-title">编辑场景</div>
    <p class="scene-hint">未选中模型时，按分类编辑本页场景（随工程保存）</p>

    <el-collapse v-model="sceneCollapse" class="scene-collapse">
      <el-collapse-item title="1 · 环境" name="env">
        <p class="scene-hint section-hint">背景色与整体明暗</p>
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

      <el-collapse-item title="2 · 网格地面" name="grid">
        <p class="scene-hint section-hint">辅助网格与地面阴影接收面</p>
        <label class="row">
          <span>显示网格</span>
          <el-checkbox
            :model-value="scenePres.gridVisible"
            @update:model-value="(v: boolean | string | number) => patchPresentation({ gridVisible: Boolean(v) })"
          />
        </label>
        <label class="row">
          <span>主线颜色</span>
          <el-color-picker
            size="small"
            :disabled="!scenePres.gridVisible"
            :model-value="scenePres.gridColor"
            @update:model-value="(v: string | null) => patchPresentation({ gridColor: v || DEFAULT_PAGE3D_PRESENTATION.gridColor })"
          />
        </label>
        <label class="row">
          <span>次线颜色</span>
          <el-color-picker
            size="small"
            :disabled="!scenePres.gridVisible"
            :model-value="scenePres.gridDivisionColor"
            @update:model-value="(v: string | null) => patchPresentation({ gridDivisionColor: v || DEFAULT_PAGE3D_PRESENTATION.gridDivisionColor })"
          />
        </label>
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

      <el-collapse-item title="3 · 阳光与阴影" name="sun">
        <p class="scene-hint section-hint">平行光方向、亮度与阴影质量</p>
        <label class="row">
          <span>开启太阳光</span>
          <el-checkbox
            :model-value="scenePres.sunEnabled"
            @update:model-value="(v: boolean | string | number) => patchPresentation({ sunEnabled: Boolean(v) })"
          />
        </label>
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
        <label class="row">
          <span>产生阴影</span>
          <el-checkbox
            :model-value="scenePres.shadowsEnabled"
            :disabled="!scenePres.sunEnabled"
            @update:model-value="(v: boolean | string | number) => patchPresentation({ shadowsEnabled: Boolean(v) })"
          />
        </label>
        <label class="row">
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
        <label class="row">
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
      </el-collapse-item>

      <el-collapse-item title="4 · 相机" name="camera">
        <p class="scene-hint section-hint">默认视角与运行时操作限位</p>
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
        <label class="row">
          <span>最小距离</span>
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
        <label class="row">
          <span>最大距离</span>
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
        <div class="sub-label">俯仰限位</div>
        <label class="row">
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
        <label class="row">
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
        <p class="scene-hint">0°=顶视，90°≈平视；上限建议 ≤89，避免钻到地面下。</p>
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

.sub-label {
  margin-top: 4px;
  font-size: 11px;
  color: var(--scada-muted);
  letter-spacing: 0.04em;
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
