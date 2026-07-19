package dev.omnisql.sidecar.jdbc

import java.io.File
import java.net.URLClassLoader
import java.sql.Connection
import java.sql.DatabaseMetaData
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

/** Mesmo shape de `Column` (TS) — sem `foreignKeyTo`/`defaultValue`: `getImportedKeys` não é confiável entre drivers JDBC arbitrários. */
data class JdbcColumn(
    val name: String,
    val dataType: String,
    val nullable: Boolean,
    val ordinalPosition: Int,
    val isPrimaryKey: Boolean,
)

data class JdbcTable(val name: String, val kind: String, val columns: List<JdbcColumn>)

data class JdbcSchema(val name: String, val tables: List<JdbcTable>)

/**
 * Ponte JDBC genérica (Fase 6): carrega um driver de um `.jar` arbitrário
 * indicado pelo usuário via `URLClassLoader` e fala com ele direto pela
 * interface `java.sql.Driver` — sem passar por `DriverManager`.
 * `DriverManager` só reconhece drivers carregados pelo classloader do
 * chamador (ou via `ServiceLoader` no classpath do sistema); um jar carregado
 * dinamicamente nunca apareceria nele. Chamar `driver.connect(url, props)`
 * direto evita esse problema por completo.
 *
 * Conexões abertas ficam num map em memória, chaveadas por um handle opaco
 * pertencente a uma instância de adaptador no Node. O HTTP server do sidecar é
 * single-threaded (`server.executor = null` em `Main.kt`), então não há
 * necessidade de sincronização aqui.
 */
