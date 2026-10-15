package com.webscada.server;

import com.webscada.server.config.ScadaProperties;
import com.webscada.server.db.InfluxHolder;
import com.webscada.server.db.MysqlBootstrap;
import com.webscada.server.service.DatabaseSettingsService;
import com.webscada.server.service.TagRuntimeService;
import com.webscada.server.store.DeviceFileStore;
import com.webscada.server.store.TagFileStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@EnableConfigurationProperties(ScadaProperties.class)
public class ServerApplication {
  private static final Logger log = LoggerFactory.getLogger(ServerApplication.class);

  public static void main(String[] args) {
    SpringApplication.run(ServerApplication.class, args);
  }

  @Bean
  CommandLineRunner bootstrap(
      ScadaProperties props,
      DatabaseSettingsService settings,
      MysqlBootstrap mysql,
      InfluxHolder influx,
      TagFileStore tags,
      DeviceFileStore devices,
      TagRuntimeService runtime) {
    return args -> {
      if (props.getAuth().isRequired()
          && (props.getAuth().getApiToken() == null || props.getAuth().getApiToken().isBlank())) {
        throw new IllegalStateException("SCADA_AUTH_REQUIRED=true but SCADA_API_TOKEN is empty");
      }
      settings.loadPersisted();
      boolean mysqlOk = mysql.init();
      boolean influxOk = influx.init();
      devices.seedIfEmpty();
      tags.seedIfEmpty();
      runtime.reload();
      log.info(
          "web-scada-server (java) started storage={} mysql={} influx={} authEnabled={} port={}",
          mysqlOk ? "mysql" : "file",
          mysqlOk,
          influxOk,
          props.getAuth().isEnabled(),
          System.getenv().getOrDefault("PORT", "8787"));
    };
  }
}
