/**
 * 统一风格的 Element Plus MessageBox（深色 scada-message-box）。
 */
import { ElMessageBox, type ElMessageBoxOptions } from 'element-plus'

const baseOpts = (): ElMessageBoxOptions => ({
  confirmButtonText: '确定',
  cancelButtonText: '取消',
  closeOnClickModal: false,
  customClass: 'scada-message-box',
  appendTo: document.body,
})

function mergeClass(
  extra?: string,
  opts?: ElMessageBoxOptions,
): ElMessageBoxOptions {
  const base = baseOpts()
  const customClass = [base.customClass, extra, opts?.customClass]
    .filter(Boolean)
    .join(' ')
  return { ...base, ...opts, customClass }
}

/** 确认框；取消会 reject（与 ElMessageBox.confirm 一致） */
export function scadaConfirm(
  message: string,
  title = '确认',
  opts?: ElMessageBoxOptions & { topLayer?: boolean },
) {
  const { topLayer, ...rest } = opts ?? {}
  return ElMessageBox.confirm(
    message,
    title,
    mergeClass(topLayer ? 'scada-message-box--top' : undefined, {
      type: 'warning',
      ...rest,
    }),
  )
}

/** 输入框 */
export function scadaPrompt(
  message: string,
  title = '请输入',
  opts?: ElMessageBoxOptions,
) {
  return ElMessageBox.prompt(message, title, mergeClass(undefined, opts))
}
