package dev.omnisql.sidecar

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import dev.omnisql.sidecar.editability.QueryEditabilityAnalyzer
import dev.omnisql.sidecar.jdbc.JdbcConnectionManager
import dev.omnisql.sidecar.scope.ScopeResolver
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicLong
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/**
 * JVM sidecar — HTTP server mínimo (`com.sun.net.httpserver`, JDK puro) +
 * `/scope/resolve` (Fase 3: resolução de colunas de CTE via Apache Calcite,
 * ver `dev.omnisql.sidecar.scope.ScopeResolver`).
 *
 * Porta padrão 41921 — distinta do backend Node (41920) para evitar conflito
 * no Tauri. Override via env `OMNI_SIDE_CAR_PORT`.
 *
 * Ktor/Coroutines continuam de fora deliberadamente: o server síncrono do
 * JDK já é suficiente para o volume de requests do autocomplete tier2.
 */
fun main() {
    val port = (System.getenv("OMNI_SIDE_CAR_PORT") ?: "41921").toInt()
    val pid = ProcessHandle.current().pid()
    val startMs = System.currentTimeMillis()
    val requestCount = AtomicLong(0)
    val instanceId = UUID.randomUUID().toString()
    // Fail closed when the sidecar was started without a token. The token is
    // deliberately read once at boot, so it cannot change during the life of
    // the process and is never included in a response or log message.
    val authToken = System.getenv("OMNI_SQL_AUTH_TOKEN")?.takeIf { it.isNotEmpty() }

    val server = HttpServer.create(InetSocketAddress("127.0.0.1", port), 0)
    server.createAuthenticatedContext("/health", authToken) { exchange ->
        requestCount.incrementAndGet()
        val uptimeMs = System.currentTimeMillis() - startMs
        val body =
            JSONObject()
                .put("status", "ok")
                .put("service", "omni-sql-sidecar")
                .put("protocol", "http-json")
                .put("instanceId", instanceId)
                .put("pid", pid)
                .put("uptimeMs", uptimeMs)
                .put("jdbcOpenHandles", JdbcConnectionManager.openHandleCount())
                .put("metrics", JSONObject().put("requestsTotal", requestCount.get()).put("requestsFailed", requestFailures.get()))
                .toString()
        val bytes = body.toByteArray(Charsets.UTF_8)
        exchange.responseHeaders.add("content-type", "application/json")
        // Sem isso, o fetch() do webview (origin http://localhost:1420 em dev,
        // tauri://localhost em produção) é bloqueado por CORS mesmo com a
        // resposta chegando — mesmo problema já resolvido no backend Node.
        addCorsHeaders(exchange)
        exchange.sendResponseHeaders(200, bytes.size.toLong())
        exchange.responseBody.write(bytes)
        exchange.close()
    }

    server.createAuthenticatedContext("/scope/resolve", authToken) { exchange ->
        requestCount.incrementAndGet()
        try {
            if (exchange.requestMethod != "POST") {
                exchange.sendResponseHeaders(405, -1)
                exchange.close()
                return@createAuthenticatedContext
            }
            val requestBody = exchange.requestBody.readBytes().toString(Charsets.UTF_8)
            val sql = JSONObject(requestBody).optString("sql", "")
            val ctes = ScopeResolver.resolveCtes(sql)
            val ctesJson =
                JSONArray(
                    ctes.map { cte ->
                        JSONObject().put("name", cte.name).put("columns", JSONArray(cte.columns))
                    },
                )
            val bytes = JSONObject().put("ctes", ctesJson).toString().toByteArray(Charsets.UTF_8)
            exchange.responseHeaders.add("content-type", "application/json")
            addCorsHeaders(exchange)
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes)
        } catch (e: Exception) {
            requestFailures.incrementAndGet()
            // Best-effort: erro de parse/JSON malformado nunca deve derrubar
            // o sidecar nem virar 500 — o cliente (Node backend) trata
            // corpo vazio como "sem CTEs resolvidas" e segue em tier1 puro.
            val bytes = """{"ctes":[]}""".toByteArray(Charsets.UTF_8)
            exchange.responseHeaders.add("content-type", "application/json")
            addCorsHeaders(exchange)
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes)
        } finally {
            exchange.close()
        }
    }

    server.createAuthenticatedContext("/query/editability", authToken) { exchange ->
        requestCount.incrementAndGet()
        try {
            if (exchange.requestMethod != "POST") {
                exchange.sendResponseHeaders(405, -1)
                exchange.close()
                return@createAuthenticatedContext
            }
            val requestBody = exchange.requestBody.readBytes().toString(Charsets.UTF_8)
            val sql = JSONObject(requestBody).optString("sql", "")
            val result = QueryEditabilityAnalyzer.analyze(sql)
            val columnsJson =
                JSONArray(result.columns.map { c -> JSONObject().put("sourceColumn", c.sourceColumn ?: JSONObject.NULL) })
            val tableJson =
                result.table?.let { JSONObject().put("schema", it.schema ?: JSONObject.NULL).put("name", it.name) }
                    ?: JSONObject.NULL
            val bytes =
                JSONObject()
                    .put("editable", result.editable)
                    .put("reason", result.reason ?: JSONObject.NULL)
                    .put("table", tableJson)
                    .put("selectStar", result.selectStar)
                    .put("columns", columnsJson)
                    .toString()
                    .toByteArray(Charsets.UTF_8)
            exchange.responseHeaders.add("content-type", "application/json")
            addCorsHeaders(exchange)
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes)
        } catch (e: Exception) {
            requestFailures.incrementAndGet()
            // Best-effort, mesmo espírito do /scope/resolve: qualquer falha
            // vira "não editável" em vez de 500 — o backend Node trata isso
            // como grade read-only, exatamente como seria sem esta feature.
            val bytes =
                """{"editable":false,"reason":"internal error","table":null,"selectStar":false,"columns":[]}"""
                    .toByteArray(Charsets.UTF_8)
            exchange.responseHeaders.add("content-type", "application/json")
            addCorsHeaders(exchange)
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes)
        } finally {
            exchange.close()
        }
    }

    // JDBC genérico (Fase 6): carrega o `.jar` do driver que o usuário aponta
    // na UI e executa queries contra ele — ver
    // `dev.omnisql.sidecar.jdbc.JdbcConnectionManager` pro porquê disto viver
    // na JVM (Node não fala JDBC) e não passar por `DriverManager`. Ao
    // contrário de `/scope/resolve` e `/query/editability` (best-effort, nunca
    // falham), aqui um erro é uma falha real de conexão/query e deve chegar
    // ao usuário — por isso a resposta sempre tem `ok` e o corpo NUNCA é
    // "sucesso disfarçado".
    server.createAuthenticatedContext("/jdbc/connect", authToken) { exchange ->
        requestCount.incrementAndGet()
        handleJdbc(exchange) { body ->
            JdbcConnectionManager.connect(
                connectionId = body.getString("connectionId"),
                jarPath = body.getString("jarPath"),
                driverClassName = body.getString("driverClassName"),
                jdbcUrl = body.getString("jdbcUrl"),
                user = body.optStringOrNull("user"),
                password = body.optStringOrNull("password"),
            )
            JSONObject().put("ok", true)
        }
    }

    server.createAuthenticatedContext("/jdbc/query", authToken) { exchange ->
        requestCount.incrementAndGet()
        handleJdbc(exchange) { body ->
            val result =
                JdbcConnectionManager.query(
                    connectionId = body.getString("connectionId"),
                    sql = body.getString("sql"),
                    limit = body.optInt("limit", 0).also { JdbcConnectionManager.requireQueryLimit(it) },
                )
            val columnsJson =
                JSONArray(
                    result.columns.map { c ->
                        JSONObject().put("name", c.name).put("dataType", c.dataType).put("nullable", c.nullable)
                    },
                )
            val rowsJson =
                JSONArray(result.rows.map { row -> JSONArray(row.map { it ?: JSONObject.NULL }) })
            JSONObject()
                .put("ok", true)
                .put("columns", columnsJson)
                .put("rows", rowsJson)
                .put("rowsAffected", result.rowsAffected ?: JSONObject.NULL)
                .put("rowsMoreAvailable", result.rowsMoreAvailable)
                .put("elapsedMs", result.elapsedMs)
        }
    }

    server.createAuthenticatedContext("/jdbc/close", authToken) { exchange ->
        requestCount.incrementAndGet()
        handleJdbc(exchange) { body ->
            JdbcConnectionManager.close(body.getString("connectionId"))
            JSONObject().put("ok", true)
        }
    }

    server.createAuthenticatedContext("/jdbc/schemas", authToken) { exchange ->
        requestCount.incrementAndGet()
        handleJdbc(exchange) { body ->
            val names = JdbcConnectionManager.schemaNames(body.getString("connectionId"))
            JSONObject().put("ok", true).put("schemas", JSONArray(names))
        }
    }

    server.createAuthenticatedContext("/jdbc/introspect", authToken) { exchange ->
        requestCount.incrementAndGet()
        handleJdbc(exchange) { body ->
            val schemaFilter = body.optJSONArray("schemaFilter")?.let { arr -> (0 until arr.length()).map { arr.getString(it) } }
            val schemas = JdbcConnectionManager.introspect(body.getString("connectionId"), schemaFilter)
            val schemasJson =
                JSONArray(
                    schemas.map { schema ->
                        val tablesJson =
                            JSONArray(
                                schema.tables.map { table ->
                                    val columnsJson =
                                        JSONArray(
                                            table.columns.map { c ->
                                                JSONObject()
                                                    .put("name", c.name)
                                                    .put("dataType", c.dataType)
                                                    .put("nullable", c.nullable)
                                                    .put("ordinalPosition", c.ordinalPosition)
                                                    .put("isPrimaryKey", c.isPrimaryKey)
                                            },
                                        )
                                    JSONObject().put("name", table.name).put("kind", table.kind).put("columns", columnsJson)
                                },
                            )
                        JSONObject().put("name", schema.name).put("tables", tablesJson)
                    },
                )
            JSONObject().put("ok", true).put("schemas", schemasJson)
        }
    }

    server.createAuthenticatedContext("/", authToken) { exchange ->
        val msg = "not found: ${exchange.requestURI}"
        val bytes = msg.toByteArray(Charsets.UTF_8)
        exchange.sendResponseHeaders(404, bytes.size.toLong())
        exchange.responseBody.write(bytes)
        exchange.close()
    }

    server.executor = null // blocking dispatcher — suficiente p/ spike
    server.start()
    val bootMs = System.currentTimeMillis() - startMs
    println("[omni-sql-sidecar] listening on http://127.0.0.1:$port/health (boot=${bootMs}ms pid=$pid)")
    Runtime.getRuntime().addShutdownHook(Thread {
        try {
            server.stop(0)
        } finally {
            JdbcConnectionManager.closeAll()
        }
        println("[omni-sql-sidecar] shut down cleanly")
    })
}

