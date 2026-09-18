/**
 * 深拷贝可 JSON 化的纯数据。
 * 浏览器对 Vue/Pinia Proxy 调用 structuredClone 会抛：
 * Failed to execute 'structuredClone' on 'Window': #<Object> could not be cloned.
 */
export function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
