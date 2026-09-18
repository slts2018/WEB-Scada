import type { DeviceMeta, TagMeta, TagValue } from '../types/tag'

/** 前期 Mock Tag，供设计绑定与运行演示 */
export const MOCK_TAG_METAS: TagMeta[] = [
  {
    tagId: 'demo.temp',
    name: '温度',
    group: '工艺',
    deviceId: 'demo.plc',
    address: 'DB1.DBD0',
    dataType: 'float',
    unit: '℃',
    writable: false,
  },
  {
    tagId: 'demo.pressure',
    name: '压力',
    group: '工艺',
    deviceId: 'demo.plc',
    address: 'DB1.DBD4',
    dataType: 'float',
    unit: 'kPa',
    writable: false,
  },
  {
    tagId: 'demo.pump.run',
    name: '泵运行',
    group: '设备',
    deviceId: 'demo.plc',
    address: 'M0.0',
    dataType: 'bool',
    writable: true,
  },
  {
    tagId: 'demo.valve.open',
    name: '阀开到位',
    group: '设备',
    deviceId: 'demo.plc',
    address: 'M0.1',
    dataType: 'bool',
    writable: true,
  },
  {
    tagId: 'demo.level',
    name: '液位',
    group: '工艺',
    deviceId: 'demo.plc',
    address: 'DB1.DBD8',
    dataType: 'float',
    unit: '%',
    writable: false,
  },
]

export const MOCK_DEVICES: DeviceMeta[] = [
  {
    deviceId: 'demo.plc',
    name: '演示 PLC',
    protocol: 'mock',
    channel: '127.0.0.1:502',
    enabled: true,
    description: '本地 Mock 设备通道',
  },
]

export function createInitialMockValues(): TagValue[] {
  const now = Date.now()
  return [
    { tagId: 'demo.temp', value: 36.5, quality: 'Good', timestamp: now },
    { tagId: 'demo.pressure', value: 101.3, quality: 'Good', timestamp: now },
    { tagId: 'demo.pump.run', value: false, quality: 'Good', timestamp: now },
    { tagId: 'demo.valve.open', value: true, quality: 'Good', timestamp: now },
    { tagId: 'demo.level', value: 62, quality: 'Good', timestamp: now },
  ]
}
