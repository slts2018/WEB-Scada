package com.webscada.server.comm.driver;

import com.webscada.server.comm.error.CommException;
import com.webscada.server.comm.error.ErrorCategory;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import javax.net.ssl.KeyManager;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;

/**
 * PEM 证书和 PKCS8 私钥。MQTT 要套接字工厂，HTTP 要 {@link SSLContext}，只在这里加载一次。
 * 私钥材料不写日志。传统 RSA/EC PEM 直接拒绝。
 */
public final class TlsSupport {
  private TlsSupport() {}

  public static SSLSocketFactory socketFactory(String caFile, String clientCert, String clientKey)
      throws CommException {
    if (blank(caFile) && blank(clientCert) && blank(clientKey)) {
      return (SSLSocketFactory) SSLSocketFactory.getDefault();
    }
    return sslContext(caFile, clientCert, clientKey).getSocketFactory();
  }

  public static SSLContext sslContext(String caFile, String clientCert, String clientKey)
      throws CommException {
    try {
      if (blank(caFile) && blank(clientCert) && blank(clientKey)) {
        return SSLContext.getDefault();
      }
      TrustManagerFactory trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
      if (blank(caFile)) {
        trust.init((KeyStore) null);
      } else {
        KeyStore store = KeyStore.getInstance(KeyStore.getDefaultType());
        store.load(null, null);
        int i = 0;
        for (Certificate cert : readCerts(caFile)) {
          store.setCertificateEntry("ca-" + i++, cert);
        }
        trust.init(store);
      }
      KeyManager[] keys = null;
      if (!blank(clientCert) || !blank(clientKey)) {
        if (blank(clientCert) || blank(clientKey)) {
          throw config("tls clientCert and clientKey are both required");
        }
        List<Certificate> chain = readCerts(clientCert);
        PrivateKey key = readKey(clientKey);
        KeyStore store = KeyStore.getInstance(KeyStore.getDefaultType());
        store.load(null, null);
        store.setKeyEntry("client", key, new char[0], chain.toArray(Certificate[]::new));
        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(store, new char[0]);
        keys = kmf.getKeyManagers();
      }
      SSLContext context = SSLContext.getInstance("TLS");
      context.init(keys, trust.getTrustManagers(), null);
      return context;
    } catch (CommException ex) {
      throw ex;
    } catch (Exception ex) {
      throw config("tls: " + ex.getMessage());
    }
  }

  private static boolean blank(String value) {
    return value == null || value.isBlank();
  }

  private static List<Certificate> readCerts(String path) throws Exception {
    String pem = Files.readString(Path.of(path));
    CertificateFactory factory = CertificateFactory.getInstance("X.509");
    List<Certificate> certs = new ArrayList<>();
    for (String body : blocks(pem, "CERTIFICATE")) {
      certs.add(factory.generateCertificate(new ByteArrayInputStream(body.getBytes(StandardCharsets.US_ASCII))));
    }
    if (certs.isEmpty()) {
      throw new IllegalArgumentException("no certificate in " + path);
    }
    return certs;
  }

  private static PrivateKey readKey(String path) throws Exception {
    String pem = Files.readString(Path.of(path));
    if (pem.contains("BEGIN RSA PRIVATE KEY") || pem.contains("BEGIN EC PRIVATE KEY")) {
      throw new IllegalArgumentException("clientKey must be PKCS8 PEM");
    }
    List<String> blocks = blocks(pem, "PRIVATE KEY");
    if (blocks.isEmpty()) throw new IllegalArgumentException("no private key in " + path);
    byte[] der = Base64.getMimeDecoder().decode(stripArmor(blocks.get(0)));
    PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(der);
    try {
      return KeyFactory.getInstance("RSA").generatePrivate(spec);
    } catch (Exception rsa) {
      return KeyFactory.getInstance("EC").generatePrivate(spec);
    }
  }

  private static List<String> blocks(String pem, String kind) {
    String begin = "-----BEGIN " + kind + "-----";
    String end = "-----END " + kind + "-----";
    List<String> found = new ArrayList<>();
    int from = 0;
    while (true) {
      int start = pem.indexOf(begin, from);
      if (start < 0) break;
      int stop = pem.indexOf(end, start);
      if (stop < 0) break;
      found.add(pem.substring(start, stop + end.length()));
      from = stop + end.length();
    }
    return found;
  }

  private static String stripArmor(String pem) {
    return pem.replace("-----BEGIN PRIVATE KEY-----", "")
        .replace("-----END PRIVATE KEY-----", "")
        .replaceAll("\\s", "");
  }

  private static CommException config(String message) {
    return new CommException(ErrorCategory.CONFIG, false, false, message);
  }
}
