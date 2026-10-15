<script setup lang="ts">
/**
 * 「管道流动」配置对话框（设计端）。
 * 改一项立即写入工程（与「动画连接」对话框一致，3D 预览所见即所得）；
 * 多选 / 「选中所有同模型对象」后，一次配置对整张管网批量生效。
 * 真正的写入在 store：setObject3dFlow
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { scadaConfirm } from '@/shared/ui/scadaMessageBox'
import type { AnimationLinkFlow } from '@web-scada/core'
import { FLOW_DEFAULT_COLOR } from '@/shared/three/flowMaterial'
import HelpTip from '@/components/designer/HelpTip.vue'
import { useProjectStore } from '@/stores/project'
import { useTagStore } from '@/stores/tag'
import { formatTagOptionLabel } from '@/shared/runtime/tagLabel'

const project = useProjectStore()
const tags = useTagStore()

const obj = computed(() => project.selectedObject3d)
const multiCount = computed(() => project.selectedObject3dIds.length)
/** 主选对象上的流动连接 */
const flowLink = computed(
  () =>
    (obj.value?.animationLinks ?? []).find((l) => l.type === 'flow') as
      | AnimationLinkFlow
      | undefined,
)
/** 生效对象：多选 = 全部选中；否则 = 当前对象 */
const targets = computed(() =>
  multiCount.value > 1
    ? project.selectedObject3dIds
    : obj.value
      ? [obj.value.id]
      : [],
)

const visible = computed({
  get: () => project.flowConfigOpen,
  set: (v: boolean) => {
    if (v) project.openFlowConfig()
    else project.closeFlowConfig()
  },
})

// —— 草稿：打开对话框 / 换对象时，从现有连接装入 ——
const tagId = ref('')
const inMin = ref(0)
const inMax = ref(100)
const speed = ref(0.5)
const stripe = ref<number | undefined>(undefined)
const color = ref(FLOW_DEFAULT_COLOR)
const axis = ref<'auto' | 'x' | 'y' | 'z'>('auto')
const style = ref<'skin' | 'ribbon' | 'chevron' | 'arrow' | 'stripe'>('skin')
const lobe = ref(0.45)
const size = ref<number | undefined>(undefined)
const alpha = ref(0.85)
const glow = ref(0)
const width = ref(1)
const thick = ref(0.22)
const reverse = computed({
  get: () => speed.value < 0,
  set: (v: boolean) => {
    speed.value = Math.abs(speed.value) * (v ? -1 : 1)
  },
})

watch(
  () => [visible.value, obj.value?.id, flowLink.value?.id] as const,
  () => {
    if (!visible.value) return
    const l = flowLink.value
    if (!l) {
      tagId.value = ''
      inMin.value = 0
      inMax.value = 100
      speed.value = 0.5
      stripe.value = undefined
      color.value = FLOW_DEFAULT_COLOR
      axis.value = 'auto'
      style.value = 'skin'
      lobe.value = 0.45
      size.value = undefined
      alpha.value = 0.85
      glow.value = 0
      width.value = 1
      thick.value = 0.22
      return
    }
    tagId.value = l.tagId
    inMin.value = l.inMin
    inMax.value = l.inMax
    speed.value = Number(l.speed) || 0
    stripe.value = l.stripe
    color.value = l.color ?? FLOW_DEFAULT_COLOR
    axis.value = l.axis ?? 'auto'
    style.value =
      l.style === 'stripe'
        ? 'stripe'
        : l.style === 'arrow'
          ? 'arrow'
          : l.style === 'chevron'
            ? 'chevron'
            : l.style === 'ribbon'
              ? 'ribbon'
              : 'skin'
    lobe.value =
      l.width != null && l.width < 0.9 ? Math.min(0.5, Math.max(0.12, l.width)) : 0.45
    size.value = l.size
    alpha.value = Math.min(1, Math.max(0.15, Number(l.alpha) || 0.85))
    glow.value = Math.min(1, Math.max(0, Number(l.glow) || 0))
    width.value = Math.min(1, Math.max(0.3, Number(l.width) || 1))
    thick.value = Math.min(0.5, Math.max(0.06, Number(l.thick) || 0.22))
  },
  { immediate: true },
)

