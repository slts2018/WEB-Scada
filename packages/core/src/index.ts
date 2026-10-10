export type * from './types/tag'
export { DEFAULT_TAG_DEVICE_ID } from './types/tag'
export type * from './types/binding'
export type * from './types/animation'
export type * from './types/animationLink'
export type * from './types/event'
export { EVENT_TRIGGER_OPTIONS } from './types/event'
export type * from './types/project'
export type * from './types/publish'

export {
  ANIMATION_LINK_TREE,
  OBJECT3D_LINK_TREE,
  INTERACTIVE_LINK_TYPES,
  animationLinkTypeLabel,
} from './types/animationLink'
export type { AnimationLinkType } from './types/animationLink'

export {
  createEmptyProject,
  createPage2D,
  createPage3D,
  clonePage,
  clonePageWithNewIds,
  createPageTemplate,
  createLayer2D,
  createGuideLine,
  createSymbolDefinition,
  normalizeProjectDocument,
  migratePanelWidgetsToPages,
  isObject3dPanelPage,
  listNavigationPages,
} from './factory/project'
export {
  createWidget2D,
  BUILTIN_WIDGETS,
  DRAW_TOOL_TYPES,
  isDrawToolType,
  parsePointList,
  normalizePolyPoints,
  parseSeries,
  parseListItems,
} from './factory/widget'
export type { BuiltinWidgetType, DrawToolType, WidgetPaletteItem } from './factory/widget'
export {
  createObject3D,
  createDefaultObject3DPanel,
  createDefaultObject3DMaterial,
} from './factory/object3d'
export type { BuiltinPrimitive3D } from './factory/object3d'
export {
  PRIMITIVE_SOURCE_SIZE_M,
  roundMeters3,
  resolveSourceUnit,
  sourceUnitToMeters,
  resolveSourceSize,
  sizeMetersFromObject3d,
  threeScaleFromSizeMeters,
  patchObject3dSizeMeters,
} from './factory/object3dSize'
export {
  defaultPanelItemSize,
  resolvePanelItemRect,
  clampPanelItemRect,
  clampPanelItemRectForType,
  defaultPanelFontSize,
  defaultPanelTitleBarHeight,
  resolvePanelTitleBarHeight,
  resolvePanelContentSize,
  DEFAULT_PANEL_CONTENT_WIDTH,
  DEFAULT_PANEL_CONTENT_HEIGHT,
  DEFAULT_PANEL_TITLE_BAR_HEIGHT,
  MIN_PANEL_CONTENT_WIDTH,
  MIN_PANEL_CONTENT_HEIGHT,
  MAX_PANEL_CONTENT_SIZE,
} from './factory/panelLayout'
export type { PanelItemRect } from './factory/panelLayout'
export {
  PANEL_WIDGET_TYPES,
  isPanelWidgetType,
  panelItemToWidget,
  panelItemsToWidgets,
  widgetToPanelItem,
  widgetsToPanelItems,
  resolvePanelWidgets,
  normalizeObject3DPanel,
  normalizeObject3dPanelsInTree,
  createDefaultPanelWidgets,
  panelWidgetWriteAction,
  panelWidgetValueTagId,
  panelWidgetPrimaryTagId,
  setPanelWidgetValueTag,
  setPanelWidgetWriteTag,
} from './factory/panelWidgets'
export type { PanelWidgetType } from './factory/panelWidgets'
export {
  DEFAULT_PAGE3D_PRESENTATION,
  resolvePage3DPresentation,
  sunPositionFromAngles,
} from './factory/page3dPresentation'
export type { ResolvedPage3DPresentation } from './factory/page3dPresentation'
export { MOCK_TAG_METAS, MOCK_DEVICES, createInitialMockValues } from './mock/tags'