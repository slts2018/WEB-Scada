package com.webscada.server.comm.config;

/** 链路点定义。Modbus 字段由驱动解释，不进入 IoRequest。 */
public record DataPoint(
    String id,
    int fc,
    int address,
    String type,
    String wordOrder,
    String byteOrder,
    double scale,
    double offset,
    Integer unit,
    String nodeId,
    String topic,
    String field,
    String path,
    String tagId) {

  public DataPoint {
    if (id == null) id = "";
    if (type == null) type = "";
    if (wordOrder == null || wordOrder.isBlank()) wordOrder = "high-first";
    if (byteOrder == null || byteOrder.isBlank()) byteOrder = "big";
    if (nodeId == null) nodeId = "";
    if (topic == null) topic = "";
    if (field == null) field = "";
    if (path == null) path = "";
    if (tagId == null || tagId.isBlank()) tagId = id;
    else tagId = tagId.trim();
  }

  /**
   * Modbus 写功能码是 5、6、15、16。0 表示这条协议没有功能码，不在这里拒绝。
   * 1、2、3、4 以及其余功能码视为不可写。
   */
  public boolean writableByFunction() {
    return fc == 0 || fc == 5 || fc == 6 || fc == 15 || fc == 16;
  }
}
