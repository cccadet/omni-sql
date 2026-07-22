package dev.omnisql.sidecar

import java.security.MessageDigest

/** Authentication policy shared by every HTTP context in the sidecar. */
internal object AuthPolicy {
    fun acceptsAuthorization(expectedToken: String?, authorization: String?): Boolean {
        val suppliedToken = authorization
            ?.trim()
            ?.let(Regex("^Bearer[ \\t]+([^ \\t]+)$", RegexOption.IGNORE_CASE)::find)
            ?.groupValues
            ?.getOrNull(1)
        return accepts(expectedToken, suppliedToken)
    }

    private fun accepts(expectedToken: String?, suppliedToken: String?): Boolean {
        if (expectedToken.isNullOrEmpty() || suppliedToken == null) return false
        return MessageDigest.isEqual(
            expectedToken.toByteArray(Charsets.UTF_8),
            suppliedToken.toByteArray(Charsets.UTF_8),
        )
    }
}
