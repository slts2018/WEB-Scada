package com.webscada.server.device.mcd4000mqtt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import org.junit.jupiter.api.Test;

class Mcd4000MqttPayloadParserTest {
  private final Mcd4000MqttPayloadParser parser = new Mcd4000MqttPayloadParser(new ObjectMapper());

  @Test
  void plcDevListArrayUsesUnixSecondsAndPointNames() throws Exception {
    String json =
        """
        {
          "cmdId": 101,
          "type": 0,
          "devList": [
            {
              "devSn": "wtbl10008",
              "devName": "加注机",
              "time": 1510732255,
              "varList": { "V100": 40.38, "Q0.1": 1, "M1.1": 0, "V200": "aaa" }
            }
          ],
          "ver": "0.0.1",
          "seq": "81100000111111",
          "time": "2011-04-19 10:12:09"
        }
        """;
    List<Mcd4000MqttPayloadParser.Point> pts = parser.parse("sys/GSN001/up", json.getBytes(StandardCharsets.UTF_8));
    assertEquals(4, pts.size());
    Mcd4000MqttPayloadParser.Point v100 =
        pts.stream().filter(p -> "V100".equals(p.address())).findFirst().orElseThrow();
    assertEquals(Mcd4000MqttPayloadParser.Kind.PLC, v100.kind());
    assertEquals("wtbl10008", v100.devSn());
    assertEquals(1510732255_000L, v100.timestampMs());
    assertEquals(40.38, ((Number) v100.value()).doubleValue(), 1e-6);
    assertTrue(Mcd4000MqttService.matches("V100", v100));
    assertTrue(Mcd4000MqttService.matches("wtbl10008|V100", v100));
    assertFalse(Mcd4000MqttService.matches("other|V100", v100));
  }

  @Test
  void armBatchLastIsCurrentAndIntermediatesAreNotLast() throws Exception {
    String json =
        """
        {
          "cmdId": 100,
          "type": 0,
          "ver": "0.0.1",
          "seq": 1333,
          "time": "2025-07-19 13:23:00",
          "devSn": "801",
          "devName": "chuanzhentest",
          "varList": [
            { "time": 1752902573914, "入口压力": "-0.052500", "出口压力": "-0.062500" },
            { "time": 1752902573919, "入口压力": "-0.100000", "出口压力": "-0.200000" }
          ]
        }
        """;
    List<Mcd4000MqttPayloadParser.Point> pts =
        parser.parse("sys/GSN001/upfast", json.getBytes(StandardCharsets.UTF_8));
    List<Mcd4000MqttPayloadParser.Point> inlet =
        pts.stream().filter(p -> "入口压力".equals(p.address())).toList();
    assertEquals(2, inlet.size());
    assertEquals(1752902573914L, inlet.get(0).timestampMs());
    assertFalse(inlet.get(0).lastInGroup());
    assertEquals(-0.0525, ((Number) inlet.get(0).value()).doubleValue(), 1e-9);
    assertTrue(inlet.get(1).lastInGroup());
    assertEquals(-0.1, ((Number) inlet.get(1).value()).doubleValue(), 1e-9);
    assertEquals(1752902573919L, inlet.get(1).timestampMs());
  }

  @Test
  void passthroughObjectDevListReadsFeatureScalarsAndSkipsWaveform() throws Exception {
    String json =
        """
        {
          "cmdId": 102,
          "type": 0,
          "devList": {
            "devSn": "1506110552205500023",
            "devName": "xxx",
            "varList": {
              "content": {
                "unit_id": "1506110552205500023",
                "unit_name": "CentrifugalCompressorUnit",
                "time": "2025-03-20 12:33:01",
                "value": [
                  { "sensorName": "Motor_CE_X", "Gap": -10, "Max": 23.44, "State": 0 },
                  { "sensorName": "Motor_CE_X", "wave": "[1,2,3,4]" },
                  { "sensor_name": "kp1", "wave": "[9,8,7]" },
                  { "sensorName": "Spec1", "f": [1,2], "a": [3,4] }
                ]
              }
            }
          },
          "ver": "0.0.1",
          "seq": "81100000111111",
          "time": "2011-04-19 10:12:09"
        }
        """;
    List<Mcd4000MqttPayloadParser.Point> pts =
        parser.parse("sys/GSN001/passthrough", json.getBytes(StandardCharsets.UTF_8));
    assertEquals(3, pts.size());
    assertTrue(pts.stream().allMatch(p -> "Motor_CE_X|Gap".equals(p.address())
        || "Motor_CE_X|Max".equals(p.address())
        || "Motor_CE_X|State".equals(p.address())));
    long expected =
        LocalDateTime.parse("2025-03-20T12:33:01").atZone(ZoneId.of("Asia/Shanghai")).toInstant().toEpochMilli();
    assertEquals(expected, pts.get(0).timestampMs());
    assertTrue(Mcd4000MqttService.matches("Motor_CE_X|Gap", pts.get(0)));
  }

  @Test
  void passthroughAcceptsBareUnitPayloadAndContentArray() throws Exception {
    String json =
        """
        {
          "unit_id": "U1",
          "time": "2025-03-20 12:33:01",
          "value": [ { "sensor_name": "S1", "PP": 14 } ]
        }
        """;
    List<Mcd4000MqttPayloadParser.Point> pts =
        parser.parse("sys/GSN001/passthrough", json.getBytes(StandardCharsets.UTF_8));
    assertEquals(1, pts.size());
    assertEquals("S1|PP", pts.get(0).address());
    assertEquals(14, ((Number) pts.get(0).value()).intValue());
  }

  @Test
  void topicsHaveNoLeadingSlashAndClientIdUsesTelegrafPrefix() {
    Mcd4000MqttChannel ch = Mcd4000MqttChannel.parse("127.0.0.1:1883|GSN001");
    assertEquals("sys/GSN001/up", ch.topic("up"));
    assertEquals("sys/GSN001/upfast", ch.topic("upfast"));
    assertEquals("sys/GSN001/passthrough", ch.topic("passthrough"));
    for (String t : ch.topics()) {
      assertFalse(t.startsWith("/"));
    }
    String clientId = ch.clientId("dev_test.1");
    assertTrue(clientId.startsWith("telegraf_"));
    assertTrue(clientId.contains("webscada"));
    assertEquals("up", Mcd4000MqttChannel.topicKind("sys/GSN001/up"));
    assertEquals("upfast", Mcd4000MqttChannel.topicKind("/sys/GSN001/upfast"));
  }
}
