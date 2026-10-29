package com.webscada.server.comm.driver.opcua;

import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.PrivateKey;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;

/** 读取 PEM 证书和 PKCS8 私钥。加密私钥会直接说明原因。 */
public final class OpcUaCertificates {
  private OpcUaCertificates() {}

  public static X509Certificate loadCertificate(String path) throws CommException {
    try {
      byte[] body = der(Files.readString(Path.of(path)), "CERTIFICATE");
      return (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(body));
    } catch (CommException ex) {
      throw ex;
    } catch (Exception ex) {
      throw config("cannot read client certificate " + path + ": " + ex.getMessage() + " 可能时钟偏差");
    }
  }

  public static KeyPair loadKeyPair(String certPath, String keyPath) throws CommException {
    X509Certificate certificate = loadCertificate(certPath);
    try {
      String text = Files.readString(Path.of(keyPath));
      if (text.contains("ENCRYPTED")) {
        throw config("client key is encrypted: " + keyPath);
      }
      byte[] body = der(text, "PRIVATE KEY");
      PrivateKey key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(body));
      return new KeyPair(certificate.getPublicKey(), key);
    } catch (CommException ex) {
      throw ex;
    } catch (Exception ex) {
      throw config("cannot read client key " + keyPath + ": " + ex.getMessage());
    }
  }

  private static byte[] der(String pem, String kind) throws CommException {
    String marker = "BEGIN " + kind;
    int start = pem.indexOf(marker);
    if (start < 0) {
      try {
        return Files.readAllBytes(Path.of(pem));
      } catch (Exception ex) {
        return Base64.getDecoder().decode(pem.replaceAll("\\s", ""));
      }
    }
    int data = pem.indexOf('\n', start);
    int end = pem.indexOf("END " + kind, data);
    if (data < 0 || end < 0) throw config("malformed PEM " + kind);
    String base64 = pem.substring(data, end).replace("-----", "").replaceAll("\\s", "");
    return Base64.getDecoder().decode(base64);
  }

  private static CommException config(String message) {
    return new CommException(ErrorCategory.CONFIG, false, false, message);
  }
}