private fun JSONObject.optStringOrNull(key: String): String? = if (has(key) && !isNull(key)) getString(key) else null

private fun HttpServer.createAuthenticatedContext(
    path: String,
    expectedToken: String?,
    handler: (HttpExchange) -> Unit,
) {
    createContext(path) { exchange ->
        if (!isAuthorized(exchange, expectedToken)) {
            // Do not reveal whether the token was absent, malformed, or
            // simply wrong. In particular, never echo the supplied token.
            try {
                writeJson(exchange, 401, JSONObject().put("error", "unauthorized"))
            } finally {
                exchange.close()
            }
        } else {
            handler(exchange)
        }
    }
}

private fun isAuthorized(exchange: HttpExchange, expectedToken: String?): Boolean {
    val suppliedToken = exchange.requestHeaders.getFirst("Authorization") ?: return false
    if (expectedToken == null) return false
    return AuthPolicy.acceptsAuthorization(expectedToken, suppliedToken)
}

/** CORS is opt-in and origin-bound; the old public wildcard is intentionally gone. */
private fun addCorsHeaders(exchange: HttpExchange) {
    val allowedOrigin = System.getenv("OMNI_SQL_ALLOWED_ORIGIN")?.takeIf { it.isNotEmpty() }
    val requestOrigin = exchange.requestHeaders.getFirst("Origin")
    if (allowedOrigin != null && requestOrigin == allowedOrigin) {
        exchange.responseHeaders.add("access-control-allow-origin", allowedOrigin)
        exchange.responseHeaders.add("vary", "Origin")
    }
}

