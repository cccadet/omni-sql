import { Button, Text, Title1, tokens } from "@fluentui/react-components";
import { WeatherSunnyRegular, WeatherMoonRegular } from "@fluentui/react-icons";
import { useTheme } from "./theme";

export default function App() {
  const { name, toggle } = useTheme();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
        }}
      >
        <Title1>omni-sql</Title1>
        <Button
          icon={name === "dark" ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
          onClick={toggle}
          appearance="subtle"
        >
          {name === "dark" ? "Tema claro" : "Tema escuro"}
        </Button>
      </header>

      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <Text size={400}>Frontend React + Fluent UI em construção.</Text>
      </main>
    </div>
  );
}
