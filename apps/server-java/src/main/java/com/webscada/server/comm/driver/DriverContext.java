package com.webscada.server.comm.driver;

import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.log.LinkLog;
import com.webscada.server.comm.metrics.LinkStats;
import java.time.Clock;

/** Driver 只能使用这里注入的日志、指标和时钟，不能自己创建。 */
public record DriverContext(
    String linkId,
    String sessionId,
    String correlationId,
    LinkDefinition.Endpoint endpoint,
    int connectTimeoutMs,
    int responseTimeoutMs,
    LinkLog log,
    LinkStats stats,
    Clock clock) {}
