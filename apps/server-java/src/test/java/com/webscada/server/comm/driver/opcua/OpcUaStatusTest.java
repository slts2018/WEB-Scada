package com.webscada.server.comm.driver.opcua;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.webscada.server.comm.data.Quality;
import org.eclipse.milo.opcua.stack.core.StatusCodes;
import org.eclipse.milo.opcua.stack.core.types.builtin.StatusCode;
import org.junit.jupiter.api.Test;

class OpcUaStatusTest {
  @Test
  void mapsTheRequiredStatusCodes() {
    assertEquals(Quality.GOOD, OpcUaStatus.map(new StatusCode(StatusCodes.Good)).quality());
    assertEquals(Quality.UNCERTAIN, OpcUaStatus.map(new StatusCode(StatusCodes.Uncertain)).quality());
    assertEquals(Quality.BAD_CONFIG, OpcUaStatus.map(new StatusCode(StatusCodes.Bad_NodeIdUnknown)).quality());
    assertEquals(
        Quality.BAD_COMM_FAILURE, OpcUaStatus.map(new StatusCode(StatusCodes.Bad_CommunicationError)).quality());
    assertEquals(Quality.BAD_DEVICE, OpcUaStatus.map(new StatusCode(StatusCodes.Bad_DeviceFailure)).quality());
    OpcUaStatus.Mapped other = OpcUaStatus.map(new StatusCode(StatusCodes.Bad_UnexpectedError));
    assertEquals(Quality.BAD_DEVICE, other.quality());
    assertTrue(other.logStatus());
    assertFalse(OpcUaStatus.map(new StatusCode(StatusCodes.Good)).logStatus());
  }
}
