package com.webscada.server.comm.data;

/** 时间戳均为 UTC 毫秒。 */
public record PointSample(
    String pointId,
    Object value,
    Quality quality,
    Long sourceTs,
    long recvTs,
    Long lastGoodTs) {}