/** 改一项立即写入（没有变量时不写，避免生成空连接） */
function apply() {
  const ids = targets.value
  if (!ids.length || !tagId.value) return
  project.setObject3dFlow(ids, {
    tagId: tagId.value,
    inMin: Number(inMin.value) || 0,
    inMax: Number(inMax.value) || 0,
    speed: Number(speed.value) || 0,
    stripe:
      stripe.value != null && Number(stripe.value) > 0.005 ? Number(stripe.value) : undefined,
    color: color.value,
    axis: axis.value,
    style: style.value,
    width: style.value === 'skin' ? lobe.value : width.value,
    thick: thick.value,
    size: size.value,
    alpha: alpha.value,
    glow: glow.value,
  })
}

/** 管网批量：一键选中本页所有同模型对象（对话框不关，接着批量应用） */
function selectSameModel() {
  const resourceId = obj.value?.modelResourceId
  if (!resourceId) {
    ElMessage.warning('当前对象不是模型对象')
    return
  }
  const n = project.selectObject3dsByModel(resourceId)
  if (!n) {
    ElMessage.warning('本页没有同模型对象')
    return
  }
  ElMessage.success(`已选中 ${n} 个同模型对象，改任意一项即对它们批量生效`)
}

async function removeFlow() {
  const ids = targets.value
  if (!ids.length) return
  try {
    await scadaConfirm(`删除 ${ids.length} 个对象上的流动效果？`, '删除流动效果', {
      confirmButtonText: '删除',
    })
  } catch {
    return
  }
  project.setObject3dFlow(ids, null)
  ElMessage.success('已删除流动效果')
}

const styleHint = computed(() => {
  switch (style.value) {
    case 'skin':
      return '贴皮箭头：贴在朝向相机那一面的管壁上，长杆 + 三角头，任何视角都不会缩成一条线。'
    case 'ribbon':
      return '浮空箭头：在管子两侧浮一排平面箭头，俯视角最清楚。'
    case 'chevron':
      return '斜箭：管面上一串「»」，可加光晕。'
    case 'arrow':
      return '锥形箭头：绕管一圈的锥形，任何视角都看得见。'
    default:
      return '条纹：沿管长滚动的色带。'
  }
})

const stripeHint = computed(() =>
  style.value === 'skin'
    ? '留空 = 按管径自动（约 110 倍管径，3~14 米）'
    : '留空 = 按管径自动（约 6 倍最小边）',
)

// —— 控件回调（Element 的 emit 类型很宽，这里收窄成联合类型）——
function setTag(v: unknown) {
  tagId.value = String(v ?? '')
  apply()
}

function setStyle(v: unknown) {
  style.value =
    v === 'ribbon' || v === 'chevron' || v === 'arrow' || v === 'stripe' ? v : 'skin'
  apply()
}

function setAxis(v: unknown) {
  axis.value = v === 'x' || v === 'y' || v === 'z' ? v : 'auto'
  apply()
}

function setReverse(v: string | number | boolean) {
  reverse.value = Boolean(v)
  apply()
}

function setColor(v: string | null) {
  if (!v) return
  color.value = v
  apply()
}

function setSize(v: number | undefined) {
  size.value = v == null ? undefined : Number(v)
}

function setStripe(v: number | undefined) {
  stripe.value = v == null ? undefined : Number(v)
}

function setSpeed(v: number | undefined) {
  speed.value = Number(v) || 0
}

