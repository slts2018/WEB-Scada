package com.webscada.server.db;

import com.webscada.server.config.ScadaProperties;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class MysqlBootstrap {
  private static final Logger log = LoggerFactory.getLogger(MysqlBootstrap.class);

  private final ScadaProperties props;
  private volatile HikariDataSource dataSource;
  private volatile JdbcTemplate jdbc;
  private volatile boolean ready;
  private volatile String lastError;

  public MysqlBootstrap(ScadaProperties props) {
    this.props = props;
  }

  public synchronized boolean init() {
    close();
    ScadaProperties.Mysql m = props.getMysql();
    try {
      // Short timeouts: packaged installs often have no MySQL; fail fast → file store
      String jdbcOpts =
          "useSSL=false&allowPublicKeyRetrieval=true&characterEncoding=utf8"
              + "&connectTimeout=3000&socketTimeout=5000";
      String bootstrapUrl =
          "jdbc:mysql://" + m.getHost() + ":" + m.getPort() + "/?" + jdbcOpts;
      try (Connection c =
              DriverManager.getConnection(bootstrapUrl, m.getUser(), m.getPassword());
          Statement st = c.createStatement()) {
        st.execute(
            "CREATE DATABASE IF NOT EXISTS `"
                + m.getDatabase()
                + "` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
      }

      HikariConfig cfg = new HikariConfig();
      cfg.setJdbcUrl(
          "jdbc:mysql://"
              + m.getHost()
              + ":"
              + m.getPort()
              + "/"
              + m.getDatabase()
              + "?"
              + jdbcOpts);
      cfg.setUsername(m.getUser());
      cfg.setPassword(m.getPassword());
      cfg.setMaximumPoolSize(10);
      cfg.setConnectionTimeout(3000);
      cfg.setInitializationFailTimeout(1);
      cfg.setPoolName("web-scada-mysql");
      dataSource = new HikariDataSource(cfg);
      jdbc = new JdbcTemplate(dataSource);

      Flyway.configure()
          .dataSource(dataSource)
          .locations("classpath:db/migration")
          .baselineOnMigrate(true)
          .load()
          .migrate();

      jdbc.queryForObject("SELECT 1", Integer.class);
      ready = true;
      lastError = null;
      log.info("MySQL ready {}:{}/{}", m.getHost(), m.getPort(), m.getDatabase());
      return true;
    } catch (Exception e) {
      ready = false;
      lastError = e.getMessage();
      log.warn("MySQL init failed: {}", lastError);
      closeQuietly();
      return false;
    }
  }

  public synchronized void close() {
    ready = false;
    closeQuietly();
  }

  private void closeQuietly() {
    jdbc = null;
    if (dataSource != null) {
      try {
        dataSource.close();
      } catch (Exception e) {
        log.debug("close pool: {}", e.toString());
      }
      dataSource = null;
    }
  }

  public boolean isReady() {
    return ready;
  }

  public String getLastError() {
    return lastError;
  }

  public JdbcTemplate jdbc() {
    if (!ready || jdbc == null) throw new IllegalStateException(lastError != null ? lastError : "MySQL is not ready");
    return jdbc;
  }

  public DataSource dataSource() {
    return dataSource;
  }

  public Map<String, Object> status() {
    Map<String, Object> s = new LinkedHashMap<>();
    s.put("ready", ready);
    s.put("error", lastError);
    s.put("host", props.getMysql().getHost());
    s.put("port", props.getMysql().getPort());
    s.put("database", props.getMysql().getDatabase());
    return s;
  }

  public Map<String, Object> test(Map<String, Object> opts) {
    ScadaProperties.Mysql m = props.getMysql();
    String host = str(opts, "host", m.getHost());
    int port = opts != null && opts.get("port") instanceof Number n ? n.intValue() : m.getPort();
    String user = str(opts, "user", m.getUser());
    String password =
        opts != null && opts.get("password") != null && !String.valueOf(opts.get("password")).isEmpty()
            ? String.valueOf(opts.get("password"))
            : m.getPassword();
    String database = str(opts, "database", m.getDatabase());
    try {
      String url =
          "jdbc:mysql://"
              + host
              + ":"
              + port
              + "/"
              + database
              + "?useSSL=false&allowPublicKeyRetrieval=true&characterEncoding=utf8";
      try (Connection c = DriverManager.getConnection(url, user, password);
          Statement st = c.createStatement()) {
        st.execute("SELECT 1");
      }
      return Map.of("ok", true);
    } catch (Exception e) {
      Map<String, Object> r = new LinkedHashMap<>();
      r.put("ok", false);
      r.put("error", e.getMessage());
      return r;
    }
  }

  private static String str(Map<String, Object> opts, String key, String def) {
    if (opts == null || opts.get(key) == null) return def;
    String v = String.valueOf(opts.get(key));
    return v.isBlank() ? def : v;
  }
}
