package dev.omnisql.sidecar.editability

import org.apache.calcite.config.Lex
import org.apache.calcite.sql.SqlBasicCall
import org.apache.calcite.sql.SqlCall
import org.apache.calcite.sql.SqlIdentifier
import org.apache.calcite.sql.SqlJoin
import org.apache.calcite.sql.SqlKind
import org.apache.calcite.sql.SqlNode
import org.apache.calcite.sql.SqlOrderBy
import org.apache.calcite.sql.SqlSelect
import org.apache.calcite.sql.parser.SqlParser
import org.apache.calcite.sql.validate.SqlConformanceEnum

/** Tabela de origem de um SELECT elegível para edição de célula. */
data class EditableTable(val schema: String?, val name: String)

/** Uma coluna projetada: nome real da coluna de origem, ou `null` se for uma expressão. */
data class EditableColumn(val sourceColumn: String?)

/** Resultado da análise de "editabilidade" de uma query. */
data class QueryEditability(
    val editable: Boolean,
    val reason: String?,
    val table: EditableTable?,
    val selectStar: Boolean,
    val columns: List<EditableColumn>,
)

/**
 * Decide se uma query é um "SELECT simples de uma tabela só" — condição
 * mínima para a grade de resultados gerar `UPDATE`s célula a célula com
 * segurança, sem ambiguidade sobre a que tabela/linha uma célula pertence.
 *
 * Usa o parser sintático do Apache Calcite (mesma config de
 * `dev.omnisql.sidecar.scope.ScopeResolver`): não valida contra
 * schema/catálogo, só a forma sintática da query. Isso é suficiente aqui —
 * não precisamos saber tipos/PKs (isso já vem do `metadata-cache` do
 * backend Node), só se a FROM resolve para exatamente uma tabela real e,
 * para cada coluna projetada, qual coluna real da tabela ela é (ou se é
 * uma expressão, que não pode ser editada de volta).
 *
 * Bloqueios: JOIN (inclusive `FROM a, b` estilo antigo), subconsulta na
 * FROM, UNION/INTERSECT/EXCEPT, DISTINCT, GROUP BY/HAVING, window
 * functions (`OVER`), e `SELECT *` misturado com outras colunas (sem
 * catálogo não dá pra saber quantas colunas o `*` expande).
 *
 * Best-effort: SQL que não parseia (ou qualquer outra falha) retorna
 * `editable=false` — nunca lança.
 */
object QueryEditabilityAnalyzer {
    private val PARSER_CONFIG: SqlParser.Config =
        SqlParser.config().withLex(Lex.JAVA).withConformance(SqlConformanceEnum.LENIENT)
    private val SET_OP_KINDS = setOf(SqlKind.UNION, SqlKind.INTERSECT, SqlKind.EXCEPT)

    fun analyze(sql: String): QueryEditability {
        return try {
            val parsed = SqlParser.create(sql, PARSER_CONFIG).parseStmt()
            analyzeNode(if (parsed is SqlOrderBy) parsed.query else parsed)
        } catch (e: Exception) {
            notEditable("Não foi possível analisar a consulta.")
        }
    }

    private fun analyzeNode(node: SqlNode): QueryEditability {
        if (node is SqlCall && node.kind in SET_OP_KINDS) {
            return notEditable("Consultas com UNION/INTERSECT/EXCEPT não podem ser editadas.")
        }
        if (node !is SqlSelect) {
            return notEditable("A consulta não é um SELECT simples.")
        }
        if (node.isDistinct) {
            return notEditable("SELECT DISTINCT não pode ser editado.")
        }
        if (node.group != null || node.having != null) {
            return notEditable("Consultas com GROUP BY/HAVING não podem ser editadas.")
        }
        if (!node.windowList.isEmpty()) {
            return notEditable("Funções de janela (OVER) não são suportadas para edição.")
        }

        val from = node.from ?: return notEditable("A consulta não referencia nenhuma tabela.")
        val table = tableOf(from) ?: return notEditable(fromRejectionReason(from))

        val items = node.selectList ?: return notEditable("A consulta não projeta nenhuma coluna.")
        val starCount = items.count { it is SqlIdentifier && it.isStar }
        if (starCount > 0 && starCount != items.size) {
            return notEditable("SELECT * combinado com outras colunas não pode ser mapeado com segurança.")
        }
        if (starCount == items.size) {
            return QueryEditability(true, null, table, selectStar = true, columns = emptyList())
        }

        val columns = items.map { EditableColumn(sourceColumnOf(it)) }
        return QueryEditability(true, null, table, selectStar = false, columns = columns)
    }

    private fun tableOf(fromIn: SqlNode): EditableTable? {
        val from = unwrapAlias(fromIn)
        if (from !is SqlIdentifier || from.isStar) return null
        return if (from.names.size == 1) {
            EditableTable(null, from.names[0])
        } else {
            EditableTable(from.names[from.names.size - 2], from.names.last())
        }
    }

    private fun fromRejectionReason(from: SqlNode): String =
        when (unwrapAlias(from)) {
            is SqlJoin -> "Consultas com JOIN não podem ser editadas."
            is SqlSelect -> "Subconsultas na cláusula FROM não podem ser editadas."
            else -> "Não foi possível identificar uma única tabela de origem."
        }

    private fun unwrapAlias(node: SqlNode): SqlNode =
        if (node is SqlBasicCall && node.kind == SqlKind.AS) node.operandList[0] else node

    private fun sourceColumnOf(itemIn: SqlNode): String? {
        val item = if (itemIn is SqlBasicCall && itemIn.kind == SqlKind.AS) itemIn.operandList[0] else itemIn
        if (item !is SqlIdentifier || item.isStar) return null
        return item.names.last()
    }

    private fun notEditable(reason: String) =
        QueryEditability(false, reason, null, selectStar = false, columns = emptyList())
}
