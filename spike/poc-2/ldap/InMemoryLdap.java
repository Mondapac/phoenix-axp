// Test-only LDAP directory for PoC 2 (slice 0.7). Never part of the product.
//
// Runs the UnboundID LDAP SDK in-memory directory server (used here under its LGPL-2.1 option;
// test tooling only, outside the product's dependency tree, so ADR-0009 does not apply) on
// 127.0.0.1:<port>, loads the LDIF given on the command line and accepts writes, so a test can
// disable a user with ldapmodify exactly as a directory administrator would.
//
//   java -cp unboundid-ldapsdk.jar InMemoryLdap.java 10389 directory.ldif
import com.unboundid.ldap.listener.InMemoryDirectoryServer;
import com.unboundid.ldap.listener.InMemoryDirectoryServerConfig;
import com.unboundid.ldap.listener.InMemoryListenerConfig;
import java.net.InetAddress;

public class InMemoryLdap {
  public static void main(String[] args) throws Exception {
    int port = Integer.parseInt(args[0]);
    InMemoryDirectoryServerConfig config = new InMemoryDirectoryServerConfig("dc=phoenix,dc=test");
    // The bind account Keycloak's federation uses (read-only by convention in this test).
    config.addAdditionalBindCredentials("cn=keycloak,dc=phoenix,dc=test", "keycloak-bind");
    // The "directory administrator" the tests use to disable accounts.
    config.addAdditionalBindCredentials("cn=admin,dc=phoenix,dc=test", "admin-secret");
    config.setListenerConfigs(
        InMemoryListenerConfig.createLDAPConfig("ldap", InetAddress.getByName("127.0.0.1"), port, null));
    // entryUUID, createTimestamp and modifyTimestamp are generated, as in a real directory;
    // Keycloak uses entryUUID as the stable id and modifyTimestamp for changed-user sync.
    config.setGenerateOperationalAttributes(true);
    InMemoryDirectoryServer server = new InMemoryDirectoryServer(config);
    server.importFromLDIF(true, args[1]);
    server.startListening();
    System.out.println("LDAP listening on 127.0.0.1:" + port);
    Thread.currentThread().join();
  }
}
