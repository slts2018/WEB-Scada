package com.webscada.server.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.webscada.server.config.ScadaProperties;
import com.webscada.server.service.AlarmRuntimeService;
import com.webscada.server.service.TagRuntimeService;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class TagWebSocketHandler extends TextWebSocketHandler {
  private final TagRuntimeService runtime;
  private final AlarmRuntimeService alarms;
  private final TagSessionRegistry registry;
  private final ScadaProperties props;
  private final ObjectMapper mapper = new ObjectMapper();

  public TagWebSocketHandler(
      TagRuntimeService runtime,
      AlarmRuntimeService alarms,
      TagSessionRegistry registry,
      ScadaProperties props) {
    this.runtime = runtime;
    this.alarms = alarms;
    this.registry = registry;
    this.props = props;
  }

  @Override
  public void afterConnectionEstablished(WebSocketSession session) {
    boolean allowWrite = tokenMatches(extractToken(session));
    TagSession client = new TagSession(session, null, allowWrite);
    registry.add(client);
    registry.send(
        session, TagSessionRegistry.MapOf.snapshot(runtime.getMetas(), runtime.getCurrentValues()));
    registry.send(session, alarms.snapshotMessage());
  }

  @Override
  protected void handleTextMessage(WebSocketSession session, TextMessage message) {
    TagSession client = registry.find(session);
    if (client == null) return;
    try {
      JsonNode msg = mapper.readTree(message.getPayload());
      String type = msg.path("type").asText("");
      switch (type) {
        case "subscribe" -> {
          Set<String> sub = null;
          if (msg.has("tagIds") && msg.get("tagIds").isArray()) {
            Set<String> ids = new HashSet<>();
            for (JsonNode n : msg.get("tagIds")) ids.add(n.asText());
            sub = ids;
          }
          final Set<String> filter = sub;
          TagSession next = client.withSubscribed(filter);
          registry.remove(session);
          registry.add(next);
          var all = runtime.getCurrentValues();
          var values =
              filter == null
                  ? all
                  : all.stream().filter(v -> filter.contains(v.tagId())).toList();
          registry.send(session, TagSessionRegistry.MapOf.snapshot(runtime.getMetas(), values));
        }
        case "unsubscribe" -> {
          registry.remove(session);
          registry.add(client.withSubscribed(Set.of()));
        }
        case "write" -> {
          String tagId = msg.path("tagId").asText(null);
          if (tagId == null) return;
          if (!client.allowWrite()) {
            registry.send(
                session, TagSessionRegistry.MapOf.writeResult(false, "unauthorized", tagId, null));
            return;
          }
          Object value =
              msg.has("value") && !msg.get("value").isNull()
                  ? mapper.treeToValue(msg.get("value"), Object.class)
                  : null;
          TagRuntimeService.WriteResult res = runtime.writeTag(tagId, value);
          registry.send(
              session,
              TagSessionRegistry.MapOf.writeResult(res.ok(), res.message(), tagId, res.value()));
        }
        default -> {
          /* ignore */
        }
      }
    } catch (Exception ignored) {
      // malformed JSON: silent like Node
    }
  }

  @Override
  public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
    registry.remove(session);
  }

  private String extractToken(WebSocketSession session) {
    String q = session.getUri() != null ? session.getUri().getQuery() : null;
    if (q != null) {
      for (String part : q.split("&")) {
        int i = part.indexOf('=');
        if (i > 0 && part.substring(0, i).equals("token")) {
          return part.substring(i + 1);
        }
      }
    }
    List<String> auth = session.getHandshakeHeaders().get("Authorization");
    if (auth != null && !auth.isEmpty()) {
      String a = auth.get(0);
      if (a.toLowerCase().startsWith("bearer ")) return a.substring(7).trim();
    }
    List<String> hdr = session.getHandshakeHeaders().get("X-SCADA-Token");
    if (hdr != null && !hdr.isEmpty()) return hdr.get(0).trim();
    return null;
  }

  private boolean tokenMatches(String token) {
    if (!props.getAuth().isEnabled()) return true;
    return token != null && token.equals(props.getAuth().getApiToken());
  }
}
