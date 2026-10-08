<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { Object3DMaterial, Object3DTextureSlot } from '@web-scada/core'
import {
  createDefaultObject3DMaterial,
  patchObject3dSizeMeters,
  sizeMetersFromObject3d,
} from '@web-scada/core'
import { useProjectStore } from '@/stores/project'
import {
  createModelEditorPreview,
  type ModelEditorPreview,
} from '@/shared/three/createModelEditorPreview'

type EditorTab = 'basic' | 'material' | 'effects'
type MapKey = 'diffuse' | 'emissive' | 'metalness' | 'bump'

const MAP_META: Array<{ key: MapKey; label: string }> = [
  { key: 'diffuse', label: '漫反射纹理' },
  { key: 'emissive', label: '自发光纹理' },
  { key: 'metalness', label: '金属纹理' },
  { key: 'bump', label: '凹凸纹理' },
]

const project = useProjectStore()
const obj = computed(() => project.selectedObject3d)

const dialogVisible = computed({
  get: () => project.object3dModelEditorOpen,
  set: (v: boolean) => {
    if (v) project.openObject3dModelEditor()
    else project.closeObject3dModelEditor()
  },
})

const tab = ref<EditorTab>('material')
const editingMap = ref<MapKey | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const pendingMapKey = ref<MapKey | null>(null)
const scaleLocked = ref(true)
const previewEl = ref<HTMLElement | null>(null)
let preview: ModelEditorPreview | null = null

async function ensurePreview() {
  await nextTick()
  if (!previewEl.value) return
  if (!preview) {
    preview = createModelEditorPreview(previewEl.value)
  }
  if (obj.value) {
    await preview.setObject(obj.value, (id) => project.getResourceUrl(id))
    preview.resize()
  }
}

function disposePreview() {
  preview?.dispose()
  preview = null
}

const typeLabel = computed(() => {
  if (!obj.value) return '—'
  if (obj.value.modelResourceId) return '模型'
  if (obj.value.panel && !obj.value.modelResourceId) return '面板锚点'
  switch (obj.value.primitive) {
    case 'sphere':
      return '球体'
    case 'cylinder':
      return '圆柱'
    case 'arrow':
      return '箭头'
    case 'box':
    default:
      return '立方体'
  }
})

const material = computed(() => obj.value?.material)

function ensureMaterial(): Object3DMaterial {
  if (!obj.value) return createDefaultObject3DMaterial()
  if (obj.value.material?.override) return obj.value.material
  const next = createDefaultObject3DMaterial(obj.value.style)
  project.updateObject3d(obj.value.id, {
    material: next,
    style: {
      ...obj.value.style,
      color: next.color,
      opacity: next.opacity,
      emissive: next.emissive,
    },
  })
  return next
}

function patchMaterial(partial: Partial<Object3DMaterial>) {
  if (!obj.value) return
  const base = obj.value.material?.override
    ? obj.value.material
    : createDefaultObject3DMaterial(obj.value.style)
  const next: Object3DMaterial = {
    ...base,
    ...partial,
    override: true,
    maps: partial.maps !== undefined ? partial.maps : base.maps,
  }
  const stylePatch: NonNullable<(typeof obj.value)['style']> = {
    ...obj.value.style,
  }
  if (next.color != null) stylePatch.color = next.color
  if (next.opacity != null) stylePatch.opacity = next.opacity
  if (next.emissive != null) stylePatch.emissive = next.emissive
  project.updateObject3d(obj.value.id, { material: next, style: stylePatch })
}

function patchMaps(key: MapKey, slot: Object3DTextureSlot | undefined) {
  if (!obj.value) return
  const base = ensureMaterial()
  const maps = { ...(base.maps ?? {}) }
  if (slot) maps[key] = slot
  else delete maps[key]
  patchMaterial({ maps })
}

function patchSlotField(key: MapKey, field: keyof Object3DTextureSlot, value: number | string) {
  const slot = material.value?.maps?.[key]
  if (!slot) return
  patchMaps(key, { ...slot, [field]: value })
}

function updateTransform(axis: 'position' | 'rotation', index: 0 | 1 | 2, value: number) {
  if (!obj.value) return
  const next = [...obj.value.transform[axis]] as [number, number, number]
  next[index] = value
  project.updateObject3d(obj.value.id, {
    transform: { ...obj.value.transform, [axis]: next },
  })
}

const sizeMeters = computed(() =>
  obj.value ? sizeMetersFromObject3d(obj.value) : ([0, 0, 0] as [number, number, number]),
)

