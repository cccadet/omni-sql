package dev.omnisql.sidecar.scope

import org.apache.calcite.config.Lex
import org.apache.calcite.sql.SqlCall
import org.apache.calcite.sql.SqlIdentifier
import org.apache.calcite.sql.SqlKind
import org.apache.calcite.sql.SqlNode
import org.apache.calcite.sql.SqlOrderBy
import org.apache.calcite.sql.SqlSelect
import org.apache.calcite.sql.parser.SqlParser
import org.apache.calcite.sql.validate.SqlConformanceEnum
import org.apache.calcite.sql.validate.SqlValidatorUtil

/** Uma CTE resolvida: nome + colunas de saída (best-effort, só nomes — sem tipos). */
data class CteInfo(val name: String, val columns: List<String>)

/**
 * Resolve colunas de CTEs (`WITH nome [(col,...)] AS (corpo)`) usando o
 * parser sintático do Apache Calcite — sem schema/catálogo. Um
 * `CalciteSchemaAdapter` completo (tipos reais, validação contra o catálogo
 * introspectado) fica fora de escopo aqui: o objetivo é só inferir os NOMES
 * das colunas de saída de cada CTE para alimentar o autocomplete tier1 (que
 * já resolve colunas de tabelas/views reais via `MetadataSource`, mas não
 * sabia nada sobre CTEs — ver `packages/autocomplete-engine/src/engine.ts`).
 *
 * Cada corpo de CTE (`AS ( ... )`) é isolado via [CteTextScanner] (varredura
 * textual balanceada) e parseado isoladamente pelo Calcite. Evita o parse
 * tolerante do statement inteiro (o "spike tolerant-vs-fragment" do
 * PROJECT_PLAN) porque não é necessário para este caso: o corpo do CTE já
 * está sintaticamente completo quando o autocomplete dispara — é a query
 * externa (ainda sendo digitada) que costuma estar inválida, e essa fica de
 * fora do parse.
 *
 * Best-effort: qualquer CTE cujo corpo não parseie (sintaxe de dialeto não
 * coberta pela config do parser, `SELECT *`, corpo genuinamente incompleto)
 * fica de fora do resultado — esta função nunca lança.
 */
object ScopeResolver {
    private val WITH_KEYWORD = Regex("\\bwith\\b", RegexOption.IGNORE_CASE)
    private val SET_OP_KINDS = setOf(SqlKind.UNION, SqlKind.INTERSECT, SqlKind.EXCEPT)

    // Lex.JAVA preserva a grafia exata dos identificadores não quotados (sem
    // fold para maiúsc/minúsc) — não fazemos resolução de nomes contra um
    // catálogo aqui, só queremos repassar ao editor o texto que o usuário
    // digitou. LENIENT maximiza aceitação de sintaxe entre dialetos, já que
    // não sabemos de antemão se o SQL é Oracle/Postgres/MySQL/etc.
    private val PARSER_CONFIG: SqlParser.Config =
        SqlParser.config().withLex(Lex.JAVA).withConformance(SqlConformanceEnum.LENIENT)

    fun resolveCtes(sql: String): List<CteInfo> {
        if (!WITH_KEYWORD.containsMatchIn(sql)) return emptyList()
        return try {
            CteTextScanner(sql).scan().mapNotNull(::resolveBlock)
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun resolveBlock(block: CteBlock): CteInfo? {
        if (block.explicitColumns != null && block.explicitColumns.isNotEmpty()) {
            return CteInfo(block.name, block.explicitColumns)
        }
        val columns =
            try {
                columnsOfBody(block.body)
            } catch (e: Exception) {
                null
            }
        return columns?.let { CteInfo(block.name, it) }
    }

    @Suppress("DEPRECATION") // única overload disponível sem um SqlValidator real (fora de escopo aqui)
    private fun columnsOfBody(body: String): List<String>? {
        val parsed = SqlParser.create(body, PARSER_CONFIG).parseQuery()
        val select = leftmostSelect(parsed) ?: return null
        val items = select.selectList ?: return null
        val cols = ArrayList<String>(items.size)
        for (i in 0 until items.size) {
            val item = items[i]
            // Expandir `*`/`alias.*` exige schema real (fora de escopo) —
            // preferimos não sugerir nada a sugerir um "*" literal como
            // nome de coluna.
            if (isStarItem(item)) return null
            val alias = SqlValidatorUtil.getAlias(item, i) ?: return null
            cols.add(alias)
        }
        return cols
    }

    private fun leftmostSelect(nodeIn: SqlNode): SqlSelect? {
        val node = if (nodeIn is SqlOrderBy) nodeIn.query else nodeIn
        return when {
            node is SqlSelect -> node
            node is SqlCall && node.kind in SET_OP_KINDS -> leftmostSelect(node.operandList[0])
            else -> null
        }
    }

    private fun isStarItem(item: SqlNode): Boolean = item is SqlIdentifier && item.isStar
}
