package com.webscada.server.mock;

import com.webscada.server.model.DeviceMeta;
import com.webscada.server.model.TagMeta;
import com.webscada.server.model.TagValue;
import java.util.List;

/** Mirrors packages/core/src/mock/tags.ts */
public final class MockTagData {

  public static final String DEFAULT_TAG_DEVICE_ID = "demo.plc";

  public static final TagMeta[] MOCK_TAGS =
      new TagMeta[] {
        new TagMeta(
            "demo.temp", "温度", "工艺", "demo.plc", "DB1.DBD0", "float", "℃", false, null, null, null, null, null, null, null, null),
        new TagMeta(
            "demo.pressure", "压力", "工艺", "demo.plc", "DB1.DBD4", "float", "kPa", false, null, null, null, null, null, null, null, null),
        new TagMeta(
            "demo.pump.run", "泵运行", "设备", "demo.plc", "M0.0", "bool", null, true, null, null, null, null, null, null, null, null),
        new TagMeta(
            "demo.valve.open", "阀开到位", "设备", "demo.plc", "M0.1", "bool", null, true, null, null, null, null, null, null, null, null),
        new TagMeta(
            "demo.level", "液位", "工艺", "demo.plc", "DB1.DBD8", "float", "%", false, null, null, null, null, null, null, null, null)
      };

  public static final DeviceMeta[] MOCK_DEVICES =
      new DeviceMeta[] {
        new DeviceMeta("demo.plc", "演示 PLC", "mock", "127.0.0.1:502", true, "本地 Mock 设备通道")
      };

  public static List<TagValue> createInitialMockValues() {
    long now = System.currentTimeMillis();
    return List.of(
        new TagValue("demo.temp", 36.5, "Good", now),
        new TagValue("demo.pressure", 101.3, "Good", now),
        new TagValue("demo.pump.run", false, "Good", now),
        new TagValue("demo.valve.open", true, "Good", now),
        new TagValue("demo.level", 62.0, "Good", now));
  }

  private MockTagData() {}
}
