package dev.omnisql.sidecar

import com.sun.net.httpserver.HttpServer
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.json.JSONObject

class MainTest {
    private lateinit var server: HttpServer
    private lateinit var baseUrl: String
    private val client = HttpClient.newHttpClient()

    @BeforeTest
    fun startServer() {
        server = createSidecarServer(0, "sidecar-token", startMs = 1_000, pid = 123, instanceId = "test-instance")
        server.start()
        baseUrl = "http://127.0.0.1:${server.address.port}"
    }

    @AfterTest
    fun stopServer() {
        server.stop(0)
    }

    @Test
    fun `health requires authentication and reports the sidecar identity`() {
        val denied = request("/health", authorization = null)
        assertEquals(401, denied.statusCode())
        assertEquals("unauthorized", JSONObject(denied.body()).getString("error"))

        val health = request("/health")
        assertEquals(200, health.statusCode())
        val body = JSONObject(health.body())
        assertEquals("ok", body.getString("status"))
        assertEquals("omni-sql-sidecar", body.getString("service"))
        assertEquals("http-json", body.getString("protocol"))
        assertEquals("test-instance", body.getString("instanceId"))
        assertEquals(123, body.getLong("pid"))
        assertTrue(body.getJSONObject("metrics").getLong("requestsTotal") >= 1)
    }

    @Test
    fun `scope resolver accepts only post and falls back for malformed JSON`() {
        assertEquals(405, request("/scope/resolve").statusCode())

        val resolved = request("/scope/resolve", "POST", "{\"sql\":\"with a as (select 1 as num) select from a\"}")
        assertEquals(200, resolved.statusCode())
        val cte = JSONObject(resolved.body()).getJSONArray("ctes").getJSONObject(0)
        assertEquals("a", cte.getString("name"))
        assertEquals("num", cte.getJSONArray("columns").getString(0))

        val malformed = request("/scope/resolve", "POST", "{")
        assertEquals(200, malformed.statusCode())
        assertEquals(0, JSONObject(malformed.body()).getJSONArray("ctes").length())
    }

    @Test
    fun `editability route returns analysis and fails closed on invalid input`() {
        assertEquals(405, request("/query/editability").statusCode())

        val editable = request("/query/editability", "POST", "{\"sql\":\"select * from users\"}")
        assertEquals(200, editable.statusCode())
        val result = JSONObject(editable.body())
        assertTrue(result.getBoolean("editable"))
        assertTrue(result.getBoolean("selectStar"))
        assertEquals("users", result.getJSONObject("table").getString("name"))

        val malformed = request("/query/editability", "POST", "{")
        assertEquals(200, malformed.statusCode())
        val fallback = JSONObject(malformed.body())
        assertFalse(fallback.getBoolean("editable"))
        assertEquals("internal error", fallback.getString("reason"))
    }

    @Test
    fun `JDBC failures retain their response envelope and unknown paths are not found`() {
        assertEquals(405, request("/jdbc/query").statusCode())

        val invalid = request("/jdbc/query", "POST", "{")
        assertEquals(200, invalid.statusCode())
        val error = JSONObject(invalid.body())
        assertFalse(error.getBoolean("ok"))
        assertEquals("unknown", error.getString("causeTag"))

        assertEquals(404, request("/missing").statusCode())
    }

    private fun request(
        path: String,
        method: String = "GET",
        body: String? = null,
        authorization: String? = "Bearer sidecar-token",
    ): HttpResponse<String> {
        val builder = HttpRequest.newBuilder(URI("$baseUrl$path"))
        if (authorization != null) builder.header("Authorization", authorization)
        val publisher = body?.let(HttpRequest.BodyPublishers::ofString) ?: HttpRequest.BodyPublishers.noBody()
        return client.send(builder.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString())
    }
}
