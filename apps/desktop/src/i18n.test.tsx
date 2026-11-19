import { fireEvent, render, screen } from "@testing-library/react";
import { dictionaries, LanguageProvider, useLanguage, type Language } from "./i18n";

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
      <span data-testid="last-label">{t("resizeConnectionsPanel")}</span>
      <span data-testid="bucket-label">{t("s3LoadBuckets")}</span>
      <span data-testid="catalog-label">{t("ducklakeAddCatalog")}</span>
      <button onClick={() => setLanguage("pt-BR")}>pt</button>
      <button onClick={() => setLanguage("zh-CN")}>zh</button>
    </div>
  );
}

describe("language provider", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to English", () => {
    render(<LanguageProvider><LanguageProbe /></LanguageProvider>);
    expect(screen.getByTestId("language").textContent).toBe("en");
    expect(screen.getByTestId("label").textContent).toBe("New tab");
    expect(screen.getByTestId("bucket-label").textContent).toBe("Load buckets");
  });

  it("switches language and persists it", () => {
    render(<LanguageProvider><LanguageProbe /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "pt" }));
    expect(screen.getByTestId("language").textContent).toBe("pt-BR");
    expect(screen.getByTestId("label").textContent).toBe("Nova aba");
    expect(screen.getByTestId("last-label").textContent).toBe("Redimensionar painel de conexões");
    expect(screen.getByTestId("bucket-label").textContent).toBe("Carregar buckets");
    expect(screen.getByTestId("catalog-label").textContent).toBe("Adicionar catálogo DuckLake");
    expect(localStorage.getItem("omni-sql:language")).toBe("pt-BR");
  });

  it.each<Language>(["pt-BR", "zh-CN"])("loads persisted language %s", (language) => {
    localStorage.setItem("omni-sql:language", language);
    render(<LanguageProvider><LanguageProbe /></LanguageProvider>);
    expect(screen.getByTestId("language").textContent).toBe(language);
    expect(screen.getByTestId("label").textContent).toBe(dictionaries[language].newTab);
  });

  it("switches to Simplified Chinese and persists it", () => {
    render(<LanguageProvider><LanguageProbe /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "zh" }));
    expect(screen.getByTestId("language").textContent).toBe("zh-CN");
    expect(screen.getByTestId("label").textContent).toBe("新建标签页");
    expect(screen.getByTestId("bucket-label").textContent).toBe("加载存储桶");
    expect(screen.getByTestId("catalog-label").textContent).toBe("添加 DuckLake 目录");
    expect(localStorage.getItem("omni-sql:language")).toBe("zh-CN");
  });

  describe("first-run language", () => {
    afterEach(() => vi.restoreAllMocks());

    function mockSystemLanguages(languages: string[]) {
      vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
      vi.spyOn(navigator, "language", "get").mockReturnValue(languages[0] ?? "");
    }

    it("uses the installer language over the system language", () => {
      mockSystemLanguages(["pt-BR"]);
      render(<LanguageProvider installerLanguage="zh-CN"><LanguageProbe /></LanguageProvider>);
      expect(screen.getByTestId("language").textContent).toBe("zh-CN");
    });

    it("keeps the language saved in the app over the installer language", () => {
      localStorage.setItem("omni-sql:language", "en");
      render(<LanguageProvider installerLanguage="pt-BR"><LanguageProbe /></LanguageProvider>);
      expect(screen.getByTestId("language").textContent).toBe("en");
    });

    it.each([
      [["pt-PT"], "pt-BR"],
      [["zh-TW", "en-US"], "zh-CN"],
      [["de-DE", "pt-BR"], "pt-BR"],
      [["de-DE"], "en"],
    ])("follows the system languages %j without a saved or installer language", (languages, expected) => {
      mockSystemLanguages(languages);
      render(<LanguageProvider><LanguageProbe /></LanguageProvider>);
      expect(screen.getByTestId("language").textContent).toBe(expected);
    });
  });

  it("falls back to English for an unsupported saved language", () => {
    localStorage.setItem("omni-sql:language", "unknown");
    render(<LanguageProvider><LanguageProbe /></LanguageProvider>);
    expect(screen.getByTestId("label").textContent).toBe("New tab");
  });

  it.each<Language>(["pt-BR", "zh-CN"])("provides complete translations and interpolation parameters for %s", (language) => {
    const dictionary = dictionaries[language];
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(dictionaries.en).sort());
    for (const [key, source] of Object.entries(dictionaries.en)) {
      const translated = dictionary[key as keyof typeof dictionary];
      expect(translated, key).toBeTruthy();
      expect(translated.match(/\{\w+\}/g)?.sort() ?? [], key)
        .toEqual(source.match(/\{\w+\}/g)?.sort() ?? []);
    }
  });
});
