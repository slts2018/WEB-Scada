<script setup lang="ts">
/**
 * 「液位层」配置对话框（设计端）。
 * 选中罐体 → 新建液位层；选中液位层 → 改配置。改一项立即写入。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  LIQUID_DEFAULT_COLOR,
  LIQUID_DEFAULT_IN_MAX,
  LIQUID_DEFAULT_IN_MIN,
  LIQUID_DEFAULT_INSET,
  type LiquidLevelOptions,
} from '@web-scada/core'
import { scadaConfirm } from '@/shared/ui/scadaMessageBox'
import HelpTip from '@/components/designer/HelpTip.vue'
import { useProjectStore } from '@/stores/project'
import { useTagStore } from '@/stores/tag'
import { formatTagOptionLabel } from '@/shared/runtime/tagLabel'

const project = useProjectStore()
const tags = useTagStore()

const obj = computed(() => project.selectedObject3d)
/** 当前选中的是液位层本身 */
const isLiquidNode = computed(() => Boolean(obj.value?.liquid))

const visible = computed({
  get: () => project.liquidConfigOpen,
  set: (v: boolean) => {
    if (v) project.openLiquidConfig()
    else project.closeLiquidConfig()
  },
})

const tagId = ref('')
const mode = ref<'shape' | 'primitive'>('shape')
const inMin = ref(LIQUID_DEFAULT_IN_MIN)
const inMax = ref(LIQUID_DEFAULT_IN_MAX)
const color = ref(LIQUID_DEFAULT_COLOR)
const opacity = ref(1)
const shape = ref<'auto' | 'cylinder' | 'box'>('auto')
const inset = ref(LIQUID_DEFAULT_INSET)
const shellOpacity = ref(0.35)

watch(
  () => [visible.value, obj.value?.id, obj.value?.liquid?.tagId] as const,
  () => {
    if (!visible.value || !obj.value) return
    const liq = obj.value.liquid
    if (liq) {
      tagId.value = liq.tagId || ''
      mode.value = liq.mode === 'primitive' ? 'primitive' : 'shape'
      inMin.value = liq.inMin
      inMax.value = liq.inMax
      color.value = liq.color || LIQUID_DEFAULT_COLOR
      opacity.value = liq.opacity ?? 1
      shape.value =
        liq.shape === 'cylinder' || liq.shape === 'box' ? liq.shape : 'auto'
      inset.value = liq.inset ?? LIQUID_DEFAULT_INSET
      const tank = project.findObject3dById(liq.tankId)
      const op = tank?.material?.opacity
      shellOpacity.value =
        op != null && Number.isFinite(op) ? Math.min(1, Math.max(0.05, Number(op))) : 0.35
      return
    }
    tagId.value = tags.metas[0]?.tagId ?? ''
    mode.value = 'shape'
    inMin.value = LIQUID_DEFAULT_IN_MIN
    inMax.value = LIQUID_DEFAULT_IN_MAX
    color.value = LIQUID_DEFAULT_COLOR
    opacity.value = 1
    shape.value = 'auto'
    inset.value = LIQUID_DEFAULT_INSET
    const op = obj.value.material?.opacity
    shellOpacity.value =
      op != null && Number.isFinite(op) ? Math.min(1, Math.max(0.05, Number(op))) : 0.35
  },
  { immediate: true },
)

function opts(): LiquidLevelOptions {
  return {
    tagId: tagId.value,
    mode: mode.value,
    inMin: Number(inMin.value) || 0,
    inMax: Number(inMax.value) || 100,
    color: color.value,
    opacity: Math.min(1, Math.max(0.05, Number(opacity.value) || 1)),
    shape: shape.value,
    inset: Math.min(0.25, Math.max(0, Number(inset.value) || 0)),
  }
}

/** 改一项立即写入；新建时 addLiquidLevel 会选中液位层，后续走 update */
function apply() {
  if (!obj.value || !tagId.value) return
  if (isLiquidNode.value) {
    project.updateLiquidLevel(obj.value.id, opts())
    project.setObject3dShellOpacity(obj.value.liquid!.tankId, shellOpacity.value)
    return
  }
  const node = project.addLiquidLevel(obj.value.id, opts())
  if (!node) {
    ElMessage.warning('无法添加液位层（请先选择变量）')
    return
  }
  project.setObject3dShellOpacity(obj.value.id, shellOpacity.value)
}

async function removeLiquid() {
  if (!obj.value?.liquid) return
  try {
    await scadaConfirm('删除当前液位层？', '删除液位', { confirmButtonText: '删除' })
  } catch {
    return
  }
  project.removeLiquidLevel(obj.value.id)
  visible.value = false
  ElMessage.success('已删除液位层')
}

