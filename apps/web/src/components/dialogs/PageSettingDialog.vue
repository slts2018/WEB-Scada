<script setup lang="ts">
import { reactive, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    mode?: 'create' | 'edit'
    defaultType?: '2d' | '3d'
    name?: string
    width?: number
    height?: number
    background?: string
  }>(),
  {
    mode: 'create',
    defaultType: '2d',
    name: '新页面',
    width: 1920,
    height: 1080,
    background: '#1a1d24',
  },
)

const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [
    payload: {
      name: string
      type: '2d' | '3d'
      width: number
      height: number
      background: string
    },
  ]
}>()

const form = reactive({
  name: props.name,
  type: props.defaultType as '2d' | '3d',
  width: props.width,
  height: props.height,
  background: props.background,
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    form.name = props.name
    form.type = props.mode === 'edit' ? props.defaultType : props.defaultType
    form.width = props.width
    form.height = props.height
    form.background = props.background
  },
)

function close() {
  emit('update:modelValue', false)
}

function ok() {
  const name = form.name.trim()
  if (!name) return
  if (form.type === '2d' && (form.width <= 0 || form.height <= 0)) return
  emit('confirm', {
    name,
    type: form.type,
    width: Number(form.width) || 1920,
    height: Number(form.height) || 1080,
    background: form.background || '#1a1d24',
  })
  close()
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="mode === 'create' ? '新建页面' : '页面设置'"
    width="520px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="form">
      <label>
        <span>窗口名字</span>
        <el-input v-model="form.name" maxlength="80" />
      </label>

      <label v-if="mode === 'create'">
        <span>页面类型</span>
        <el-radio-group v-model="form.type">
          <el-radio-button value="2d">2D 画面</el-radio-button>
          <el-radio-button value="3d">3D 场景</el-radio-button>
        </el-radio-group>
      </label>

      <fieldset v-if="form.type === '2d'" class="box">
        <legend>位置大小</legend>
        <div class="row">
          <label>
            <span>宽度</span>
            <el-input-number v-model="form.width" :min="100" :max="10000" controls-position="right" />
          </label>
          <label>
            <span>高度</span>
            <el-input-number
              v-model="form.height"
              :min="100"
              :max="10000"
              controls-position="right"
            />
          </label>
        </div>
        <label>
          <span>背景色</span>
          <el-color-picker v-model="form.background" />
        </label>
      </fieldset>
    </div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :disabled="!form.name.trim()" @click="ok">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

label {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 10px;
  align-items: center;
  font-size: 13px;
  color: var(--scada-muted);
}

.box {
  margin: 0;
  padding: 12px;
  border: 1px solid var(--scada-border);
  border-radius: 6px;
}

.box legend {
  padding: 0 6px;
  font-size: 12px;
  color: var(--scada-muted);
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.row label {
  grid-template-columns: 40px 1fr;
}
</style>
