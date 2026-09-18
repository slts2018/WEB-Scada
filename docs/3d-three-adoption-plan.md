# 3D 组态 · Three 能力采纳计划

> 原则：**渲染与交互尽量用 Three / examples；业务（工程 JSON、Tag、对象树）自研。**  
> 禁止再自研 TransformControls 拖拽 / 轴拾取。

## 大阶段

| 大阶段 | 内容 | 状态 |
|--------|------|------|
| **一** 基线与交互收口 | 官方 Orbit/TC、选中聚焦单入口、SelectionBox、冻结约定 | **完成** |
| **二** 场景可读性 | CSS2D 对象名（不做 OutlinePass 描边） | **完成** |
| **三** 模型与资源 | GLB/GLTF/OBJ/FBX/STL 统一加载 + 上传识别 | **完成** |
| **四** 观感与现场感 | RoomEnvironment、软阴影、地面接影 | **完成** |
| **五** 大规模性能 | `THREE.LOD` 距离代理 + frustumCulled | **完成** |
| **六** 业务补强 | 调色板/资源管理多格式、命名剥离扩展名、类型注释 | **完成** |

## 细项对照（历史编号）

| 编号 | 内容 | 状态 |
|------|------|------|
| 0 | 盘点 + 冻结 | 完成 |
| 1 | designer3dIntent | 完成 |
| 2 | SelectionBox | 完成 |
| 3 | CSS2D 标注 | 完成 |
| 4 | OutlinePass | **不做**（用户明确不要描边；选中靠发光 + BoxHelper） |
| 5～7 | 已并入大阶段三～五 | 完成 |

## 冻结

1. **禁止** `TransformControls.disconnect()` 后再自研轴拖。  
2. 树点选只用 `cameraFocus3dCmd`；「看选中」只用 `focus3dNonce`。  
3. **禁止** 在 `tick` 里每帧 `attachGizmo`。  
4. 新能力优先 `examples/jsm`，再薄适配。

## 明确不采纳（近期）

物理、WebXR、整套后处理炫光、WebGPU/TSL、第二套自研手柄、通用 InstancedMesh（对象多为异形，暂用 LOD）。

## 关键代码

- `shared/three/modelLoader.ts` — 多格式加载 + LOD 包装  
- `shared/three/scenePresentation.ts` — RoomEnvironment + 阴影  
- `shared/three/createScene3D.ts` — 接入上述能力  
- `shared/three/modelFit.ts` — 多格式测包围盒  
- 服务端 `detectKind` / 调色板 / 资源管理 accept  