function setIn(v: 'inMin' | 'inMax', value: number | undefined) {
  if (v === 'inMin') inMin.value = Number(value) || 0
  else inMax.value = Number(value) || 0
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="flowLink ? '流动配置' : '添加流动效果'"
    width="620px"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    class="flow-config-dialog"
  >
    <el-form class="cfg-form" label-width="96px" label-position="right" @submit.prevent>
      <el-alert class="cfg-alert" type="info" :closable="false" show-icon>
        <template v-if="multiCount > 1">
          按「{{ obj?.name }}」的最长轴当流向（直管即管长方向）；当前选中 {{ multiCount }} 个对象，改一项即批量生效。
        </template>
        <template v-else-if="flowLink">
          按「{{ obj?.name }}」的最长轴当流向（直管即管长方向），速度由变量驱动，不依赖模型 UV。改一项立即生效，可同时在 3D 视图里看效果。
        </template>
        <template v-else>
          按「{{ obj?.name }}」的最长轴当流向（直管即管长方向），速度由变量驱动，不依赖模型 UV。
        </template>
      </el-alert>

      <el-divider content-position="left">驱动变量</el-divider>

      <el-form-item required>
        <template #label>
          <span class="cfg-label">
            变量
            <HelpTip content="流量 / 状态变量。先选变量后改参数才会写入；运行时变量为 0 或测点坏 → 停流并隐藏箭头。" />
          </span>
        </template>
        <el-select
          filterable
          placeholder="请选择流量 / 状态变量"
          popper-class="flow-config-select-dropdown"
          :model-value="tagId"
          @update:model-value="setTag"
        >
          <el-option
            v-for="item in tags.list"
            :key="item.meta.tagId"
            :label="formatTagOptionLabel(item.meta, item.value?.quality)"
            :value="item.meta.tagId"
          />
        </el-select>
        <div v-if="!tagId" class="form-warn">先选变量，之后改参数才会生效</div>
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="cfg-label">
            量程
            <HelpTip content="映射到速度系数 0~1；变量为 0 即停流。" />
          </span>
        </template>
        <div class="range-row">
          <el-input-number
            :model-value="inMin"
            controls-position="right"
            @update:model-value="(v: number | undefined) => setIn('inMin', v)"
            @change="apply"
          />
          <span class="range-sep">~</span>
          <el-input-number
            :model-value="inMax"
            controls-position="right"
            @update:model-value="(v: number | undefined) => setIn('inMax', v)"
            @change="apply"
          />
        </div>
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="cfg-label">
            基准速度
            <HelpTip content="变量满量程时的滚动速度（米/秒）。" />
          </span>
        </template>
        <el-input-number
          :model-value="speed"
          :step="0.1"
          :precision="2"
          controls-position="right"
          @update:model-value="setSpeed"
          @change="apply"
        />
        <span class="unit">米/秒（满速）</span>
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="cfg-label">
            流动方向
            <HelpTip content="正向 / 反向：沿流向轴翻转箭头运动方向。" />
          </span>
        </template>
        <el-switch
          :model-value="reverse"
          active-text="反向"
          inactive-text="正向"
          inline-prompt
          @update:model-value="setReverse"
        />
      </el-form-item>

      <el-divider content-position="left">箭头样式</el-divider>

      <el-form-item>
        <template #label>
          <span class="cfg-label">
            样式
            <HelpTip :content="styleHint" />
          </span>
        </template>
        <el-radio-group :model-value="style" @update:model-value="setStyle">
          <el-radio-button value="skin">贴皮箭头</el-radio-button>
          <el-radio-button value="ribbon">浮空箭头</el-radio-button>
          <el-radio-button value="chevron">管面斜箭</el-radio-button>
          <el-radio-button value="arrow">锥形箭头</el-radio-button>
          <el-radio-button value="stripe">条纹</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item v-if="style === 'skin'">
        <template #label>
          <span class="cfg-label">
            贴皮宽度
            <HelpTip content="贴皮箭头在管壁上的覆盖宽度比例。" />
          </span>
        </template>
        <el-slider
          :model-value="Math.round(lobe * 100)"
          :min="12"
          :max="50"
          :step="2"
          @update:model-value="(v: number | number[]) => (lobe = Number(v) / 100)"
          @change="apply"
        />
      </el-form-item>

      <el-form-item v-if="style === 'skin' || style === 'ribbon'">
        <template #label>
          <span class="cfg-label">
            箭头长度
            <HelpTip
              :content="
                style === 'skin' ? '留空 = 0.72 × 间隔（默认长箭头）' : '留空 = 0.62 × 间隔'
              "
            />
          </span>
        </template>
        <el-input-number
          :model-value="size"
          placeholder="自动"
          :min="0"
          :step="0.1"
          :precision="2"
          controls-position="right"
          @update:model-value="setSize"
          @change="apply"
        />
        <span class="unit">米</span>
      </el-form-item>

      <el-form-item v-if="style === 'ribbon'">
        <template #label>
          <span class="cfg-label">
            不透明度
            <HelpTip content="浮空箭头的透明度；过低在亮背景下不易看见。" />
          </span>
        </template>
        <el-slider
          :model-value="Math.round(alpha * 100)"
          :min="15"
          :max="100"
          :step="5"
          @update:model-value="(v: number | number[]) => (alpha = Number(v) / 100)"
          @change="apply"
        />
      </el-form-item>

      <el-form-item v-if="style === 'chevron'">
        <template #label>
          <span class="cfg-label">
            斜箭粗细
            <HelpTip content="管面「»」斜箭笔画粗细。" />
          </span>
        </template>
        <el-slider
          :model-value="Math.round(thick * 100)"
          :min="6"
          :max="50"
          :step="2"
          @update:model-value="(v: number | number[]) => (thick = Number(v) / 100)"
          @change="apply"
        />
      </el-form-item>

      <el-form-item v-if="style === 'arrow'">
        <template #label>
          <span class="cfg-label">
            箭头宽度
            <HelpTip content="100% = 整圈包裹，任何视角都看得见。" />
          </span>
        </template>
        <el-slider
          :model-value="Math.round(width * 100)"
          :min="30"
          :max="100"
          :step="5"
          @update:model-value="(v: number | number[]) => (width = Number(v) / 100)"
          @change="apply"
        />
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="cfg-label">
            光晕
            <HelpTip content="0 = 纯色箭头；拉大才有亮芯和外圈柔光。" />
          </span>
        </template>
        <el-slider
          :model-value="Math.round(glow * 100)"
          :min="0"
          :max="100"
          :step="5"
          @update:model-value="(v: number | number[]) => (glow = Number(v) / 100)"
          @change="apply"
        />
      </el-form-item>

      <el-divider content-position="left">节奏与颜色</el-divider>

      <el-form-item>
        <template #label>
          <span class="cfg-label">
            间隔
            <HelpTip :content="stripeHint" />
          </span>
        </template>
        <el-input-number
          :model-value="stripe"
          placeholder="自动"
          :min="0"
          :step="0.05"
          :precision="2"
          controls-position="right"
          @update:model-value="setStripe"
          @change="apply"
        />
        <span class="unit">米/个</span>
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="cfg-label">
            箭头颜色
            <HelpTip content="流动箭头 / 条纹的显示颜色。" />
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
            流向轴
            <HelpTip content="直管用「自动」即可（取物体最长轴）。弯管或方向不对时再手动指定 X/Y/Z。" />
          </span>
        </template>
        <el-select
          placeholder="自动（最长轴）"
          popper-class="flow-config-select-dropdown"
          :model-value="axis"
          @update:model-value="setAxis"
        >
          <el-option label="自动（最长轴）" value="auto" />
          <el-option label="X 轴" value="x" />
          <el-option label="Y 轴" value="y" />
          <el-option label="Z 轴" value="z" />
        </el-select>
      </el-form-item>

      <el-form-item label-width="0">
        <el-button style="width: 100%" @click="selectSameModel">
          选中所有同模型对象（管网批量）
        </el-button>
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="footer">
        <el-button v-if="flowLink" type="danger" plain @click="removeFlow">
          删除流动效果
        </el-button>
        <span class="spacer" />
        <el-button @click="visible = false">{{ flowLink ? '关闭' : '取消' }}</el-button>
        <el-button v-if="!flowLink" type="primary" @click="apply">应用</el-button>
        <el-button v-else type="primary" @click="visible = false">确定</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
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

.cfg-form :deep(.el-divider) {
  margin: 2px 0 16px;
}

.cfg-form :deep(.el-divider--horizontal) {
  border-top-color: var(--scada-border);
}

.cfg-form :deep(.el-divider__text) {
  left: 0;
  padding: 0 8px 0 0;
  font-size: 12px;
  color: var(--scada-muted);
}

.cfg-alert.el-alert {
  --el-alert-bg-color: #12151c;
  margin-bottom: 2px;
  padding: 8px 12px;
  border: 1px solid var(--scada-border);
  border-left: 2px solid var(--scada-accent);
  border-radius: 6px;
  background: #12151c !important;
  color: var(--scada-muted) !important;
}

.cfg-alert :deep(.el-alert__icon) {
  width: 14px;
  margin-right: 8px;
  color: var(--scada-accent);
}

.cfg-alert :deep(.el-alert__content) {
  padding: 0;
}

.cfg-alert :deep(.el-alert__description) {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--scada-muted) !important;
}

.cfg-label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  line-height: 1;
}

.form-warn {
  flex: 0 0 100%;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: #f59e0b;
}

.range-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 420px;
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
  margin-left: 10px;
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
