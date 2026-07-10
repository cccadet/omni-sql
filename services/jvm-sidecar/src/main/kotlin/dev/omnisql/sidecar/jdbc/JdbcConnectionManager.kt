package dev.omnisql.sidecar.jdbc

import java.io.File
import java.net.URLClassLoader
import java.sql.Connection
import java.sql.Driver
import java.sql.ResultSetMetaData
import java.sql.SQLException
import java.util.Properties

/** Uma coluna de resultado de query — mesmo shape de `QueryResultColumn` (TS). */
data class QueryResultColumn(val name: String, val dataType: String, val nullable: Boolean)

/** Mesmo shape de `QueryResult` (TS) — ver `packages/ts-types/src/index.ts`. */
data class QueryResult(
    val columns: List<QueryResultColumn>,
    val rows: List<List<Any?>>,
    val rowsAffected: Int?,
    val rowsMoreAvailable: Boolean,
    val elapsedMs: Long,
)

/**
 * Ponte JDBC genérica (Fase 6): carrega um driver de um `.jar` arbitrário
 * indicado pelo usuário via `URLClassLoader` e fala com ele direto pela
 * interface `java.sql.Driver` — sem passar por `DriverManager`.
 * `DriverManager` só reconhece drivers carregados pelo classloader do
 * chamador (ou via `ServiceLoader` no classpath do sistema); um jar carregado
 * dinamicamente nunca apareceria nele. Chamar `driver.connect(url, props)`
 * direto evita esse problema por completo.
 *
 * Conexões abertas ficam num map em memória, chaveadas por `connectionId`
 * (o mesmo id usado pelo `ConnectionConfig` do lado Node) — o HTTP server do
 * sidecar é single-threaded (`server.executor = null` em `Main.kt`), então
 * não há necessidade de sincronização aqui.
 */
object JdbcConnectionManager {
    class JdbcError(val causeTag: String, message: String, val sqlState: String? = null) : Exception(message)

    private data class Handle(val connection: Connection, val classLoader: URLClassLoader)

    private val connections = HashMap<String, Handle>()

    fun connect(
        connectionId: String,
        jarPath: String,
        driverClassName: String,
        jdbcUrl: String,
        user: String?,
        password: String?,
    ) {
        val jarFile = File(jarPath)
        if (!jarFile.isFile) {
            throw JdbcError("driver-missing", "jar not found: $jarPath")
        }
        val classLoader = URLClassLoader(arrayOf(jarFile.toURI().toURL()), javaClass.classLoader)
        val driver =
            try {
                Class.forName(driverClassName, true, classLoader).getDeclaredConstructor().newInstance() as Driver
            } catch (e: ReflectiveOperationException) {
                classLoader.close()
                throw JdbcError("driver-missing", "could not load driver class $driverClassName from $jarPath: ${e.message}")
            } catch (e: ClassCastException) {
                classLoader.close()
                throw JdbcError("driver-missing", "$driverClassName does not implement java.sql.Driver")
            }
        val props = Properties()
        user?.let { props.setProperty("user", it) }
        password?.let { props.setProperty("password", it) }
        val connection =
            try {
                driver.connect(jdbcUrl, props) ?: throw JdbcError("unsupported", "driver rejected URL: $jdbcUrl")
            } catch (e: SQLException) {
                classLoader.close()
                throw toJdbcError(e)
            }
        connections.remove(connectionId)?.let { closeQuietly(it) }
        connections[connectionId] = Handle(connection, classLoader)
    }

    fun close(connectionId: String) {
        connections.remove(connectionId)?.let { closeQuietly(it) }
    }

    fun query(connectionId: String, sql: String, limit: Int): QueryResult {
        val handle = connections[connectionId] ?: throw JdbcError("unsupported", "no open connection: $connectionId")
        val startMs = System.currentTimeMillis()
        try {
            handle.connection.createStatement().use { stmt ->
                // Best-effort: alguns drivers rejeitam setFetchSize (ou o ignoram);
                // nunca deve derrubar a query por isto.
                if (limit > 0) runCatching { stmt.fetchSize = limit + 1 }
                val hasResultSet = stmt.execute(sql)
                if (!hasResultSet) {
                    return QueryResult(emptyList(), emptyList(), stmt.updateCount, false, System.currentTimeMillis() - startMs)
                }
                stmt.resultSet.use { rs ->
                    val meta = rs.metaData
                    val columns =
                        (1..meta.columnCount).map { i ->
                            QueryResultColumn(
                                meta.getColumnLabel(i),
                                meta.getColumnTypeName(i),
                                meta.isNullable(i) != ResultSetMetaData.columnNoNulls,
                            )
                        }
                    val rows = mutableListOf<List<Any?>>()
                    var moreAvailable = false
                    while (rs.next()) {
                        if (limit > 0 && rows.size >= limit) {
                            moreAvailable = true
                            break
                        }
                        rows.add((1..meta.columnCount).map { i -> toJsonValue(rs.getObject(i)) })
                    }
                    return QueryResult(columns, rows, null, moreAvailable, System.currentTimeMillis() - startMs)
                }
            }
        } catch (e: SQLException) {
            throw toJdbcError(e)
        }
    }

    private fun toJsonValue(value: Any?): Any? =
        when (value) {
            null, is Number, is Boolean, is String -> value
            is ByteArray -> java.util.Base64.getEncoder().encodeToString(value)
            else -> value.toString()
        }

    private fun toJdbcError(e: SQLException): JdbcError {
        val causeTag =
            when {
                e.sqlState?.startsWith("08") == true -> "network"
                e.sqlState?.startsWith("28") == true -> "credentials"
                e.sqlState?.startsWith("42") == true -> "syntax"
                else -> "unknown"
            }
        return JdbcError(causeTag, e.message ?: "SQL error", e.sqlState)
    }

    private fun closeQuietly(handle: Handle) {
        try {
            handle.connection.close()
        } catch (_: SQLException) {
        }
        handle.classLoader.close()
    }
}
