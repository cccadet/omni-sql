package dev.omnisql.sidecar.jdbc

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class JdbcConnectionManagerTest {
    // H2 é dependência só de teste (não vira parte do jar do sidecar) — usamos
    // seu próprio jar em disco (resolvido via classloader) como o ".jar
    // arbitrário" que um usuário apontaria na UI, validando o carregamento
    // dinâmico de ponta a ponta sem precisar de um jar fixture no repo.
    private val h2JarPath = Class.forName("org.h2.Driver").protectionDomain.codeSource.location.toURI().path

    @Test
    fun `connects via a dynamically loaded jar and runs a query`() {
        val connectionId = "test-${System.nanoTime()}"
        JdbcConnectionManager.connect(
            connectionId = connectionId,
            jarPath = h2JarPath,
            driverClassName = "org.h2.Driver",
            jdbcUrl = "jdbc:h2:mem:$connectionId;DB_CLOSE_DELAY=-1",
            user = "sa",
            password = "",
        )
        try {
            JdbcConnectionManager.query(connectionId, "create table t (id int, name varchar(10))", 100)
            JdbcConnectionManager.query(connectionId, "insert into t values (1, 'a'), (2, 'b')", 100)
            val result = JdbcConnectionManager.query(connectionId, "select id, name from t order by id", 100)

            assertEquals(listOf("ID", "NAME"), result.columns.map { it.name })
            assertEquals(listOf(listOf(1, "a"), listOf(2, "b")), result.rows)
            assertFalse(result.rowsMoreAvailable)
        } finally {
            JdbcConnectionManager.close(connectionId)
        }
    }

    @Test
    fun `trims rows to the limit and reports more rows available`() {
        val connectionId = "test-${System.nanoTime()}"
        JdbcConnectionManager.connect(
            connectionId = connectionId,
            jarPath = h2JarPath,
            driverClassName = "org.h2.Driver",
            jdbcUrl = "jdbc:h2:mem:$connectionId;DB_CLOSE_DELAY=-1",
            user = "sa",
            password = "",
        )
        try {
            JdbcConnectionManager.query(connectionId, "create table t (id int)", 100)
            JdbcConnectionManager.query(connectionId, "insert into t values (1), (2), (3)", 100)
            val result = JdbcConnectionManager.query(connectionId, "select id from t order by id", 2)

            assertEquals(listOf(listOf(1), listOf(2)), result.rows)
            assertEquals(true, result.rowsMoreAvailable)
        } finally {
            JdbcConnectionManager.close(connectionId)
        }
    }

    @Test
    fun `unknown driver class raises a driver-missing error`() {
        val error =
            assertFailsWith<JdbcConnectionManager.JdbcError> {
                JdbcConnectionManager.connect(
                    connectionId = "test-bad-driver",
                    jarPath = h2JarPath,
                    driverClassName = "com.example.NoSuchDriver",
                    jdbcUrl = "jdbc:h2:mem:x",
                    user = null,
                    password = null,
                )
            }
        assertEquals("driver-missing", error.causeTag)
    }

    @Test
    fun `missing jar file raises a driver-missing error`() {
        val error =
            assertFailsWith<JdbcConnectionManager.JdbcError> {
                JdbcConnectionManager.connect(
                    connectionId = "test-bad-jar",
                    jarPath = "/no/such/driver.jar",
                    driverClassName = "org.h2.Driver",
                    jdbcUrl = "jdbc:h2:mem:x",
                    user = null,
                    password = null,
                )
            }
        assertEquals("driver-missing", error.causeTag)
    }
}
