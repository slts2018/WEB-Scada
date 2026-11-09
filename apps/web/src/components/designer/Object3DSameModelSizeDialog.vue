<script setup lang="ts">
/**
 * 多选同一模型后改轴向尺寸（米）。
 * 输入的是主选尺寸；确认时按相对主选的倍数，改每一份自己的尺寸。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  patchObject3dSizeMeters,
  roundMeters3,
  sizeMetersFromObject3d,
  type Object3DNode,
} from '@web-scada/core'
import { useProjectStore } from '@/stores/project'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  'update:visible': [boolean]
  applied: [ids: string[]]
}>()

const project = useProjectStore()
const uniform = ref(true)
const draft = ref<[number, number, number]>([1, 1, 1])
const base = ref<[number, number, number]>([1, 1, 1])
const resourceId = ref('')
const ids = ref<string[]>([])

const open = computed({
  get: () => props.visible,
  set: (v: boolean) => emit('update:visible', v),
})

const modelName = computed(
  () => project.document.resources.find((r) => r.id === resourceId.value)?.name || '模型',
)

watch(
  () => props.visible,
  (shown) => {
    if (!shown) return
    const idsInOrder = project.selectedObject3dIds
      .map((id) => project.findObject3dById(id))
      .filter((o): o is Object3DNode => Boolean(o))
    const id = idsInOrder[0]?.modelResourceId
    if (!id || idsInOrder.length < 2 || idsInOrder.some((o) => o.modelResourceId !== id)) {
      emit('update:visible', false)
      return
    }
    resourceId.value = id
    ids.value = idsInOrder.map((o) => o.id)
    const meters = sizeMetersFromObject3d(idsInOrder[0])
    base.value = [meters[0], meters[1], meters[2]]
    draft.value = [meters[0], meters[1], meters[2]]
    uniform.value = true
  },
)

function setAxis(index: 0 | 1 | 2, value: number | undefined | null) {
  if (value == null || !Number.isFinite(value)) return
  const safe = Math.max(0.001, value)
  const origin = base.value
  if (uniform.value && origin[index] > 1e-9) {
    const factor = safe / origin[index]
    draft.value = origin.map((v) => roundMeters3(Math.max(0.001, v * factor))) as [
      number,
      number,
      number,
    ]
    return
  }
  const next: [number, number, number] = [draft.value[0], draft.value[1], draft.value[2]]
  next[index] = roundMeters3(safe)
  draft.value = next
}

function apply() {
  const origin = base.value
  const nextDraft = draft.value
  const factor = ([0, 1, 2] as const).map((i) =>
    origin[i] > 1e-9 ? nextDraft[i] / origin[i] : 1,
  )
  if (factor.every((f) => Math.abs(f - 1) < 1e-6)) {
    emit('update:visible', false)
    return
  }
  const patches: Record<string, Object3DNode['transform']> = {}
  for (const id of ids.value) {
    const node = project.findObject3dById(id)
    if (!node || node.locked || node.modelResourceId !== resourceId.value) continue
    const cur = sizeMetersFromObject3d(node)
    const sized: [number, number, number] = [
      roundMeters3(Math.max(0.001, cur[0] * factor[0])),
      roundMeters3(Math.max(0.001, cur[1] * factor[1])),
      roundMeters3(Math.max(0.001, cur[2] * factor[2])),
    ]
    patches[id] = patchObject3dSizeMeters(node, sized).transform
  }
  const applied = Object.keys(patches)
  if (!applied.length) {
    ElMessage.warning('没有可修改的同模型对象')
    emit('update:visible', false)
    return
  }
  project.commitObject3dTransforms(patches)
  emit('applied', applied)
  emit('update:visible', false)
  ElMessage.success(`已按倍数修改 ${applied.length} 个「${modelName.value}」的尺寸`)
}
</script>

<template>
  <el-dialog
    v-model="open"
    :title="`改尺寸 · ${modelName}`"
    width="420px"
    align-center
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
  >
    <p class="hint">
      当前 {{ ids.length }} 个都是「{{ modelName }}」。这里显示主选的尺寸，确定后其余对象按同样倍数缩放，长短比例还在。
    </p>
    <label class="lock">
      <input v-model="uniform" type="checkbox" />
      等比锁定
    </label>
    <div class="axes">
      <label v-for="(axis, i) in (['X', 'Y', 'Z'] as const)" :key="axis">
        <span>{{ axis }}（米）</span>
        <el-input-number
          size="small"
          :model-value="draft[i]"
          :min="0.001"
          :step="0.001"
          :precision="3"
          controls-position="right"
          @change="(v: number | undefined) => setAxis(i as 0 | 1 | 2, v)"
        />
      </label>
    </div>
    <template #footer>
      <el-button @click="open = false">取消</el-button>
      <el-button type="primary" @click="apply">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin: 0 0 12px;
  color: var(--scada-muted, #94a3b8);
  font-size: 12px;
  line-height: 1.5;
}

.lock {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 13px;
}

.axes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.axes label {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
</style>
