package com.webscada.server.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webscada.server.model.TagValue;
import java.io.IOException;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

@Component
public class TagSessionRegistry {
  private static final Logger log = LoggerFactory.getLogger(TagSessionRegistry.class);
  private final ObjectMapper mapper = new ObjectMapper();
  private final Set<TagSession> sessions = ConcurrentHashMap.newKeySet();

  public void add(TagSession session) {
    sessions.add(session);
  }

  public void remove(WebSocketSession raw) {
    sessions.removeIf(s -> s.session().getId().equals(raw.getId()));
  }

  public TagSession find(WebSocketSession raw) {
    return sessions.stream()
        .filter(s -> s.session().getId().equals(raw.getId()))
        .findFirst()
        .orElse(null);
  }

  public void broadcastDelta(List<TagValue> changed) {
    if (changed == null || changed.isEmpty() || sessions.isEmpty()) return;
    for (TagSession client : sessions) {
      if (!client.session().isOpen()) continue;
      List<TagValue> filtered =
          client.subscribed() == null
              ? changed
              : changed.stream().filter(v -> client.subscribed().contains(v.tagId())).toList();
      if (filtered.isEmpty()) continue;
      send(client.session(), MapOf.delta(filtered));
    }
  }

  /** 报警等非 Tag 报文：所有已连接客户端都收，不按变量订阅过滤。 */
  public void broadcastRaw(Object payload) {
    if (payload == null || sessions.isEmpty()) return;
    for (TagSession client : sessions) {
      if (!client.session().isOpen()) continue;
      send(client.session(), payload);
    }
  }

  public void send(WebSocketSession session, Object payload) {
    try {
      session.sendMessage(new TextMessage(mapper.writeValueAsString(payload)));
    } catch (IOException e) {
      log.debug("ws send failed: {}", e.toString());
    }
  }

  /** tiny helper maps */
  public static final class MapOf {
    private MapOf() {}

    public static java.util.Map<String, Object> delta(List<TagValue> values) {
      return java.util.Map.of("type", "tag.delta", "values", values);
    }

    public static java.util.Map<String, Object> snapshot(Object metas, List<TagValue> values) {
      java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
      m.put("type", "tag.snapshot");
      m.put("metas", metas);
      m.put("values", values);
      return m;
    }

    public static java.util.Map<String, Object> writeResult(
        boolean ok, String message, String tagId, TagValue value) {
      java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
      m.put("type", "tag.writeResult");
      m.put("ok", ok);
      m.put("message", message);
      m.put("tagId", tagId);
      if (value != null) m.put("value", value);
      return m;
    }
  }
}
