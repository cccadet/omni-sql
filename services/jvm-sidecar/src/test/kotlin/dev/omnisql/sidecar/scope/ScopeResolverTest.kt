package dev.omnisql.sidecar.scope

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ScopeResolverTest {
    @Test
    fun `resolves columns for the reported bug's CTE while the outer SELECT is still invalid`() {
        val sql =
            """
            with b1 as (
            SELECT g.idguia,
                   g.DTSOLICITACAO,
                   SUM(CASE
                       WHEN gi.CDGUIAITEMSTATUS in ('APRO','EXEC') THEN gi.NRQTDITEMAUTORIZADO
                       WHEN gi.CDGUIAITEMSTATUS = 'PAUD' THEN gi.NRQTDITEMSOLICITADO
                       ELSE 0
                       END)
                       AS QTD_SESSOES_TERAPIA_20D
            FROM AUTORIZADOR.GUIAITEM gi
                     JOIN AUTORIZADOR.GUIA g ON gi.IDGUIA = g.IDGUIA
                     JOIN AUTORIZADOR.BENEFICIARIO b ON g.IDBENEFICIARIO = b.IDBENEFICIARIO
                     JOIN AUTORIZADOR.PESSOA
                r ON b.IDPESSOA = r.IDPESSOA
            WHERE gi.BLEXCLUSAO = 'N'
              and g.CDGUIASTATUS in ('APRO','EXEC','PAUD')
              AND gi.CDPROCEDIMENTOINSUMO IN
                  ('50000470', '50005286',
                   '50000616', '50005308',
                   '50000080', '50005340')
              AND g.DTSOLICITACAO >= sysdate - 20
              AND g.DTSOLICITACAO <= sysdate
            group by g.idguia,g.DTSOLICITACAO
            order by g.idguia
            )
            select  from b1
            """.trimIndent()

        val ctes = ScopeResolver.resolveCtes(sql)

        assertEquals(1, ctes.size)
        assertEquals("b1", ctes[0].name)
        assertEquals(listOf("idguia", "DTSOLICITACAO", "QTD_SESSOES_TERAPIA_20D"), ctes[0].columns)
    }

    @Test
    fun `honors an explicit CTE column list over inferred aliases`() {
        val sql = "with b1 (a, b) as (select x, y from t) select from b1"
        val ctes = ScopeResolver.resolveCtes(sql)
        assertEquals(listOf("a", "b"), ctes.single().columns)
    }

    @Test
    fun `resolves multiple comma-separated CTEs`() {
        val sql =
            "with a as (select 1 as num), b as (select 2 as two, 3 as three) select from a join b on true"
        val ctes = ScopeResolver.resolveCtes(sql)
        assertEquals(2, ctes.size)
        assertEquals(listOf("num"), ctes[0].columns)
        assertEquals(listOf("two", "three"), ctes[1].columns)
    }

    @Test
    fun `takes column names from the first branch of a UNION`() {
        val sql = "with u as (select id, name from t1 union select id, name from t2) select from u"
        val ctes = ScopeResolver.resolveCtes(sql)
        assertEquals(listOf("id", "name"), ctes.single().columns)
    }

    @Test
    fun `gives up on select star instead of returning a literal asterisk`() {
        val sql = "with s as (select * from t) select from s"
        val ctes = ScopeResolver.resolveCtes(sql)
        assertTrue(ctes.isEmpty())
    }

    @Test
    fun `returns empty for SQL without a WITH clause`() {
        assertTrue(ScopeResolver.resolveCtes("select * from t").isEmpty())
    }

    @Test
    fun `never throws on garbage input`() {
        assertTrue(ScopeResolver.resolveCtes("with (((").isEmpty())
        assertTrue(ScopeResolver.resolveCtes("with").isEmpty())
        assertTrue(ScopeResolver.resolveCtes("").isEmpty())
    }
}