object JdbcConnectionManager {
    const val MAX_QUERY_LIMIT = 10_000
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
        var connection: Connection? = null
        var committed = false
        try {
            val driver =
                try {
                    Class.forName(driverClassName, true, classLoader).getDeclaredConstructor().newInstance() as Driver
                } catch (e: ReflectiveOperationException) {
                    throw JdbcError("driver-missing", "could not load driver class $driverClassName from $jarPath: ${e.message}")
                } catch (e: ClassCastException) {
                    throw JdbcError("driver-missing", "$driverClassName does not implement java.sql.Driver")
                }
            val props = Properties()
            user?.let { props.setProperty("user", it) }
            password?.let { props.setProperty("password", it) }
            connection =
                try {
                    driver.connect(jdbcUrl, props) ?: throw JdbcError("unsupported", "driver rejected URL: $jdbcUrl")
                } catch (e: SQLException) {
                    throw toJdbcError(e)
                }
            connections.remove(connectionId)?.let { closeQuietly(it) }
            connections[connectionId] = Handle(connection ?: error("driver returned no connection"), classLoader)
            committed = true
        } catch (e: Throwable) {
            if (!committed) {
                closeConnectionQuietly(connection)
                closeClassLoaderQuietly(classLoader)
            }
            throw e
        }
    }

    fun close(connectionId: String) {
        connections.remove(connectionId)?.let { closeQuietly(it) }
    }

    /** Closes every live JDBC resource; safe to call repeatedly during shutdown. */
    fun closeAll() {
        val handles = connections.values.toList()
        connections.clear()
        handles.forEach(::closeQuietly)
    }

    fun openHandleCount(): Int = connections.size

    /** Nomes de schema, sem tabelas/colunas — usado pela UI pra escolher o que introspectar. */
    fun schemaNames(connectionId: String): List<String> {
        val handle = connections[connectionId] ?: throw JdbcError("unsupported", "no open connection: $connectionId")
        try {
            return discoverSchemas(handle.connection.metaData)
        } catch (e: SQLException) {
            throw toJdbcError(e)
        }
    }

    /** Introspecção via `DatabaseMetaData` (JDBC padrão) — funciona genérico entre drivers, incluindo os sem suporte a `information_schema` (ex.: Progress OpenEdge). */
    fun introspect(connectionId: String, schemaFilter: List<String>?): List<JdbcSchema> {
        val handle = connections[connectionId] ?: throw JdbcError("unsupported", "no open connection: $connectionId")
        try {
            val meta = handle.connection.metaData
            val allow = schemaFilter?.takeIf { it.isNotEmpty() }?.toSet()
            return discoverSchemas(meta)
                .filter { allow == null || it in allow }
                .map { schema -> JdbcSchema(schema, tablesForSchema(meta, schema)) }
        } catch (e: SQLException) {
            throw toJdbcError(e)
        }
    }

    /** Alguns drivers JDBC não expõem o conceito de schema (só catálogo) — cai pra um bucket único e passa `schemaPattern = null` nas chamadas de metadata seguintes. */
    private const val DEFAULT_SCHEMA = "default"

    private fun discoverSchemas(meta: DatabaseMetaData): List<String> {
        val names = mutableListOf<String>()
        meta.schemas.use { rs -> while (rs.next()) names.add(rs.getString("TABLE_SCHEM")) }
        return names.ifEmpty { listOf(DEFAULT_SCHEMA) }
    }

    private fun tablesForSchema(meta: DatabaseMetaData, schema: String): List<JdbcTable> {
        val schemaPattern = if (schema == DEFAULT_SCHEMA) null else schema
        val tables = mutableListOf<Pair<String, String>>()
        meta.getTables(null, schemaPattern, "%", arrayOf("TABLE", "VIEW")).use { rs ->
            while (rs.next()) {
                val kind = if (rs.getString("TABLE_TYPE") == "VIEW") "view" else "table"
                tables.add(rs.getString("TABLE_NAME") to kind)
            }
        }
        return tables.map { (name, kind) -> JdbcTable(name, kind, columnsForTable(meta, schemaPattern, name)) }
    }

    private fun columnsForTable(meta: DatabaseMetaData, schemaPattern: String?, table: String): List<JdbcColumn> {
        // ponytail: getPrimaryKeys não é suportado por todo driver JDBC (ex.: pontes ODBC) —
        // nunca deve derrubar a introspecção inteira por isto, só perde o flag de PK.
        val pkNames =
            runCatching {
                val names = mutableSetOf<String>()
                meta.getPrimaryKeys(null, schemaPattern, table).use { rs -> while (rs.next()) names.add(rs.getString("COLUMN_NAME")) }
                names
            }.getOrDefault(emptySet())
        val columns = mutableListOf<JdbcColumn>()
        meta.getColumns(null, schemaPattern, table, "%").use { rs ->
            while (rs.next()) {
                val name = rs.getString("COLUMN_NAME")
                columns.add(
                    JdbcColumn(
                        name = name,
                        dataType = rs.getString("TYPE_NAME") ?: "unknown",
                        nullable = rs.getInt("NULLABLE") != DatabaseMetaData.columnNoNulls,
                        ordinalPosition = rs.getInt("ORDINAL_POSITION"),
                        isPrimaryKey = name in pkNames,
                    ),
                )
            }
        }
        return columns
    }

    fun query(connectionId: String, sql: String, limit: Int): QueryResult {
        requireQueryLimit(limit)
        val handle = connections[connectionId] ?: throw JdbcError("unsupported", "no open connection: $connectionId")
        val startMs = System.currentTimeMillis()
        try {
            handle.connection.createStatement().use { stmt ->
                // Best-effort: alguns drivers rejeitam setFetchSize (ou o ignoram);
                // nunca deve derrubar a query por isto.
                runCatching { stmt.fetchSize = limit + 1 }
                // Prefer the server/driver-side row cap where supported. The
                // extra row is intentional: it preserves rowsMoreAvailable.
                runCatching { stmt.maxRows = limit + 1 }
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

    fun requireQueryLimit(limit: Int) {
        if (limit <= 0 || limit > MAX_QUERY_LIMIT) {
            throw JdbcError("invalid-request", "query limit must be between 1 and $MAX_QUERY_LIMIT")
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
        closeConnectionQuietly(handle.connection)
        closeClassLoaderQuietly(handle.classLoader)
    }

    private fun closeConnectionQuietly(connection: Connection?) {
        try {
            connection?.close()
        } catch (_: Throwable) {
        }
    }

    private fun closeClassLoaderQuietly(classLoader: URLClassLoader) {
        try {
            classLoader.close()
        } catch (_: Throwable) {
        }
    }
}
