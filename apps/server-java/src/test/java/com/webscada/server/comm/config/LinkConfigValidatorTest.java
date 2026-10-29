package com.webscada.server.comm.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class LinkConfigValidatorTest {
  @Test
  void acceptsOpcTcpAndRejectsBadPort() {
    CommProperties.Link opc = new CommProperties.Link();
    opc.setId("ua");
    opc.setProtocol("opcua");
    opc.setEndpointUrl("opc.tcp://10.0.0.20:4840");
    LinkConfigValidator.Result ok = new LinkConfigValidator().validate(List.of(opc));
    assertTrue(ok.ok(), ok.errors().toString());
    assertEquals(4840, ok.links().get(0).endpoint(0).port());

    CommProperties.Link bad = new CommProperties.Link();
    bad.setId("plc");
    bad.setProtocol("modbus-tcp");
    CommProperties.Endpoint ep = new CommProperties.Endpoint();
    ep.setHost("10.0.0.1");
    ep.setPort(70000);
    bad.getEndpoints().add(ep);
    LinkConfigValidator.Result rejected = new LinkConfigValidator().validate(List.of(bad));
    assertFalse(rejected.ok());
    assertTrue(rejected.errors().get(0).contains("port"));
  }

  @Test
  void keepsLegacyPointIdsAndNamesTheBadModbusField() {
    CommProperties.Link legacy = new CommProperties.Link();
    legacy.setId("plc");
    legacy.setProtocol("modbus-tcp");
    CommProperties.Endpoint ep = new CommProperties.Endpoint();
    ep.setHost("10.0.0.1");
    ep.setPort(502);
    legacy.getEndpoints().add(ep);
    legacy.getPointIds().add("a");
    LinkConfigValidator.Result ok = new LinkConfigValidator().validate(List.of(legacy));
    assertTrue(ok.ok(), ok.errors().toString());
    assertEquals(List.of("a"), ok.links().get(0).pointIds());
    assertTrue(ok.links().get(0).points().isEmpty());

    CommProperties.Link bad = new CommProperties.Link();
    bad.setId("plc2");
    bad.setProtocol("modbus-tcp");
    bad.getEndpoints().add(ep);
    CommProperties.Point point = new CommProperties.Point();
    point.setId("temp");
    point.setFc(3);
    point.setAddress(0);
    point.setType("bool");
    bad.getPoints().add(point);
    CommProperties.Point again = new CommProperties.Point();
    again.setId("temp");
    again.setFc(3);
    again.setAddress(1);
    again.setType("uint16");
    bad.getPoints().add(again);
    LinkConfigValidator.Result rejected = new LinkConfigValidator().validate(List.of(bad));
    assertFalse(rejected.ok());
    assertTrue(rejected.errors().stream().anyMatch(e -> e.contains("points[0](temp).fc")));
    assertTrue(rejected.errors().stream().anyMatch(e -> e.contains("points[1](temp).id")));
  }

  @Test
  void staleTimeoutMustCoverTwoPollsAndNamesThePoint() {
    CommProperties.Link link = new CommProperties.Link();
    link.setId("plc");
    link.setProtocol("modbus-tcp");
    link.setStaleTimeoutMs(1000);
    link.setPollIntervalMs(1000);
    CommProperties.Endpoint ep = new CommProperties.Endpoint();
    ep.setHost("10.0.0.1");
    ep.setPort(502);
    link.getEndpoints().add(ep);
    CommProperties.Point point = new CommProperties.Point();
    point.setId("temp");
    point.setFc(3);
    point.setAddress(0);
    point.setType("uint16");
    link.getPoints().add(point);
    LinkConfigValidator.Result rejected = new LinkConfigValidator().validate(List.of(link));
    assertFalse(rejected.ok());
    assertTrue(
        rejected.errors().stream().anyMatch(e -> e.contains("links[0].points[0](temp)") && e.contains("staleTimeoutMs")));
  }

  @Test
  void lifetimeMustBeThreeKeepAlives() {
    CommProperties.Link link = new CommProperties.Link();
    link.setId("ua");
    link.setProtocol("opcua");
    link.setEndpointUrl("opc.tcp://10.0.0.20:4840");
    link.getOpcua().setKeepAliveCount(20);
    link.getOpcua().setLifetimeCount(10);
    LinkConfigValidator.Result rejected = new LinkConfigValidator().validate(List.of(link));
    assertFalse(rejected.ok());
    assertTrue(rejected.errors().stream().anyMatch(e -> e.contains("links[0].opcua.lifetimeCount")));
  }

  @Test
  void duplicateMqttClientIdFailsBeforeStart() {
    LinkConfigValidator.Result one = new LinkConfigValidator().validate(List.of(mqtt("pump-a", "pump-1")));
    assertTrue(one.ok(), one.errors().toString());
    assertEquals("scada-plant-pump-1", one.links().get(0).mqtt().clientId());

    LinkConfigValidator.Result duplicated =
        new LinkConfigValidator().validate(List.of(mqtt("pump-a", "pump-1"), mqtt("pump-b", "pump-1")));
    assertFalse(duplicated.ok());
    assertTrue(
        duplicated.errors().stream().anyMatch(e -> e.contains("links[1](pump-b).mqtt.clientId") && e.contains("duplicate")));
  }

  @Test
  void httpRejectsBadBaseUrlAuthAndNamesThePoint() {
    CommProperties.Link ok = httpLink();
    LinkConfigValidator.Result accepted = new LinkConfigValidator().validate(List.of(ok));
    assertTrue(accepted.ok(), accepted.errors().toString());
    assertEquals(9, accepted.links().get(0).endpoint(0).port());
    assertEquals("/values", accepted.links().get(0).points().get(0).path());
    assertEquals("sensors.temp", accepted.links().get(0).points().get(0).field());

    CommProperties.Link bad = httpLink();
    bad.getHttp().setBaseUrl("ftp://files.local/x");
    bad.getHttp().getAuth().setType("oauth2");
    bad.getHttp().setWriteMethod("DELETE");
    bad.getHttp().setMaxResponseBytes(0);
    bad.getPoints().clear();
    CommProperties.Point point = new CommProperties.Point();
    point.setId("temp");
    point.setPath("/values");
    bad.getPoints().add(point);
    LinkConfigValidator.Result rejected = new LinkConfigValidator().validate(List.of(bad));
    assertFalse(rejected.ok());
    String joined = String.join("\n", rejected.errors());
    assertTrue(joined.contains("links[0].http.baseUrl"));
    assertTrue(joined.contains("links[0].http.auth.tokenUrl"));
    assertTrue(joined.contains("links[0].http.auth.clientId"));
    assertTrue(joined.contains("links[0].http.auth.clientSecret"));
    assertTrue(joined.contains("links[0].http.writeMethod"));
    assertTrue(joined.contains("links[0].http.maxResponseBytes"));
    assertTrue(joined.contains("links[0].points[0](temp).type"));
  }

  @Test
  void tagIdDefaultsToPointIdAndRejectsABlankPoint() {
    CommProperties.Link link = new CommProperties.Link();
    link.setId("plc");
    link.setProtocol("modbus-tcp");
    CommProperties.Endpoint ep = new CommProperties.Endpoint();
    ep.setHost("10.0.0.1");
    ep.setPort(502);
    link.getEndpoints().add(ep);
    CommProperties.Point flow = new CommProperties.Point();
    flow.setId("flow");
    flow.setTagId("plant.flow");
    flow.setFc(3);
    flow.setAddress(0);
    flow.setType("float32");
    link.getPoints().add(flow);
    CommProperties.Point pressure = new CommProperties.Point();
    pressure.setId("pressure");
    pressure.setFc(3);
    pressure.setAddress(2);
    pressure.setType("float32");
    link.getPoints().add(pressure);
    LinkConfigValidator.Result ok = new LinkConfigValidator().validate(List.of(link));
    assertTrue(ok.ok(), ok.errors().toString());
    assertEquals("plant.flow", ok.links().get(0).points().get(0).tagId());
    assertEquals("pressure", ok.links().get(0).points().get(1).tagId());

    CommProperties.Point blank = new CommProperties.Point();
    blank.setFc(3);
    blank.setAddress(4);
    blank.setType("uint16");
    link.getPoints().add(blank);
    LinkConfigValidator.Result rejected = new LinkConfigValidator().validate(List.of(link));
    assertTrue(rejected.errors().stream().anyMatch(e -> e.contains(".tagId: required")));
  }

  private static CommProperties.Link httpLink() {
    CommProperties.Link link = new CommProperties.Link();
    link.setId("api");
    link.setProtocol("http");
    link.getHttp().setBaseUrl("http://127.0.0.1:9/api");
    CommProperties.Point point = new CommProperties.Point();
    point.setId("temp");
    point.setPath("/values");
    point.setJsonPath("sensors.temp");
    point.setType("double");
    link.getPoints().add(point);
    return link;
  }

  private static CommProperties.Link mqtt(String id, String deviceId) {
    CommProperties.Link link = new CommProperties.Link();
    link.setId(id);
    link.setDeviceId(deviceId);
    link.setProtocol("mqtt");
    link.getMqtt().setBrokerUrl("tcp://127.0.0.1:1883");
    link.getMqtt().setClientIdPrefix("scada");
    link.getMqtt().setSite("plant");
    link.getMqtt().setKeepAliveSec(30);
    CommProperties.MqttTopic topic = new CommProperties.MqttTopic();
    topic.setFilter("plant/" + deviceId + "/data");
    topic.setQos(1);
    link.getMqtt().getTopics().add(topic);
    CommProperties.Point point = new CommProperties.Point();
    point.setId("temp");
    point.setType("double");
    point.setTopic("plant/" + deviceId + "/data");
    link.getPoints().add(point);
    return link;
  }
}
