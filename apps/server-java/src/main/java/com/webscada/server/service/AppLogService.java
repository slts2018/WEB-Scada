package com.webscada.server.service;

import com.webscada.server.config.PathsProvider;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** 设计端 / 运行端共用的应用日志：内存环缓冲 + 追加文件。 */
@Service
public class AppLogService {
  public record LogItem(String id, long time, String level, String source, String message) {}

  private static final int MAX_BUFFER = 8000;
  private static final long ROTATE_BYTES = 8L * 1024 * 1024;
  private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
  private static final DateTimeFormatter FMT =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS Z").withZone(ZONE);
  private static final Set<String> LEVELS = Set.of("info", "success", "warn", "error");

  private final Path file;
  private final ArrayDeque<LogItem> buffer = new ArrayDeque<>();
  private final Object lock = new Object();

  public AppLogService(PathsProvider paths) {
    this.file = paths.getDataRoot().resolve("logs").resolve("web-scada.log");
    try {
      Files.createDirectories(this.file.getParent());
    } catch (IOException ignored) {
    }
    loadFromFile();
  }

  public Path getFilePath() {
    return file.toAbsolutePath().normalize();
  }

  public LogItem append(String id, Long time, String level, String source, String message) {
    String lv = level == null ? "info" : level.trim().toLowerCase(Locale.ROOT);
    if (!LEVELS.contains(lv)) lv = "info";
    String src = (source == null || source.isBlank()) ? "系统" : source.trim();
    String msg = message == null ? "" : message;
    long ts = time == null || time <= 0 ? System.currentTimeMillis() : time;
    String nid =
        (id == null || id.isBlank())
            ? ("log_" + ts + "_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8))
            : id.trim();
    LogItem item = new LogItem(nid, ts, lv, src, msg);
    synchronized (lock) {
      buffer.addLast(item);
      while (buffer.size() > MAX_BUFFER) buffer.removeFirst();
      writeLine(item);
    }
    return item;
  }

  public List<LogItem> query(Long from, Long to, String level, String source, int limit, int offset) {
    String lv = level == null || level.isBlank() || "all".equalsIgnoreCase(level) ? null : level.trim().toLowerCase(Locale.ROOT);
    String src = source == null || source.isBlank() || "all".equalsIgnoreCase(source) ? null : source.trim();
    int lim = Math.max(1, Math.min(limit <= 0 ? 500 : limit, 2000));
    int off = Math.max(0, offset);
    List<LogItem> newestFirst;
    synchronized (lock) {
      newestFirst = new ArrayList<>(buffer);
    }
    // buffer is oldest-first; present newest first
    List<LogItem> out = new ArrayList<>();
    for (int i = newestFirst.size() - 1; i >= 0; i--) {
      LogItem it = newestFirst.get(i);
      if (from != null && it.time() < from) continue;
      if (to != null && it.time() > to) continue;
      if (lv != null && !lv.equals(it.level())) continue;
      if (src != null && !src.equals(it.source())) continue;
      if (off > 0) {
        off--;
        continue;
      }
      out.add(it);
      if (out.size() >= lim) break;
    }
    return out;
  }

  public int count(Long from, Long to, String level, String source) {
    String lv = level == null || level.isBlank() || "all".equalsIgnoreCase(level) ? null : level.trim().toLowerCase(Locale.ROOT);
    String src = source == null || source.isBlank() || "all".equalsIgnoreCase(source) ? null : source.trim();
    int n = 0;
    synchronized (lock) {
      for (LogItem it : buffer) {
        if (from != null && it.time() < from) continue;
        if (to != null && it.time() > to) continue;
        if (lv != null && !lv.equals(it.level())) continue;
        if (src != null && !src.equals(it.source())) continue;
        n++;
      }
    }
    return n;
  }

  public List<String> sources() {
    Set<String> set = new LinkedHashSet<>();
    synchronized (lock) {
      for (LogItem it : buffer) set.add(it.source());
    }
    return new ArrayList<>(set);
  }

  private void writeLine(LogItem item) {
    try {
      Files.createDirectories(file.getParent());
      if (Files.exists(file) && Files.size(file) >= ROTATE_BYTES) {
        Path bak = file.resolveSibling("web-scada.log.1");
        Files.move(file, bak, StandardCopyOption.REPLACE_EXISTING);
      }
      String line =
          FMT.format(Instant.ofEpochMilli(item.time()))
              + "\t"
              + item.level()
              + "\t"
              + sanitize(item.source())
              + "\t"
              + sanitize(item.message())
              + System.lineSeparator();
      try (BufferedWriter w =
          Files.newBufferedWriter(
              file, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND)) {
        w.write(line);
      }
    } catch (IOException ignored) {
    }
  }

  private static String sanitize(String s) {
    if (s == null) return "";
    return s.replace('\t', ' ').replace('\r', ' ').replace('\n', ' ');
  }

  private void loadFromFile() {
    if (!Files.isRegularFile(file)) return;
    try (BufferedReader r = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
      String line;
      int i = 0;
      while ((line = r.readLine()) != null) {
        LogItem item = parseLine(line, i++);
        if (item != null) {
          buffer.addLast(item);
          while (buffer.size() > MAX_BUFFER) buffer.removeFirst();
        }
      }
    } catch (IOException ignored) {
    }
  }

  private static LogItem parseLine(String line, int index) {
    if (line == null || line.isBlank()) return null;
    String[] parts = line.split("\t", 4);
    if (parts.length < 4) return null;
    try {
      long ts = Instant.from(FMT.parse(parts[0].trim())).toEpochMilli();
      String lv = parts[1].trim().toLowerCase(Locale.ROOT);
      if (!LEVELS.contains(lv)) lv = "info";
      String src = parts[2].trim();
      String msg = parts[3];
      return new LogItem("file_" + ts + "_" + index, ts, lv, src, msg);
    } catch (Exception e) {
      return null;
    }
  }
}
