import { render } from "@testing-library/react";
import { FluentProvider, createCSSRuleFromTheme, webDarkTheme } from "@fluentui/react-components";

function MinimalThemedApp() {
  return (
    <FluentProvider theme={webDarkTheme}>
      <div>hello</div>
      <style>{createCSSRuleFromTheme("body", webDarkTheme)}</style>
    </FluentProvider>
  );
}

describe("tema escuro", () => {
  it("applies theme variables to body so the whole UI is themed", () => {
    render(<MinimalThemedApp />);
    const styles = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");
    expect(styles).toContain("body");
    expect(styles).toContain("colorNeutralBackground1");
  });
});
