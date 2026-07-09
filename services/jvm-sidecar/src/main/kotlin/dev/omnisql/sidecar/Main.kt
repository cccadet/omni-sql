package dev.omnisql.sidecar

import com.sun.net.httpserver.HttpServer
import dev.omnisql.sidecar.editability.QueryEditabilityAnalyzer
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