/** 缩放栏：各轴向真实尺寸（米），三位小数 */
function updateSizeMeters(index: 0 | 1 | 2, value: number) {
  if (!obj.value) return
  const cur = sizeMetersFromObject3d(obj.value)
  const safe = Math.max(0.001, Number.isFinite(value) ? value : 0.001)
  let next: [number, number, number]
  if (scaleLocked.value) {
    next = [safe, safe, safe]
  } else {
    next = [...cur] as [number, number, number]
    next[index] = safe
  }
  project.updateObject3d(obj.value.id, patchObject3dSizeMeters(obj.value, next))
}

function patchBasic(partial: {
  name?: string
  visible?: boolean
  castShadow?: boolean
  receiveShadow?: boolean
  opacity?: number
}) {
  if (!obj.value) return
  if (partial.opacity != null) {
    patchMaterial({ opacity: partial.opacity })
    return
  }
  project.updateObject3d(obj.value.id, partial)
}

function deleteMaterial() {
  if (!obj.value) return
  project.updateObject3d(obj.value.id, { material: undefined })
  editingMap.value = null
  ElMessage.success('已删除材质覆盖，恢复默认外观')
}

function openMapEditor(key: MapKey) {
  ensureMaterial()
  if (!material.value?.maps?.[key]) {
    pendingMapKey.value = key
    fileInput.value?.click()
    return
  }
  editingMap.value = key
}

function pickImageForMap(key: MapKey) {
  pendingMapKey.value = key
  fileInput.value?.click()
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  const key = pendingMapKey.value
  input.value = ''
  pendingMapKey.value = null
  if (!file || !key || !obj.value) return
  if (!/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name)) {
    ElMessage.warning('请选择图片文件（png/jpg/webp/svg…）')
    return
  }
  try {
    const res = await project.addImageResource(file)
    const prev = material.value?.maps?.[key]
    patchMaps(key, {
      resourceId: res.id,
      offsetU: prev?.offsetU ?? 0,
      offsetV: prev?.offsetV ?? 0,
      repeatU: prev?.repeatU ?? 1,
      repeatV: prev?.repeatV ?? 1,
    })
    editingMap.value = key
    ElMessage.success(`已添加${MAP_META.find((m) => m.key === key)?.label || '纹理'}`)
  } catch {
    ElMessage.error('上传图片失败')
  }
}

function deleteMap(key: MapKey) {
  patchMaps(key, undefined)
  if (editingMap.value === key) editingMap.value = null
}

function resourceName(id: string) {
  return project.document.resources.find((r) => r.id === id)?.name || id.slice(-8)
}

