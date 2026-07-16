import { Card, Text, tokens } from "@fluentui/react-components";

export interface EditorProps {
  value?: string;
  onChange?: (value: string) => void;
}

export function Editor({ value, onChange }: EditorProps) {
  return (
    <Card
      style={{
        height: "100%",
        borderRadius: 0,
        background: tokens.colorNeutralBackground1,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Text weight="semibold">Editor</Text>
      <textarea
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        style={{
          flex: 1,
          marginTop: 8,
          resize: "none",
          background: tokens.colorNeutralBackground1,
          color: tokens.colorNeutralForeground1,
          border: `1px solid ${tokens.colorNeutralStroke1}`,
          fontFamily: "ui-monospace, monospace",
          fontSize: 14,
        }}
      />
    </Card>
  );
}
