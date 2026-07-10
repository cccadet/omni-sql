package dev.omnisql.sidecar.editability

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class QueryEditabilityAnalyzerTest {
    @Test
    fun `select star from a single table is editable`() {
        val r = QueryEditabilityAnalyzer.analyze("select * from users")
        assertTrue(r.editable)
        assertTrue(r.selectStar)
        assertEquals(EditableTable(null, "users"), r.table)
        assertTrue(r.columns.isEmpty())
    }

    @Test
    fun `schema-qualified table is split into schema and name`() {
        val r = QueryEditabilityAnalyzer.analyze("select * from public.users")
        assertEquals(EditableTable("public", "users"), r.table)
    }

    @Test
    fun `aliased table is still resolved`() {
        val r = QueryEditabilityAnalyzer.analyze("select * from users u")
        assertTrue(r.editable)
        assertEquals(EditableTable(null, "users"), r.table)
    }

    @Test
    fun `explicit columns map back to their real names, aliases included`() {
        val r = QueryEditabilityAnalyzer.analyze("select id, name as full_name from users")
        assertTrue(r.editable)
        assertFalse(r.selectStar)
        assertEquals(listOf(EditableColumn("id"), EditableColumn("name")), r.columns)
    }

    @Test
    fun `expression columns are marked non-editable but the rest stay editable`() {
        val r = QueryEditabilityAnalyzer.analyze("select id, price * 2 as double_price from products")
        assertTrue(r.editable)
        assertEquals(listOf(EditableColumn("id"), EditableColumn(null)), r.columns)
    }

    @Test
    fun `join is rejected`() {
        val r = QueryEditabilityAnalyzer.analyze("select * from a join b on a.id = b.a_id")
        assertFalse(r.editable)
        assertTrue(r.reason!!.contains("JOIN"))
    }

    @Test
    fun `old-style comma join is rejected`() {
        val r = QueryEditabilityAnalyzer.analyze("select * from a, b where a.id = b.a_id")
        assertFalse(r.editable)
    }

    @Test
    fun `subquery in from is rejected`() {
        val r = QueryEditabilityAnalyzer.analyze("select * from (select * from users) t")
        assertFalse(r.editable)
    }

    @Test
    fun `union is rejected`() {
        val r = QueryEditabilityAnalyzer.analyze("select id from a union select id from b")
        assertFalse(r.editable)
    }

    @Test
    fun `distinct is rejected`() {
        val r = QueryEditabilityAnalyzer.analyze("select distinct name from users")
        assertFalse(r.editable)
    }

    @Test
    fun `group by is rejected`() {
        val r = QueryEditabilityAnalyzer.analyze("select department, count(*) from users group by department")
        assertFalse(r.editable)
    }

    @Test
    fun `select star mixed with other columns is rejected`() {
        val r = QueryEditabilityAnalyzer.analyze("select *, 1 as extra from users")
        assertFalse(r.editable)
    }

    @Test
    fun `non-select statements are rejected`() {
        assertFalse(QueryEditabilityAnalyzer.analyze("update users set name = 'x'").editable)
    }

    @Test
    fun `never throws on garbage input`() {
        assertFalse(QueryEditabilityAnalyzer.analyze("select * from (((").editable)
        assertFalse(QueryEditabilityAnalyzer.analyze("").editable)
        assertFalse(QueryEditabilityAnalyzer.analyze("not sql at all").editable)
    }
}
