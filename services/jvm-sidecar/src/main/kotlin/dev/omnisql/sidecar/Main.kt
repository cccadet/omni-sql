package dev.omnisql.sidecar

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import dev.omnisql.sidecar.editability.QueryEditabilityAnalyzer
import dev.omnisql.sidecar.jdbc.JdbcConnectionManager
import dev.omnisql.sidecar.scope.ScopeResolver
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicLong
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

    val server = HttpServer.create(InetSocketAddress("127.0.0.1", port), 0)
    server.createContext("/health") { exchange ->
        val uptimeMs = System.currentTimeMillis() - startMs
        val body = """{"status":"ok","pid":$pid,"uptimeMs":$uptimeMs,"requests":${requestCount.incrementAndGet()}}"""
        val bytes = body.toByteArray(Charsets.UTF_8)
        exchange.responseHeaders.add("content-type", "application/json")
        // Sem isso, o fetch() do webview (origin http://localhost:1420 em dev,
        // tauri://localhost em produção) é bloqueado por CORS mesmo com a
        // resposta chegando — mesmo problema já resolvido no backend Node.
        exchange.responseHeaders.add("access-control-allow-origin", "*")
        exchange.sendResponseHeaders(200, bytes.size.toLong())
        exchange.responseBody.write(bytes)
        exchange.close()
    }

    server.createContext("/scope/resolve") { exchange ->
        try {
            if (exchange.requestMethod != "POST") {
                exchange.sendResponseHeaders(405, -1)
                exchange.close()
                return@createContext
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
            exchange.responseHeaders.add("access-control-allow-origin", "*")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes)
        } catch (e: Exception) {
            // Best-effort: erro de parse/JSON malformado nunca deve derrubar
            // o sidecar nem virar 500 — o cliente (Node backend) trata
            // corpo vazio como "sem CTEs resolvidas" e segue em tier1 puro.
            val bytes = """{"ctes":[]}""".toByteArray(Charsets.UTF_8)
            exchange.responseHeaders.add("content-type", "application/json")
            exchange.responseHeaders.add("access-control-allow-origin", "*")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes)
        } finally {
            exchange.close()
        }
    }

    server.createContext("/query/editability") { exchange ->
        try {
            if (exchange.requestMethod != "POST") {
                exchange.sendResponseHeaders(405, -1)
                exchange.close()
                return@createContext
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
            exchange.responseHeaders.add("access-control-allow-origin", "*")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes)
        } catch (e: Exception) {
            // Best-effort, mesmo espírito do /scope/resolve: qualquer falha
            // vira "não editável" em vez de 500 — o backend Node trata isso
            // como grade read-only, exatamente como seria sem esta feature.
            val bytes =
                """{"editable":false,"reason":"internal error","table":null,"selectStar":false,"columns":[]}"""
                    .toByteArray(Charsets.UTF_8)
            exchange.responseHeaders.add("content-type", "application/json")
            exchange.responseHeaders.add("access-control-allow-origin", "*")
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
    server.createContext("/jdbc/connect") { exchange ->
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

    server.createContext("/jdbc/query") { exchange ->
        handleJdbc(exchange) { body ->
            val result =
                JdbcConnectionManager.query(
                    connectionId = body.getString("connectionId"),
                    sql = body.getString("sql"),
                    limit = body.optInt("limit", 0),
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

    server.createContext("/jdbc/close") { exchange ->
        handleJdbc(exchange) { body ->
            JdbcConnectionManager.close(body.getString("connectionId"))
            JSONObject().put("ok", true)
        }
    }

    server.createContext("/jdbc/schemas") { exchange ->
        handleJdbc(exchange) { body ->
            val names = JdbcConnectionManager.schemaNames(body.getString("connectionId"))
            JSONObject().put("ok", true).put("schemas", JSONArray(names))
        }
    }

    server.createContext("/jdbc/introspect") { exchange ->
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

    server.createContext("/") { exchange ->
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
        server.stop(0)
        println("[omni-sql-sidecar] shut down cleanly")
    })
}

private fun JSONObject.optStringOrNull(key: String): String? = if (has(key) && !isNull(key)) getString(key) else null

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
        val body =
            JSONObject()
                .put("ok", false)
                .put("causeTag", e.causeTag)
                .put("message", e.message)
                .put("sqlState", e.sqlState ?: JSONObject.NULL)
        writeJson(exchange, 200, body)
    } catch (e: Exception) {
        val body = JSONObject().put("ok", false).put("causeTag", "unknown").put("message", e.message ?: "internal error")
        writeJson(exchange, 200, body)
    } finally {
        exchange.close()
    }
}

private fun writeJson(exchange: HttpExchange, status: Int, json: JSONObject) {
    val bytes = json.toString().toByteArray(Charsets.UTF_8)
    exchange.responseHeaders.add("content-type", "application/json")
    exchange.responseHeaders.add("access-control-allow-origin", "*")
    exchange.sendResponseHeaders(status, bytes.size.toLong())
    exchange.responseBody.write(bytes)
}