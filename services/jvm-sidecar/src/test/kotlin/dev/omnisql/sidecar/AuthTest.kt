package dev.omnisql.sidecar

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AuthTest {
    @Test
    fun `accepts only the configured token`() {
        assertTrue(AuthPolicy.acceptsAuthorization("test-token", "Bearer test-token"))
        assertTrue(AuthPolicy.acceptsAuthorization("test-token", "bearer test-token"))
        assertFalse(AuthPolicy.acceptsAuthorization("test-token", "Bearer wrong-token"))
    }

    @Test
    fun `fails closed for missing configuration or header`() {
        assertFalse(AuthPolicy.acceptsAuthorization(null, "Bearer test-token"))
        assertFalse(AuthPolicy.acceptsAuthorization("", "Bearer test-token"))
        assertFalse(AuthPolicy.acceptsAuthorization("test-token", null))
        assertFalse(AuthPolicy.acceptsAuthorization("test-token", "test-token"))
    }
}
