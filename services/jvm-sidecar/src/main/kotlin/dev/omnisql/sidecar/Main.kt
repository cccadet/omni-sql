package dev.omnisql.sidecar

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicLong

/**
 * Spike da Fase 0 — JVM sidecar mínimo.
 *
 * Risco mitigado: validar que (a) Kotlin + JDK-only HTTP server sobe limpo num
 * cold-start < 1s, (b) Tauri consegue matar o processo na fase de teardown, e
 * (c) o contrato HTTP /health é suficiente como heart-beat para futuras
 * chamadas /scope/resolve (Calcite fase 3).
 *
 * Porta padrão 41921 — distinta do backend Node (41920) para evitar conflito
 * deAssigned no Tauri. Override via env `OMNI_SIDE_CAR_PORT`.
 *
 * Tudo aqui é deliberadamente "sem frameworks": Ktor/AutHttp/Coroutines entram
 * só quando a Fase 3 decidir Calcite vs ANTLR. Em um spike, menos código externo
 * = menos variáveis nas falhas.
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
        exchange.sendResponseHeaders(200, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
        exchange.close()
    }

    server.createContext("/") { exchange ->
        val msg = "not found: ${exchange.requestURI}"
        val bytes = msg.toByteArray(Charsets.UTF_8)
        exchange.sendResponseHeaders(404, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
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