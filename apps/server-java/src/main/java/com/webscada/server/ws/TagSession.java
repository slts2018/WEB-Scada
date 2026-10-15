package com.webscada.server.ws;

import java.util.Set;
import org.springframework.web.socket.WebSocketSession;

/** subscribed == null means all tags */
public record TagSession(WebSocketSession session, Set<String> subscribed, boolean allowWrite) {
  public TagSession withSubscribed(Set<String> next) {
    return new TagSession(session, next, allowWrite);
  }
}
