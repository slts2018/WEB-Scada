package com.webscada.server.comm.support;

import com.webscada.server.comm.CommFacade;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.log.LogEvent;
import com.webscada.server.comm.log.LogSink;
import com.webscada.server.comm.supervisor.LinkIoPool;
import com.webscada.server.comm.supervisor.LinkScheduler;
import com.webscada.server.comm.supervisor.LinkSupervisor;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

public final class Harness implements AutoCloseable {
  public final MutableClock clock = new MutableClock();
  public final ScriptedDriver driver = new ScriptedDriver();
  public final LinkScheduler.ManualScheduler scheduler = new LinkScheduler.ManualScheduler();
  public final LinkIoPool io = new LinkIoPool();
  public final List<LogEvent> logs = Collections.synchronizedList(new ArrayList<>());
  public final CommFacade facade;
  public final LinkSupervisor supervisor;

  private Harness(LinkDefinition link, long graceMs) {
    LogSink sink = (event, json) -> logs.add(event);
    facade =
        new CommFacade(
            scheduler,
            io,
            clock,
            graceMs,
            32,
            List.of(link),
            driver,
            () -> 0.5,
            false,
            sink);
    supervisor = facade.supervisor(link.id());
  }

  public static Harness open(LinkDefinition link, long graceMs) {
    return new Harness(link, graceMs);
  }

  public void start() {
    supervisor.start();
  }

  public void until(BooleanSupplier cond) {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
    while (!cond.getAsBoolean()) {
      if (System.nanoTime() > end) {
        throw new AssertionError(
            "timeout state="
                + supervisor.state()
                + " connects="
                + driver.connects.get()
                + " disconnects="
                + driver.disconnects.get()
                + " healths="
                + driver.healths.get());
      }
      scheduler.requestTick();
      if (!scheduler.awaitTickDone(1000)) throw new AssertionError("tick hung");
      if (!io.awaitQuiet(1000)) throw new AssertionError("io hung");
    }
  }

  public boolean logged(String event) {
    synchronized (logs) {
      for (LogEvent e : logs) {
        if (event.equals(e.event())) return true;
      }
      return false;
    }
  }

  @Override
  public void close() {
    facade.close();
  }
}
