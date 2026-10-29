package com.webscada.server.comm.driver.opcua;

import com.webscada.server.comm.data.Quality;
import org.eclipse.milo.opcua.stack.core.StatusCodes;
import org.eclipse.milo.opcua.stack.core.types.builtin.StatusCode;

/** OPC UA StatusCode 到链路品质。未单列的 Bad_* 记为 BAD_DEVICE，并要求调用方打出完整状态名。 */
public final class OpcUaStatus {
  private OpcUaStatus() {}

  public record Mapped(Quality quality, boolean logStatus) {}

  public static Mapped map(StatusCode status) {
    if (status == null || status.isGood()) return new Mapped(Quality.GOOD, false);
    long code = status.getValue();
    if (code == StatusCodes.Bad_WaitingForInitialData || status.isUncertain()) {
      return new Mapped(Quality.UNCERTAIN, false);
    }
    if (code == StatusCodes.Bad_NodeIdUnknown
        || code == StatusCodes.Bad_NodeIdInvalid
        || code == StatusCodes.Bad_AttributeIdInvalid
        || code == StatusCodes.Bad_TypeMismatch) {
      return new Mapped(Quality.BAD_CONFIG, false);
    }
    if (code == StatusCodes.Bad_CommunicationError
        || code == StatusCodes.Bad_ConnectionClosed
        || code == StatusCodes.Bad_ServerNotConnected
        || code == StatusCodes.Bad_SessionClosed
        || code == StatusCodes.Bad_Timeout
        || code == StatusCodes.Bad_NoCommunication) {
      return new Mapped(Quality.BAD_COMM_FAILURE, false);
    }
    if (code == StatusCodes.Bad_DeviceFailure || code == StatusCodes.Bad_InternalError) {
      return new Mapped(Quality.BAD_DEVICE, false);
    }
    if (status.isBad()) return new Mapped(Quality.BAD_DEVICE, true);
    return new Mapped(Quality.UNCERTAIN, true);
  }

  public static boolean clockSkew(StatusCode status) {
    if (status == null) return false;
    long code = status.getValue();
    return code == StatusCodes.Bad_CertificateTimeInvalid
        || code == StatusCodes.Bad_CertificateIssuerTimeInvalid
        || code == StatusCodes.Bad_InvalidTimestamp;
  }
}
