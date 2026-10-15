package com.webscada.server.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "webscada")
public class ScadaProperties {
  private final Mysql mysql = new Mysql();
  private final Influx influx = new Influx();
  private final Auth auth = new Auth();
  private final Mcd4000 mcd4000 = new Mcd4000();

  public Mysql getMysql() {
    return mysql;
  }

  public Influx getInflux() {
    return influx;
  }

  public Auth getAuth() {
    return auth;
  }

  public Mcd4000 getMcd4000() {
    return mcd4000;
  }

  public static class Mysql {
    private String host = "127.0.0.1";
    private int port = 3306;
    private String user = "root";
    private String password = "root";
    private String database = "web_scada";
    private boolean fallbackToFile = true;

    public String getHost() {
      return host;
    }

    public void setHost(String host) {
      this.host = host;
    }

    public int getPort() {
      return port;
    }

    public void setPort(int port) {
      this.port = port;
    }

    public String getUser() {
      return user;
    }

    public void setUser(String user) {
      this.user = user;
    }

    public String getPassword() {
      return password;
    }

    public void setPassword(String password) {
      this.password = password;
    }

    public String getDatabase() {
      return database;
    }

    public void setDatabase(String database) {
      this.database = database;
    }

    public boolean isFallbackToFile() {
      return fallbackToFile;
    }

    public void setFallbackToFile(boolean fallbackToFile) {
      this.fallbackToFile = fallbackToFile;
    }
  }

  public static class Influx {
    private String url = "http://127.0.0.1:8086";
    private String token = "";
    private String org = "web-scada";
    private String bucket = "tags";
    private String measurement = "tag_value";
    private boolean required = false;

    public String getUrl() {
      return url;
    }

    public void setUrl(String url) {
      this.url = url;
    }

    public String getToken() {
      return token;
    }

    public void setToken(String token) {
      this.token = token;
    }

    public String getOrg() {
      return org;
    }

    public void setOrg(String org) {
      this.org = org;
    }

    public String getBucket() {
      return bucket;
    }

    public void setBucket(String bucket) {
      this.bucket = bucket;
    }

    public String getMeasurement() {
      return measurement;
    }

    public void setMeasurement(String measurement) {
      this.measurement = measurement;
    }

    public boolean isRequired() {
      return required;
    }

    public void setRequired(boolean required) {
      this.required = required;
    }

    public boolean isReady() {
      return token != null && !token.isBlank();
    }
  }

  public static class Auth {
    private String apiToken = "";
    private boolean required = false;

    public String getApiToken() {
      return apiToken;
    }

    public void setApiToken(String apiToken) {
      this.apiToken = apiToken;
    }

    public boolean isRequired() {
      return required;
    }

    public void setRequired(boolean required) {
      this.required = required;
    }

    public boolean isEnabled() {
      return apiToken != null && !apiToken.isBlank();
    }
  }

  /** 沈鼓 MCD4000 / 数据中台轮询 */
  public static class Mcd4000 {
    private boolean enabled = true;
    private long pollMs = 2000;
    /** PLC FuncName=last 建议较大窗口；默认 7 天 */
    private int lookbackSec = 604800;
    private long timeoutMs = 15000;
    /**
     * 信任自签名/未知 CA（数据中台常见）。生产应收紧为 false 并导入正式证书。
     */
    private boolean insecureSsl = true;

    public boolean isEnabled() {
      return enabled;
    }

    public void setEnabled(boolean enabled) {
      this.enabled = enabled;
    }

    public long getPollMs() {
      return pollMs;
    }

    public void setPollMs(long pollMs) {
      this.pollMs = pollMs;
    }

    public int getLookbackSec() {
      return lookbackSec;
    }

    public void setLookbackSec(int lookbackSec) {
      this.lookbackSec = lookbackSec;
    }

    public long getTimeoutMs() {
      return timeoutMs;
    }

    public void setTimeoutMs(long timeoutMs) {
      this.timeoutMs = timeoutMs;
    }

    public boolean isInsecureSsl() {
      return insecureSsl;
    }

    public void setInsecureSsl(boolean insecureSsl) {
      this.insecureSsl = insecureSsl;
    }
  }
}
