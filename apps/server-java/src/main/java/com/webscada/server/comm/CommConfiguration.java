package com.webscada.server.comm;

import com.webscada.server.comm.config.CommProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConditionalOnProperty(prefix = "webscada.comm", name = "enabled", havingValue = "true")
public class CommConfiguration {
  @Bean(initMethod = "start", destroyMethod = "close")
  public CommFacade commFacade(CommProperties properties) {
    return CommFacade.create(properties);
  }
}
