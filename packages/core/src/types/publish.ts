import type { ProjectDocument } from './project'

/** Designer 发布给 Runtime 的包 */
export interface PublishManifest {
  projectId: string
  projectName: string
  publishVersion: string
  publishedAt: number
  homePageId?: string
  /** 相对包内路径 */
  documentPath: string
  resourceIndex: Array<{ id: string; path: string; kind: string }>
}

export interface PublishPackage {
  manifest: PublishManifest
  document: ProjectDocument
}
