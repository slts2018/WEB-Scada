/**
 * 将旧工程包中的 3D 对象补齐 sourceSize/sourceUnit=m，
 * 保留 transform.scale（外观不变），属性栏「缩放（米）」显示真实世界尺寸。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { Box3, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 支持放在 scripts/ 或 apps/web/ 下执行
const root = fs.existsSync(path.join(__dirname, '.tmp-demo-project'))
  ? __dirname
  : fs.existsSync(path.join(__dirname, '..', '.tmp-demo-project'))
    ? path.resolve(__dirname, '..')
    : path.resolve(__dirname, '..', '..')
const demo = path.join(root, '.tmp-demo-project')
const projectPath = path.join(demo, 'project.json')

const PRIMITIVE_SOURCE_SIZE_M = {
  box: [1, 1, 1],
  sphere: [1.2, 1.2, 1.2],
  cylinder: [0.9, 1.2, 0.9],
  arrow: [0.44, 1.15, 0.44],
}

const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'))
const resMap = new Map((project.resources || []).map((r) => [r.id, r]))
const sizeCache = new Map()
const loader = new GLTFLoader()

function resolveResourceFile(resourceId, res) {
  const resourcesDir = path.join(demo, 'resources')
  const candidates = []
  if (res?.path) {
    candidates.push(path.join(demo, String(res.path).replace(/^\//, '')))
    candidates.push(path.join(resourcesDir, path.basename(String(res.path))))
  }
  if (fs.existsSync(resourcesDir)) {
    for (const f of fs.readdirSync(resourcesDir)) {
      if (f.startsWith(resourceId + '_') || f.startsWith(resourceId)) {
        candidates.push(path.join(resourcesDir, f))
      }
    }
  }
  return candidates.find((p) => fs.existsSync(p)) || null
}

function measureGlb(file) {
  const buf = fs.readFileSync(file)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Promise((resolve, reject) => {
    loader.parse(
      ab,
      pathToFileURL(path.dirname(file) + path.sep).href,
      (gltf) => {
        try {
          const rootObj = gltf.scene
          rootObj.updateMatrixWorld(true)
          const box = new Box3().setFromObject(rootObj)
          if (box.isEmpty()) {
            resolve([1, 1, 1])
            return
          }
          const size = new Vector3()
          box.getSize(size)
          resolve([
            Math.max(1e-12, size.x),
            Math.max(1e-12, size.y),
            Math.max(1e-12, size.z),
          ])
        } catch (e) {
          reject(e)
        }
      },
      reject,
    )
  })
}

async function measureResource(resourceId) {
  if (sizeCache.has(resourceId)) return sizeCache.get(resourceId)
  const res = resMap.get(resourceId)
  const file = resolveResourceFile(resourceId, res)
  if (!file) {
    console.warn('missing resource file', resourceId, res?.path)
    sizeCache.set(resourceId, [1, 1, 1])
    return [1, 1, 1]
  }
  try {
    const sourceSize = await measureGlb(file)
    sizeCache.set(resourceId, sourceSize)
    console.log(
      'measured',
      resourceId,
      path.basename(file),
      sourceSize.map((n) => Number(n.toFixed(4))).join(','),
    )
    return sourceSize
  } catch (e) {
    console.warn('measure fail', resourceId, e?.message || e)
    sizeCache.set(resourceId, [1, 1, 1])
    return [1, 1, 1]
  }
}

async function walk(objects) {
  let n = 0
  for (const o of objects || []) {
    if (o.modelResourceId) {
      o.sourceSize = await measureResource(o.modelResourceId)
      o.sourceUnit = 'm'
      n += 1
    } else if (o.primitive && PRIMITIVE_SOURCE_SIZE_M[o.primitive]) {
      if (!o.sourceSize) o.sourceSize = [...PRIMITIVE_SOURCE_SIZE_M[o.primitive]]
      o.sourceUnit = 'm'
      n += 1
    } else if ((o.children && o.children.length) || o.panel) {
      if (!o.sourceSize) o.sourceSize = [1, 1, 1]
      o.sourceUnit = 'm'
    }
    if (o.children?.length) n += await walk(o.children)
  }
  return n
}

let total = 0
for (const page of project.pages || []) {
  if (page.type !== '3d') continue
  total += await walk(page.objects)
}

if (project.meta) {
  project.meta.updatedAt = Date.now()
}

fs.writeFileSync(projectPath, JSON.stringify(project, null, 2), 'utf8')
console.log('updated objects:', total)
console.log('unique models measured:', sizeCache.size)