/**
 * Parseia o corpo JSON, chama [handler] e responde 200 com o JSON retornado.
 * Falhas de [JdbcConnectionManager] (jar/driver/URL/SQL inválidos) viram
 * `{"ok":false,"causeTag":...}` — ao contrário de `/scope/resolve`, aqui o
 * erro é real e a UI (Node) precisa dele pra mostrar a causa certa ao usuário.
 */
private fun handleJdbc(exchange: HttpExchange, handler: (JSONObject) -> JSONObject) {
    try {
        if (exchange.requestMethod != "POST") {
            exchange.sendResponseHeaders(405, -1)
            exchange.close()
            return
        }
        val requestBody = exchange.requestBody.readBytes().toString(Charsets.UTF_8)
        val response = handler(JSONObject(requestBody))
        writeJson(exchange, 200, response)
    } catch (e: JdbcConnectionManager.JdbcError) {
        // Request counts are recorded at context entry; this response is a
        // failed request from the sidecar's point of view.
        requestFailures.incrementAndGet()
        val body =
            JSONObject()
                .put("ok", false)
                .put("causeTag", e.causeTag)
                .put("message", e.message)
                .put("sqlState", e.sqlState ?: JSONObject.NULL)
        writeJson(exchange, 200, body)
    } catch (e: Exception) {
        requestFailures.incrementAndGet()
        val body = JSONObject().put("ok", false).put("causeTag", "unknown").put("message", e.message ?: "internal error")
        writeJson(exchange, 200, body)
    } finally {
        exchange.close()
    }
}

private fun writeJson(exchange: HttpExchange, status: Int, json: JSONObject) {
    val bytes = json.toString().toByteArray(Charsets.UTF_8)
    exchange.responseHeaders.add("content-type", "application/json")
    addCorsHeaders(exchange)
    exchange.sendResponseHeaders(status, bytes.size.toLong())
    exchange.responseBody.write(bytes)
}

private val requestFailures = AtomicLong(0)
