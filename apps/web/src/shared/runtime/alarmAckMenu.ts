/**
 * 运行端实时报警：右键菜单「确认」，再弹一次确认框后才提交。
 */
import { ElMessage } from 'element-plus'
import { scadaConfirm } from '@/shared/ui/scadaMessageBox'
import { useTagStore } from '@/stores/tag'

let menuEl: HTMLDivElement | null = null

function closeAlarmAckMenu() {
  menuEl?.remove()
  menuEl = null
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('scroll', closeAlarmAckMenu, true)
  window.removeEventListener('resize', closeAlarmAckMenu)
}

function onPointerDown(event: PointerEvent) {
  if (menuEl && event.target instanceof Node && menuEl.contains(event.target)) return
  closeAlarmAckMenu()
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeAlarmAckMenu()
}

export function openRuntimeAlarmMenu(alarmId: string, clientX: number, clientY: number) {
  closeAlarmAckMenu()
  const tags = useTagStore()
  const alarm = tags.activeAlarms.find((item) => item.alarmId === alarmId)
  const canAck = alarm == null || !alarm.acked
  const label = alarm?.name?.trim() || alarmId

  const menu = document.createElement('div')
  menu.className = 'scada-alarm-ack-menu'
  menu.setAttribute('role', 'menu')
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'scada-alarm-ack-menu__item'
  item.textContent = canAck ? '确认' : '已确认'
  item.disabled = !canAck
  item.setAttribute('role', 'menuitem')
  item.addEventListener('pointerdown', (event) => event.stopPropagation())
  item.addEventListener('click', () => {
    closeAlarmAckMenu()
    if (!canAck) return
    void confirmAndAck(alarmId, label)
  })
  menu.appendChild(item)
  document.body.appendChild(menu)

  const pad = 8
  const box = menu.getBoundingClientRect()
  const left = Math.min(clientX, window.innerWidth - box.width - pad)
  const top = Math.min(clientY, window.innerHeight - box.height - pad)
  menu.style.left = `${Math.max(pad, left)}px`
  menu.style.top = `${Math.max(pad, top)}px`

  menuEl = menu
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('scroll', closeAlarmAckMenu, true)
  window.addEventListener('resize', closeAlarmAckMenu)
}

async function confirmAndAck(alarmId: string, label: string) {
  try {
    await scadaConfirm(`确认报警「${label}」？`, '确认报警', {
      topLayer: true,
      confirmButtonText: '确认',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  const res = await useTagStore().ackAlarm(alarmId)
  if (!res.ok) ElMessage.error(res.message)
}
