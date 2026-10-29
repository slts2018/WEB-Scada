package com.webscada.server.comm.driver;

/** 读写/订阅的占位请求。具体协议字段留到后续阶段。 */
public record IoRequest(String correlationId, String pointId, Object value) {}
