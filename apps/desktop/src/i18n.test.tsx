import { fireEvent, render, screen } from "@testing-library/react";
import { LanguageProvider, useLanguage } from "./i18n";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    clear: () => storage.clear(),
  },
});

function LanguageProbe() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <div>
      <span data-testid="language">{language}</span>
      <span data-testid="label">{t("newTab")}</span>
      <button onClick={() => setLanguage("pt-BR")}>pt</button>
    </div>
  );
}

describe("language provider", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to English", () => {
    render(<LanguageProvider><LanguageProbe /></LanguageProvider>);
    expect(screen.getByTestId("language").textContent).toBe("en");
    expect(screen.getByTestId("label").textContent).toBe("New tab");
  });

  it("switches language and persists it", () => {
    render(<LanguageProvider><LanguageProbe /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "pt" }));
    expect(screen.getByTestId("language").textContent).toBe("pt-BR");
    expect(screen.getByTestId("label").textContent).toBe("Nova aba");
    expect(localStorage.getItem("omni-sql:language")).toBe("pt-BR");
  });

  it("loads persisted language", () => {
    localStorage.setItem("omni-sql:language", "pt-BR");
    render(<LanguageProvider><LanguageProbe /></LanguageProvider>);
    expect(screen.getByTestId("language").textContent).toBe("pt-BR");
  });
});
