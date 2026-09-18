# @web-scada/core

设计端与运行端共享的**契约层**：

- Tag / 质量码
- 工程 · 页面(2D|3D) · 图元 · 绑定 · 动画 · 事件
- 发布包 `PublishPackage`
- Mock Tag 与空工程工厂方法

后续采集、后端、Runtime 都应对齐本包类型，避免两端各写一套模型。