function setTag(v: unknown) {
  tagId.value = String(v ?? '')
  apply()
}
function setMode(v: unknown) {
  mode.value = v === 'primitive' ? 'primitive' : 'shape'
  apply()
}
function setShape(v: unknown) {
  shape.value = v === 'cylinder' || v === 'box' ? v : 'auto'
  apply()
}
function setColor(v: string | null) {
  if (!v) return
  color.value = v
  apply()
}
function setIn(which: 'inMin' | 'inMax', value: number | undefined) {
  if (which === 'inMin') inMin.value = Number(value) || 0
  else inMax.value = Number(value) || 100
  apply()
}
function setOpacity(v: number | undefined) {
  opacity.value = Number(v) || 1
  apply()
}
function setInset(v: number | undefined) {
  inset.value = Number(v) || 0
  apply()
}
function setShellOpacity(v: number | undefined) {
  shellOpacity.value = Number(v) || 0.35
  apply()
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="isLiquidNode ? '液位配置' : '添加液位层'"
    width="560px"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    class="liquid-config-dialog"
  >
    <el-form class="cfg-form" label-width="108px" label-position="right" @submit.prevent>
      <el-alert class="cfg-alert" type="info" :closable="false" show-icon>
        液位由变量驱动（0%~100%）。推荐「沿用罐体形状」：任意罐形自动贴合。
      </el-alert>

      <el-form-item required>
        <template #label>
          <span class="cfg-label">
            液位变量
            <HelpTip content="液位由变量驱动（0%~100%）。变量缺失或质量差时液体隐藏。" />
          </span>
        </template>
        <el-select
          filterable
          clearable
          placeholder="选择变量"
          :model-value="tagId"
          popper-class="scada-select-dropdown"
          @update:model-value="setTag"
        >
          <el-option
            v-for="item in tags.list"
            :key="item.meta.tagId"
            :label="formatTagOptionLabel(item.meta, item.value?.quality)"
            :value="item.meta.tagId"
          />
        </el-select>
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="cfg-label">
            变量量程
            <HelpTip content="量程下限 → 0% 空罐，上限 → 100% 满罐。" />
          </span>
        </template>
        <div class="range-row">
          <el-input-number
            size="small"
            :model-value="inMin"
            controls-position="right"
            @update:model-value="(v: number | undefined) => setIn('inMin', v)"
          />
          <span class="range-sep">~</span>
          <el-input-number
            size="small"
            :model-value="inMax"
            controls-position="right"
            @update:model-value="(v: number | undefined) => setIn('inMax', v)"
          />
        </div>
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="cfg-label">
            生成方式
            <HelpTip content="推荐「沿用罐体形状」：复制罐体几何并裁剪液面，任意罐形自动贴合。图元模式适合规则圆柱/方罐。" />
          </span>
        </template>
        <el-radio-group :model-value="mode" size="small" @update:model-value="setMode">
          <el-radio-button value="shape">沿用罐体形状</el-radio-button>
          <el-radio-button value="primitive">圆柱 / 长方体图元</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item v-if="mode === 'primitive'">
        <template #label>
          <span class="cfg-label">
            液面形状
            <HelpTip content="自动按罐体横截面选择；也可强制圆柱或长方体。" />
          </span>
        </template>
        <el-radio-group :model-value="shape" size="small" @update:model-value="setShape">
          <el-radio-button value="auto">自动</el-radio-button>
          <el-radio-button value="cylinder">圆柱</el-radio-button>
          <el-radio-button value="box">长方体</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="cfg-label">
            液体颜色
            <HelpTip content="液体填充色。" />
          </span>
        </template>
        <div class="color-row">
          <el-color-picker :model-value="color" @update:model-value="setColor" />
          <span class="unit">{{ color }}</span>
        </div>
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="cfg-label">
            液体不透明度
            <HelpTip content="液体本身透明度；建议接近 1，靠罐壁透明度看清内部。" />
          </span>
        </template>
        <el-slider
          :min="0.05"
          :max="1"
          :step="0.05"
          :model-value="opacity"
          @update:model-value="(v: number | number[]) => setOpacity(Number(v))"
          @change="apply"
        />
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="cfg-label">
            内缩
            <HelpTip content="相对罐体内壁的内缩比例，避免液体穿模。" />
          </span>
        </template>
        <el-slider
          :min="0"
          :max="0.25"
          :step="0.01"
          :model-value="inset"
          @update:model-value="(v: number | number[]) => setInset(Number(v))"
          @change="apply"
        />
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="cfg-label">
            罐壁透明度
            <HelpTip content="调低罐壁透明度才能看清罐内液体（约 0.25~0.4）。" />
          </span>
        </template>
        <el-slider
          :min="0.05"
          :max="1"
          :step="0.05"
          :model-value="shellOpacity"
          @update:model-value="(v: number | number[]) => setShellOpacity(Number(v))"
          @change="apply"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="footer">
        <el-button v-if="isLiquidNode" type="danger" plain @click="removeLiquid">删除液位</el-button>
        <span class="spacer" />
        <el-button @click="visible = false">{{ isLiquidNode ? '关闭' : '取消' }}</el-button>
        <el-button v-if="!isLiquidNode" type="primary" @click="apply">应用</el-button>
        <el-button v-else type="primary" @click="visible = false">确定</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.cfg-alert {
  margin-bottom: 12px;
}

.cfg-label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  line-height: 1;
}

.cfg-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.cfg-form :deep(.el-form-item__label) {
  color: var(--scada-muted);
  font-size: 12px;
}

.cfg-form :deep(.el-select),
.cfg-form :deep(.el-slider) {
  width: 100%;
}

.range-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.range-row :deep(.el-input-number) {
  flex: 1;
}

.range-sep {
  margin: 0 2px;
  color: var(--scada-muted);
}

.color-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.unit {
  font-size: 12px;
  color: var(--scada-muted);
}

.footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.footer .spacer {
  flex: 1;
}
</style>
