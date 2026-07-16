import { Card, Text, tokens } from "@fluentui/react-components";

export interface SidebarProps {
  open?: boolean;
}

export function Sidebar({ open = true }: SidebarProps) {
  if (!open) return null;
  return (
    <Card
      style={{
        width: 260,
        height: "100%",
        borderRadius: 0,
        background: tokens.colorNeutralBackground2,
      }}
    >
      <Text weight="semibold">Sidebar</Text>
      <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
        Árvore de schemas/tabelas/colunas virá aqui.
      </Text>
    </Card>
  );
}
