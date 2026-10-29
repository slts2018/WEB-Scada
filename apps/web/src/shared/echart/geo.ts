import { registerMap } from 'echarts/core'

let ready = false
let pending: Promise<void> | null = null

export function geoReady(): boolean {
  return ready
}

async function load(name: string, url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  registerMap(name, await res.json())
}

/** 中国 / 湖北边界。设计端启动后预取，地图图元第一次绘制前也会等它。 */
export function ensureGeo(): Promise<void> {
  if (ready) return Promise.resolve()
  if (!pending) {
    pending = Promise.all([load('china', '/geo/china.json'), load('hubei', '/geo/hubei.json')])
      .then(() => {
        ready = true
      })
      .catch((err) => {
        pending = null
        console.warn('[echart] 地图数据加载失败', err)
      })
  }
  return pending
}

void ensureGeo()
