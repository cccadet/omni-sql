import { Card, Text, tokens } from "@fluentui/react-components";
import type { QueryResult } from "@omni-sql/ts-types";

export interface ResultsGridProps {
  result?: QueryResult | null;
}

export function ResultsGrid({ result }: ResultsGridProps) {
  return (
    <Card
      style={{
        height: "100%",
        borderRadius: 0,
        background: tokens.colorNeutralBackground2,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Text weight="semibold">Resultados</Text>
      {!result ? (
        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
          Nenhum resultado ainda.
        </Text>
      ) : (
        <div style={{ flex: 1, overflow: "auto", marginTop: 8 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: "100%" }}>
            <thead>
              <tr>
                {result.columns.map((col) => (
                  <th
                    key={col.name}
                    style={{
                      padding: "6px 10px",
                      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
                      textAlign: "left",
                      background: tokens.colorNeutralBackground3,
                    }}
                  >
                    {col.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      style={{
                        padding: "4px 10px",
                        borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {String(cell ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
