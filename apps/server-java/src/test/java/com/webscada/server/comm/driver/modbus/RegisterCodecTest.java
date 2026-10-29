package com.webscada.server.comm.driver.modbus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.webscada.server.comm.data.Quality;
import com.webscada.server.comm.driver.modbus.RegisterCodec.Endian;
import com.webscada.server.comm.driver.modbus.RegisterCodec.WordOrder;
import org.junit.jupiter.api.Test;

class RegisterCodecTest {
  @Test
  void decodesWordAndByteOrders() {
    assertEquals(0x1234, decode("uint16", 1, WordOrder.HIGH_FIRST, Endian.BIG, 1, 0, 0x12, 0x34).value());
    assertEquals(0x1234, decode("uint16", 1, WordOrder.HIGH_FIRST, Endian.LITTLE, 1, 0, 0x34, 0x12).value());
    assertEquals(
        0x12345678,
        decode("int32", 2, WordOrder.HIGH_FIRST, Endian.BIG, 1, 0, 0x12, 0x34, 0x56, 0x78).value());
    assertEquals(
        0x12345678,
        decode("int32", 2, WordOrder.LOW_FIRST, Endian.BIG, 1, 0, 0x56, 0x78, 0x12, 0x34).value());
    assertEquals(1f, floatOf(WordOrder.HIGH_FIRST, Endian.BIG, 0x3F, 0x80, 0x00, 0x00));
    assertEquals(1f, floatOf(WordOrder.LOW_FIRST, Endian.BIG, 0x00, 0x00, 0x3F, 0x80));
    assertEquals(1f, floatOf(WordOrder.HIGH_FIRST, Endian.LITTLE, 0x80, 0x3F, 0x00, 0x00));
    assertEquals(1f, floatOf(WordOrder.LOW_FIRST, Endian.LITTLE, 0x00, 0x00, 0x80, 0x3F));
  }

  @Test
  void appliesScaleAfterDecode() {
    RegisterCodec.Decoded decoded =
        decode("uint16", 1, WordOrder.HIGH_FIRST, Endian.BIG, 0.1, 1, 0x00, 0x0A);
    assertEquals(2.0d, ((Number) decoded.value()).doubleValue(), 1e-9);
    assertEquals(Quality.GOOD, decoded.quality());
  }

  @Test
  void rejectsNanInfAndShortPayloadWithoutInventingZero() {
    RegisterCodec.Decoded nan =
        decode("float32", 2, WordOrder.HIGH_FIRST, Endian.BIG, 1, 0, 0x7F, 0xC0, 0x00, 0x00);
    assertNull(nan.value());
    assertEquals(Quality.BAD_CONFIG, nan.quality());
    assertTrue(nan.detail().contains("NaN"));
    assertTrue(nan.detail().contains("7FC00000"));

    RegisterCodec.Decoded inf =
        decode("float32", 2, WordOrder.HIGH_FIRST, Endian.BIG, 1, 0, 0x7F, 0x80, 0x00, 0x00);
    assertNull(inf.value());
    assertTrue(inf.detail().contains("Inf"));
    assertTrue(inf.detail().contains("7F800000"));

    RegisterCodec.Decoded shortPayload =
        decode("uint16", 1, WordOrder.HIGH_FIRST, Endian.BIG, 1, 0, 0x12);
    assertNull(shortPayload.value());
    assertEquals(Quality.BAD_CONFIG, shortPayload.quality());
    assertTrue(shortPayload.detail().contains("12"));
  }

  @Test
  void maps40001StyleAddresses() {
    assertEquals(0, Addressing.toPdu("0", 3, 0));
    assertEquals(1, Addressing.toPdu("40001", 3, 40002));
    assertEquals(1, Addressing.toPdu("40001", 4, 30002));
    assertEquals(0, Addressing.toPdu("40001", 1, 1));
    assertEquals(0, Addressing.toPdu("40001", 2, 10001));
  }

  private static float floatOf(WordOrder word, Endian endian, int... bytes) {
    return ((Number) decode("float32", 2, word, endian, 1, 0, bytes).value()).floatValue();
  }

  private static RegisterCodec.Decoded decode(
      String type, int width, WordOrder word, Endian endian, double scale, double offset, int... bytes) {
    byte[] wire = new byte[bytes.length];
    for (int i = 0; i < bytes.length; i++) wire[i] = (byte) bytes[i];
    return RegisterCodec.decode(point(type, width, word, endian, scale, offset), wire);
  }

  private static ModbusPoint point(
      String type, int width, WordOrder word, Endian endian, double scale, double offset) {
    return new ModbusPoint("t", 1, 3, 0, width, type, word, endian, scale, offset);
  }
}
