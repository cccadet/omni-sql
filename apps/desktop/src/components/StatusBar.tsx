import { Text, tokens } from "@fluentui/react-components";

export interface StatusBarProps {
  connectionLabel?: string;
  message?: string;
}

export function StatusBar({ connectionLabel, message }: StatusBarProps) {
  return (
    <footer
      style={{
        display: "flex",
        gap: 16,
        padding: "4px 12px",
        background: tokens.colorNeutralBackground3,
        borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
        fontSize: 12,
      }}
    >
      <Text size={200}>{connectionLabel ?? "Sem conexão"}</Text>
      <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
        {message ?? "Pronto"}
      </Text>
    </footer>
  );
}
