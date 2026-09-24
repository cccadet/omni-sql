import { autocompleteTier1, type MetadataSource, type Suggestion } from "@omni-sql/autocomplete-engine";
import { duckdbDescriptor } from "@omni-sql/dialect-descriptors";
import type { Relation } from "@omni-sql/ts-types";
import type { RelationInfo } from "./backend";

export function s3ReferencedRelations(sql: string, relations: readonly RelationInfo[]): RelationInfo[] {
  const lowerSql = sql.toLocaleLowerCase();
  return relations.filter((relation) => {
    const qualified = `"${relation.schema.replaceAll('"', '""')}"."${relation.name.replaceAll('"', '""')}"`.toLocaleLowerCase();
    return lowerSql.includes(qualified);
  });
}

export function s3Suggestions(sql: string, cursor: number, relations: readonly RelationInfo[]): Suggestion[] {
  const objects: Relation[] = relations.map((relation) => ({
    schema: relation.schema,
    name: relation.name,
    kind: relation.kind,
    constraints: [],
    columns: (relation.columns ?? []).map((column, ordinalPosition) => ({
      name: column.name,
      dataType: column.dataType,
      nullable: column.nullable,
      isPrimaryKey: false,
      ordinalPosition,
    })),
  }));
  const metadata: MetadataSource = {
    dialect: duckdbDescriptor,
    listSchemas: () => [...new Set(objects.map((relation) => relation.schema))],
    listRelations: () => objects,
    listFunctions: () => [],
    resolveRelation: (ref) => objects.find((relation) => relation.name.toLocaleLowerCase() === ref.table.toLocaleLowerCase()
      && (!ref.schema || relation.schema.toLocaleLowerCase() === ref.schema.toLocaleLowerCase())) ?? null,
  };
  return autocompleteTier1(sql, cursor, metadata);
}