function rgbLabel(hex: string | undefined, fallback: string) {
  const h = (hex || fallback).replace('#', '')
  if (h.length !== 6) return hex || fallback
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgb(${r}, ${g}, ${b})`
}

watch(
  () => project.object3dModelEditorOpen,
  async (open) => {
    if (open) {
      tab.value = 'material'
      editingMap.value = null
      await ensurePreview()
    } else {
      disposePreview()
    }
  },
)

watch(
  () => obj.value?.id,
  async (id) => {
    if (!project.object3dModelEditorOpen) return
    if (!id || !obj.value) {
      project.closeObject3dModelEditor()
      return
    }
    await ensurePreview()
  },
)

/** 材质/位姿变化 → 预览实时刷新（不重建网格） */
watch(
  () => {
    const o = obj.value
    if (!o) return ''
    return JSON.stringify({
      t: o.transform,
      s: o.style,
      m: o.material,
      v: o.visible,
    })
  },
  () => {
    if (!preview || !obj.value || !project.object3dModelEditorOpen) return
    preview.applyAppearance(obj.value)
  },
)

onBeforeUnmount(() => disposePreview())
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="模型编辑器"
    width="96vw"
    top="3vh"
    align-center
    :close-on-click-modal="false"
    destroy-on-close
    class="model-editor-dialog"
    @opened="ensurePreview"
  >
    <template #header>
      <div class="dlg-header">
        <span class="dlg-title">模型编辑</span>
        <el-button type="danger" size="small" @click="dialogVisible = false">退出编辑</el-button>
      </div>
    </template>

    <div v-if="obj" class="editor-body">
      <aside class="nodes">
        <div class="aside-title">节点</div>
        <div class="node-item active">{{ obj.name || '未命名' }}</div>
        <p class="aside-hint">左侧选中对象；中间可拖拽旋转预览</p>
      </aside>

      <div class="viewport">
        <div ref="previewEl" class="preview-canvas" />
        <div class="viewport-hint">拖拽旋转 · 滚轮缩放</div>
      </div>

      <section class="props">
        <el-tabs v-model="tab" class="tabs">
          <el-tab-pane label="基础" name="basic" />
          <el-tab-pane label="材质" name="material" />
          <el-tab-pane label="特效" name="effects" />
        </el-tabs>

        <!-- 基础 -->
        <div v-show="tab === 'basic'" class="pane">
          <div class="pane-title">基础</div>
          <label class="row">
            <span>类型</span>
            <el-input size="small" :model-value="typeLabel" disabled />
          </label>
          <label class="row">
            <span>名称</span>
            <el-input
              size="small"
              :model-value="obj.name"
              @update:model-value="(v: string) => patchBasic({ name: v })"
            />
          </label>

          <div class="field-label">位置</div>
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

          <div class="field-label row-inline">
            <span>缩放（米）</span>
            <el-button
              size="small"
              text
              :type="scaleLocked ? 'primary' : 'default'"
              @click="scaleLocked = !scaleLocked"
            >
              {{ scaleLocked ? '等比锁定' : '各轴独立' }}
            </el-button>
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
              @update:model-value="(v: number | undefined) => updateSizeMeters(i as 0 | 1 | 2, Number(v) || 0.001)"
            />
          </div>

          <div class="field-label">旋转（°）</div>
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

          <el-checkbox
            :model-value="obj.visible !== false"
            @update:model-value="(v: boolean | string | number) => patchBasic({ visible: Boolean(v) })"
          >
            启用
          </el-checkbox>
          <el-checkbox
            :model-value="obj.receiveShadow !== false"
            @update:model-value="(v: boolean | string | number) => patchBasic({ receiveShadow: Boolean(v) })"
          >
            接收阴影
          </el-checkbox>
          <el-checkbox
            :model-value="obj.castShadow !== false"
            @update:model-value="(v: boolean | string | number) => patchBasic({ castShadow: Boolean(v) })"
          >
            生成阴影
          </el-checkbox>

          <div class="field-label">透明度</div>
          <el-slider
            :model-value="material?.opacity ?? obj.style?.opacity ?? 1"
            :min="0"
            :max="1"
            :step="0.01"
            @update:model-value="(v: number | number[]) => patchBasic({ opacity: Number(v) })"
          />
        </div>

        <!-- 材质 -->
        <div v-show="tab === 'material'" class="pane">
          <template v-if="!editingMap">
            <div class="pane-title">材质</div>
            <label class="row">
              <span>材质类型</span>
              <el-input size="small" model-value="PBR材质" disabled />
            </label>
            <div class="field-label">金属因子</div>
            <el-slider
              :model-value="material?.metalness ?? 0.1"
              :min="0"
              :max="1"
              :step="0.01"
              @update:model-value="(v: number | number[]) => patchMaterial({ metalness: Number(v) })"
            />
            <div class="field-label">粗糙度</div>
            <el-slider
              :model-value="material?.roughness ?? 0.6"
              :min="0"
              :max="1"
              :step="0.01"
              @update:model-value="(v: number | number[]) => patchMaterial({ roughness: Number(v) })"
            />
            <label class="row">
              <span>漫反射色</span>
              <div class="color-line">
                <el-color-picker
                  size="small"
                  :model-value="material?.color || obj.style?.color || '#3d8bfd'"
                  @update:model-value="(v: string | null) => v && patchMaterial({ color: v })"
                />
                <span class="muted">{{
                  rgbLabel(material?.color || obj.style?.color, '#3d8bfd')
                }}</span>
              </div>
            </label>
            <label class="row">
              <span>自发光色</span>
              <div class="color-line">
                <el-color-picker
                  size="small"
                  :model-value="material?.emissive || '#000000'"
                  @update:model-value="(v: string | null) => v && patchMaterial({ emissive: v })"
                />
                <span class="muted">{{ rgbLabel(material?.emissive, '#000000') }}</span>
              </div>
            </label>
            <label class="row">
              <span>透明模式</span>
              <el-select
                size="small"
                :model-value="(material?.opacity ?? 1) < 1 ? 'blend' : 'opaque'"
                @update:model-value="
                  (v: string) => patchMaterial({ opacity: v === 'blend' ? Math.min(material?.opacity ?? 0.8, 0.99) : 1 })
                "
              >
                <el-option label="不透明" value="opaque" />
                <el-option label="混合" value="blend" />
              </el-select>
            </label>
            <el-checkbox
              :model-value="(material?.side ?? 'front') === 'front'"
              @update:model-value="
                (v: boolean | string | number) => patchMaterial({ side: Boolean(v) ? 'front' : 'double' })
              "
            >
              隐藏背面
            </el-checkbox>

            <div class="map-list">
              <button
                v-for="m in MAP_META"
                :key="m.key"
                type="button"
                class="map-card"
                @click="openMapEditor(m.key)"
              >
                <template v-if="material?.maps?.[m.key]?.resourceId">
                  {{ m.label }}：{{ resourceName(material!.maps![m.key]!.resourceId) }}
                </template>
                <template v-else>暂无{{ m.label }}，点击添加</template>
              </button>
            </div>

            <el-button
              type="danger"
              plain
              style="width: 100%; margin-top: 12px"
              :disabled="!material?.override"
              @click="deleteMaterial"
            >
              删除材质
            </el-button>
          </template>

          <!-- 贴图子面板 -->
          <template v-else>
            <div class="pane-title row-inline">
              <el-button size="small" text @click="editingMap = null">← 返回</el-button>
              <span>{{ MAP_META.find((m) => m.key === editingMap)?.label }}</span>
            </div>
            <label class="row">
              <span>图片</span>
              <div class="color-line">
                <span class="muted truncate">{{
                  material?.maps?.[editingMap!]?.resourceId
                    ? resourceName(material!.maps![editingMap!]!.resourceId)
                    : '未选择'
                }}</span>
                <el-button size="small" @click="pickImageForMap(editingMap!)">选择…</el-button>
              </div>
            </label>
            <label class="row">
              <span>横向(u)偏移</span>
              <el-input-number
                size="small"
                :model-value="material?.maps?.[editingMap!]?.offsetU ?? 0"
                :step="0.01"
                controls-position="right"
                @update:model-value="
                  (v: number | undefined) => patchSlotField(editingMap!, 'offsetU', Number(v) || 0)
                "
              />
            </label>
            <label class="row">
              <span>纵向(v)偏移</span>
              <el-input-number
                size="small"
                :model-value="material?.maps?.[editingMap!]?.offsetV ?? 0"
                :step="0.01"
                controls-position="right"
                @update:model-value="
                  (v: number | undefined) => patchSlotField(editingMap!, 'offsetV', Number(v) || 0)
                "
              />
            </label>
            <label class="row">
              <span>横向(u)缩放</span>
              <el-input-number
                size="small"
                :model-value="material?.maps?.[editingMap!]?.repeatU ?? 1"
                :step="0.1"
                :min="0.001"
                controls-position="right"
                @update:model-value="
                  (v: number | undefined) => patchSlotField(editingMap!, 'repeatU', Number(v) || 1)
                "
              />
            </label>
            <label class="row">
              <span>纵向(v)缩放</span>
              <el-input-number
                size="small"
                :model-value="material?.maps?.[editingMap!]?.repeatV ?? 1"
                :step="0.1"
                :min="0.001"
                controls-position="right"
                @update:model-value="
                  (v: number | undefined) => patchSlotField(editingMap!, 'repeatV', Number(v) || 1)
                "
              />
            </label>
            <el-button type="danger" plain style="width: 100%; margin-top: 12px" @click="deleteMap(editingMap!)">
              删除{{ MAP_META.find((m) => m.key === editingMap)?.label }}
            </el-button>
          </template>
        </div>

        <!-- 特效 -->
        <div v-show="tab === 'effects'" class="pane">
          <div class="pane-title">特效</div>
          <p class="aside-hint">描边 / 辉光后续支持。可用「自发光色」做简易高亮。</p>
          <el-checkbox disabled>边框</el-checkbox>
          <el-checkbox disabled>开启辉光</el-checkbox>
        </div>
      </section>
    </div>
    <div v-else class="empty">请先选中 3D 对象</div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*,.svg"
      class="hidden-file"
      @change="onFile"
    />
  </el-dialog>
</template>

<style scoped>
.dlg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 28px;
}
.dlg-title {
  font-weight: 600;
  font-size: 16px;
}
.editor-body {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr) 320px;
  gap: 12px;
  min-height: 62vh;
  height: 72vh;
  max-height: 78vh;
}
.nodes {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 10px;
  background: var(--el-fill-color-blank);
  min-height: 0;
  overflow: auto;
}
.viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  overflow: hidden;
  background: #0b1220;
}
.preview-canvas {
  width: 100%;
  height: 100%;
}
.viewport-hint {
  position: absolute;
  left: 12px;
  bottom: 10px;
  font-size: 12px;
  color: rgba(226, 232, 240, 0.65);
  pointer-events: none;
  user-select: none;
}
.aside-title,
.pane-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.node-item {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.node-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.aside-hint {
  margin-top: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}
.props {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 8px 12px 16px;
  overflow: auto;
  background: var(--el-bg-color);
  min-height: 0;
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: grid;
  grid-template-columns: 110px 1fr;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.row-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.field-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
  margin-top: 4px;
}
.xyz {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.color-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.muted {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}
.map-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.map-card {
  text-align: left;
  padding: 14px 12px;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  cursor: pointer;
  font-size: 13px;
}
.map-card:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
.empty {
  padding: 40px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.hidden-file {
  display: none;
}
:deep(.tabs .el-tabs__header) {
  margin-bottom: 8px;
}
</style>

<style>
.model-editor-dialog.el-dialog {
  margin-bottom: 2vh;
}
.model-editor-dialog .el-dialog__body {
  padding-top: 8px;
  padding-bottom: 12px;
}
</style>
