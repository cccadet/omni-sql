package dev.omnisql.sidecar.scope

/** Um bloco de CTE extraído textualmente: `nome [(col,...)] AS ( corpo )`. */
internal data class CteBlock(val name: String, val explicitColumns: List<String>?, val body: String)

/**
 * Varredura textual (sem parser) que isola os blocos de uma cláusula
 * `WITH nome AS (corpo), nome2 AS (corpo2) <resto>`.
 *
 * Não interpreta o `<resto>` (a query externa, que costuma estar incompleta
 * enquanto o usuário digita — é exatamente por isso que um parse Calcite do
 * statement inteiro falharia). Só precisa achar onde cada `(corpo)` começa e
 * termina, balanceando parênteses e respeitando strings/identificadores
 * quotados/comentários — os corpos dos CTEs já estão completos nesse ponto,
 * então cada um pode ser parseado pelo Calcite isoladamente.
 */
internal class CteTextScanner(private val sql: String) {
    private var i = 0
    private val n = sql.length

    fun scan(): List<CteBlock> {
        val start = indexOfLeadingWithKeyword() ?: return emptyList()
        i = start + 4 // "with".length
        val blocks = mutableListOf<CteBlock>()
        while (true) {
            skipTrivia()
            val name = readIdentifier() ?: break
            skipTrivia()
            var explicitColumns: List<String>? = null
            if (peek() == '(') {
                val cols = readParenBody() ?: break
                explicitColumns = splitIdentifierList(cols)
                skipTrivia()
            }
            if (!matchKeywordAt("as")) break
            skipTrivia()
            if (peek() != '(') break
            val body = readParenBody() ?: break
            blocks.add(CteBlock(name, explicitColumns, body))
            skipTrivia()
            if (peek() == ',') {
                i++
                continue
            }
            break
        }
        return blocks
    }

    /** `with` só conta se for a primeira palavra significativa do texto. */
    private fun indexOfLeadingWithKeyword(): Int? {
        var j = 0
        while (j < n) {
            val c = sql[j]
            when {
                c.isWhitespace() -> j++
                c == '-' && j + 1 < n && sql[j + 1] == '-' -> {
                    val nl = sql.indexOf('\n', j)
                    j = if (nl < 0) n else nl + 1
                }
                c == '/' && j + 1 < n && sql[j + 1] == '*' -> {
                    val end = sql.indexOf("*/", j + 2)
                    j = if (end < 0) n else end + 2
                }
                else -> return if (matchKeywordAt(j, "with")) j else null
            }
        }
        return null
    }

    private fun peek(): Char? = if (i < n) sql[i] else null

    private fun skipTrivia() {
        while (i < n) {
            val c = sql[i]
            when {
                c.isWhitespace() -> i++
                c == '-' && i + 1 < n && sql[i + 1] == '-' -> {
                    val nl = sql.indexOf('\n', i)
                    i = if (nl < 0) n else nl + 1
                }
                c == '/' && i + 1 < n && sql[i + 1] == '*' -> {
                    val end = sql.indexOf("*/", i + 2)
                    i = if (end < 0) n else end + 2
                }
                else -> return
            }
        }
    }

    private fun isIdentChar(c: Char) = c.isLetterOrDigit() || c == '_' || c == '$' || c == '#'

    private fun readIdentifier(): String? {
        if (i >= n) return null
        if (sql[i] == '"') {
            val close = findQuoteEnd(i, '"')
            val text = sql.substring(i + 1, close).replace("\"\"", "\"")
            i = close + 1
            return text
        }
        val start = i
        if (!sql[i].isLetter() && sql[i] != '_') return null
        while (i < n && isIdentChar(sql[i])) i++
        return sql.substring(start, i)
    }

    private fun findQuoteEnd(from: Int, q: Char): Int {
        var j = from + 1
        while (j < n) {
            if (sql[j] == q) {
                if (j + 1 < n && sql[j + 1] == q) {
                    j += 2
                    continue
                }
                return j
            }
            j++
        }
        return n
    }

    private fun matchKeywordAt(kw: String): Boolean {
        if (!matchKeywordAt(i, kw)) return false
        i += kw.length
        return true
    }

    private fun matchKeywordAt(pos: Int, kw: String): Boolean {
        if (pos + kw.length > n) return false
        if (!sql.regionMatches(pos, kw, 0, kw.length, ignoreCase = true)) return false
        val after = pos + kw.length
        return after >= n || !isIdentChar(sql[after])
    }

    /**
     * Lê `( ... )` balanceado e retorna o conteúdo sem os parênteses
     * externos; posiciona [i] logo após o `)` de fechamento. Retorna `null`
     * se os parênteses não fecharem (corpo ainda incompleto/sendo digitado).
     */
    private fun readParenBody(): String? {
        if (peek() != '(') return null
        val start = i + 1
        var depth = 1
        var j = start
        while (j < n && depth > 0) {
            val c = sql[j]
            when {
                c == '(' -> {
                    depth++
                    j++
                }
                c == ')' -> {
                    depth--
                    j++
                }
                c == '\'' -> j = findQuoteEnd(j, '\'') + 1
                c == '"' -> j = findQuoteEnd(j, '"') + 1
                c == '-' && j + 1 < n && sql[j + 1] == '-' -> {
                    val nl = sql.indexOf('\n', j)
                    j = if (nl < 0) n else nl + 1
                }
                c == '/' && j + 1 < n && sql[j + 1] == '*' -> {
                    val end = sql.indexOf("*/", j + 2)
                    j = if (end < 0) n else end + 2
                }
                else -> j++
            }
        }
        if (depth != 0) return null
        val end = j - 1
        i = j
        return sql.substring(start, end)
    }

    private fun splitIdentifierList(text: String): List<String> {
        val sub = CteTextScanner(text)
        val out = mutableListOf<String>()
        while (true) {
            sub.skipTrivia()
            val id = sub.readIdentifier() ?: break
            out.add(id)
            sub.skipTrivia()
            if (sub.peek() == ',') {
                sub.i++
                continue
            }
            break
        }
        return out
    }
}
