package com.webscada.server.comm.config;

import java.util.ArrayList;
import java.util.List;

/** 校验通过才整份替换。失败时 current() 保持原引用。 */
public final class LinkConfigStore {
  private final LinkConfigValidator validator;
  private volatile List<LinkDefinition> current = List.of();

  public LinkConfigStore(LinkConfigValidator validator) {
    this.validator = validator;
  }

  public LinkConfigStore(LinkConfigValidator validator, List<LinkDefinition> initial) {
    this.validator = validator;
    this.current = initial == null ? List.of() : List.copyOf(initial);
  }

  public List<LinkDefinition> current() {
    return current;
  }

  public boolean replace(List<LinkDefinition> next, List<String> errors) {
    List<String> found = validator.validateDefinitions(next);
    if (!found.isEmpty()) {
      if (errors != null) errors.addAll(found);
      return false;
    }
    current = List.copyOf(next);
    return true;
  }

  public boolean replaceRaw(List<CommProperties.Link> next, List<String> errors) {
    LinkConfigValidator.Result result = validator.validate(next);
    if (!result.ok()) {
      if (errors != null) errors.addAll(result.errors());
      return false;
    }
    current = result.links();
    return true;
  }

  public LinkDefinition find(String id) {
    for (LinkDefinition link : current) {
      if (link.id().equals(id)) return link;
    }
    return null;
  }

  public List<String> copyIds() {
    List<String> ids = new ArrayList<>();
    for (LinkDefinition link : current) ids.add(link.id());
    return ids;
  }
}
