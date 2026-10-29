package com.webscada.server.comm.driver.modbus;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import org.junit.jupiter.api.Test;

class MbapBufferTest {
  @Test
  void roundTripsHeaderAndPdu() throws Exception {
    byte[] pdu = new byte[] {0x03, 0x02, 0x12, 0x34};
    byte[] raw = MbapBuffer.encode(7, 0, 1, pdu);
    MbapBuffer buffer = new MbapBuffer();
    buffer.append(raw);
    MbapBuffer.Frame frame = buffer.poll();
    assertEquals(7, frame.transactionId());
    assertEquals(0, frame.protocolId());
    assertEquals(1, frame.unitId());
    assertArrayEquals(pdu, frame.pdu());
    assertNull(buffer.poll());
  }

  @Test
  void splitsStickyFrames() throws Exception {
    byte[] first = MbapBuffer.encode(1, 0, 1, new byte[] {0x03, 0x02, 0x00, 0x2A});
    byte[] second = MbapBuffer.encode(2, 0, 1, new byte[] {0x03, 0x02, 0x00, 0x2B});
    byte[] both = new byte[first.length + second.length];
    System.arraycopy(first, 0, both, 0, first.length);
    System.arraycopy(second, 0, both, first.length, second.length);
    MbapBuffer buffer = new MbapBuffer();
    buffer.append(both);
    assertEquals(1, buffer.poll().transactionId());
    assertEquals(2, buffer.poll().transactionId());
    assertNull(buffer.poll());
  }

  @Test
  void waitsForAPartialFrame() throws Exception {
    byte[] raw = MbapBuffer.encode(9, 0, 1, new byte[] {0x03, 0x02, 0x00, 0x01});
    MbapBuffer buffer = new MbapBuffer();
    buffer.append(raw, 0, 3);
    assertNull(buffer.poll());
    buffer.append(raw, 3, 4);
    assertNull(buffer.poll());
    buffer.append(raw, 7, raw.length - 7);
    MbapBuffer.Frame frame = buffer.poll();
    assertEquals(9, frame.transactionId());
    assertArrayEquals(new byte[] {0x03, 0x02, 0x00, 0x01}, frame.pdu());
  }

  @Test
  void rejectsLengthThatDoesNotMatchAFrame() throws Exception {
    MbapBuffer zeroBuf = new MbapBuffer();
    zeroBuf.append(new byte[] {0, 1, 0, 0, 0, 0});
    CommException zero = assertThrows(CommException.class, zeroBuf::poll);
    assertEquals(ErrorCategory.PROTOCOL, zero.category());
    MbapBuffer hugeBuf = new MbapBuffer();
    hugeBuf.append(new byte[] {0, 1, 0, 0, 0x01, 0x2C});
    CommException huge = assertThrows(CommException.class, hugeBuf::poll);
    assertEquals(ErrorCategory.PROTOCOL, huge.category());
    assertTrue(huge.getMessage().contains("length"));
  }

  @Test
  void rejectsNonZeroProtocolId() {
    MbapBuffer.Frame frame = new MbapBuffer.Frame(1, 1, 1, new byte[] {0x03});
    CommException error = assertThrows(CommException.class, () -> MbapBuffer.requireProtocol(frame));
    assertEquals(ErrorCategory.PROTOCOL, error.category());
    assertTrue(error.getMessage().contains("protocol"));
  }
}
