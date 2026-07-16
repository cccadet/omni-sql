import { Card, Text, tokens } from "@fluentui/react-components";

export interface ResultsGridProps {
  rowCount?: number;
}

export function ResultsGrid({ rowCount = 0 }: ResultsGridProps) {
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
      <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
        {rowCount === 0 ? "Nenhum resultado ainda." : `${rowCount} linha(s).`}
      </Text>
    </Card>
  );
}
