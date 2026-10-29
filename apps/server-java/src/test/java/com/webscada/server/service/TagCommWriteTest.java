package com.webscada.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.webscada.server.comm.CommFacade;
import com.webscada.server.comm.config.DataPoint;
import com.webscada.server.comm.config.LinkDefinition;
import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import com.webscada.server.comm.support.Harness;
import com.webscada.server.comm.support.LinkFixtures;
import com.webscada.server.model.TagMeta;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class TagCommWriteTest {
  @Test
  void writableCommPointReachesTheDriverAndReadOnlyDoesNot() {
    Harness harness = open();
    try {
      TagRuntimeService runtime = TagRuntimeService.memory(harness.facade);
      runtime.testingAllowWrite(true);
      runtime.testingMetas(
          List.of(
              tag("plant.flow", "dev-plc", true),
              tag("plant.level", "dev-plc", true),
              tag("plant.pressure", "dev-plc", false)));
      TagRuntimeService.WriteResult readFc = runtime.writeTag("plant.level", 1);
      assertFalse(readFc.ok());
      assertEquals("comm point function not writable", readFc.message());
      assertTrue(harness.driver.writes.isEmpty());

      TagRuntimeService.WriteResult ok = runtime.writeTag("plant.flow", 2.5);
      assertTrue(ok.ok(), ok.message());
      assertNull(ok.value());
      assertEquals(1, harness.driver.writes.size());
      assertEquals("flow", harness.driver.writes.get(0).pointId());
      assertEquals(2.5, ((Number) harness.driver.writes.get(0).value()).doubleValue());
      assertFalse(harness.driver.writes.get(0).correlationId().isBlank());
      assertNull(runtime.getTagValue("plant.flow"));

      TagRuntimeService.WriteResult denied = runtime.writeTag("plant.pressure", 1);
      assertFalse(denied.ok());
      assertEquals("Tag is read-only", denied.message());
      assertEquals(1, harness.driver.writes.size());
    } finally {
      harness.close();
    }
  }

  @Test
  void allowWriteOffRejectsBeforeTheDriver() {
    Harness harness = open();
    try {
      TagRuntimeService runtime = TagRuntimeService.memory(harness.facade);
      runtime.testingMetas(List.of(tag("plant.flow", "dev-plc", true)));
      TagRuntimeService.WriteResult denied = runtime.writeTag("plant.flow", 2.5);
      assertFalse(denied.ok());
      assertEquals("comm write disabled", denied.message());
      assertNull(denied.value());
      assertTrue(harness.driver.writes.isEmpty());
      assertNull(runtime.getTagValue("plant.flow"));
    } finally {
      harness.close();
    }
  }

  @Test
  void mcdPointIsStillRejectedBeforeComm() {
    Harness harness = open();
    try {
      TagRuntimeService runtime = TagRuntimeService.memory(harness.facade);
      runtime.testingMcd(Set.of("dev-plc"));
      runtime.testingMetas(List.of(tag("plant.flow", "dev-plc", true)));
      TagRuntimeService.WriteResult denied = runtime.writeTag("plant.flow", 1);
      assertFalse(denied.ok());
      assertTrue(denied.message().contains("MCD4000"));
      assertTrue(harness.driver.writes.isEmpty());
    } finally {
      harness.close();
    }
  }

  @Test
  void localWriteStillUpdatesTheRuntimeWhenThePointIsNotOnACommLink() {
    TagRuntimeService runtime = TagRuntimeService.memory();
    runtime.testingMetas(List.of(tag("demo.temp", "demo", true)));
    TagRuntimeService.WriteResult ok = runtime.writeTag("demo.temp", 1.5);
    assertTrue(ok.ok(), ok.message());
    assertEquals(1.5, ((Number) runtime.getTagValue("demo.temp").value()).doubleValue());
    assertFalse(runtime.isCommDriven(runtime.getMetas().get(0)));
  }

  @Test
  void driverAuthConfigAndTimeoutReachTheCaller() {
    Harness harness = open();
    try {
      CommFacade.WriteOutcome missing = harness.facade.write("missing", "flow", 1, "k", 100);
      assertFalse(missing.ok());
      assertEquals("CONFIG", missing.category());
      assertTrue(missing.message().contains("link not found"));
      CommFacade.WriteOutcome unknown = harness.facade.write("plc", "no-such", 1, "k", 100);
      assertEquals("CONFIG", unknown.category());
      assertTrue(unknown.message().contains("point not found"));

      harness.driver.writePlan.add(new CommException(ErrorCategory.AUTH, false, false, "token rejected"));
      TagRuntimeService runtime = TagRuntimeService.memory(harness.facade);
      runtime.testingAllowWrite(true);
      runtime.testingMetas(List.of(tag("plant.flow", "dev-plc", true)));
      TagRuntimeService.WriteResult auth = runtime.writeTag("plant.flow", 1);
      assertFalse(auth.ok());
      assertTrue(auth.message().contains("AUTH"));
      assertTrue(auth.message().contains("token rejected"));

      harness.driver.writePlan.add(new CommException(ErrorCategory.CONFIG, false, false, "bad address"));
      TagRuntimeService.WriteResult config = runtime.writeTag("plant.flow", 1);
      assertTrue(config.message().contains("CONFIG"));
      assertTrue(config.message().contains("bad address"));

      harness.driver.writeBlockMs = 500;
      CommFacade.WriteOutcome timed = harness.facade.write("plc", "flow", 1, "k", 40);
      assertFalse(timed.ok());
      assertEquals("TIMEOUT", timed.category());
    } finally {
      harness.close();
    }
  }

  @Test
  void writeOnTheTickThreadIsRejected() {
    Harness harness = open();
    try {
      AtomicReference<CommFacade.WriteOutcome> out = new AtomicReference<>();
      harness.scheduler.enqueueOnTick(() -> out.set(harness.facade.write("plc", "flow", 1, "k", 100)));
      assertTrue(harness.scheduler.awaitTickDone(1000));
      assertFalse(out.get().ok());
      assertTrue(out.get().message().contains("tick"));
      assertTrue(harness.driver.writes.isEmpty());
    } finally {
      harness.close();
    }
  }

  private static Harness open() {
    DataPoint flow =
        new DataPoint("flow", 6, 0, "float32", "high-first", "big", 1, 0, null, "", "", "", "", "plant.flow");
    DataPoint level =
        new DataPoint("level", 3, 4, "float32", "high-first", "big", 1, 0, null, "", "", "", "", "plant.level");
    DataPoint pressure =
        new DataPoint(
            "pressure", 3, 2, "float32", "high-first", "big", 1, 0, null, "", "", "", "", "plant.pressure");
    LinkDefinition link =
        LinkFixtures.withPoints(
            LinkFixtures.polling("plc", 60_000, 502), List.of(flow, level, pressure));
    return Harness.open(link, 2_000);
  }

  private static TagMeta tag(String id, String deviceId, boolean writable) {
    return new TagMeta(
        id, id, "", deviceId, "", "float", "", null, writable, "", null, null, null, null, null, null, null);
  }
}
