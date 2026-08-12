import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { TabBar } from "./TabBar";

afterEach(cleanup);

function renderTabBar(overrides: Partial<ComponentProps<typeof TabBar>> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const onAdd = vi.fn();
  const onRename = vi.fn();
  render(
    <LanguageProvider>
      <TabBar
        tabs={[{ id: "first", title: "First query", dirty: true, dialect: "postgres" }, { id: "second", title: "Second query" }]}
        activeTabId="first"
        onSelect={onSelect}
        onClose={onClose}
        onAdd={onAdd}
        onRename={onRename}
        {...overrides}
      />
    </LanguageProvider>,
  );
  return { onSelect, onClose, onAdd, onRename };
}

it("selects, closes, and adds tabs through accessible controls", () => {
  const { onSelect, onClose, onAdd } = renderTabBar();

  fireEvent.click(screen.getByRole("tab", { name: /Second query/ }));
  fireEvent.click(screen.getAllByRole("button", { name: "Close tab" })[0]!);
  fireEvent.click(screen.getByRole("button", { name: "New tab" }));

  expect(onSelect).toHaveBeenCalledWith("second");
  expect(onClose).toHaveBeenCalledWith("first");
  expect(onAdd).toHaveBeenCalledOnce();
});

it("commits non-empty rename on Enter and discards Escape", () => {
  const { onRename } = renderTabBar();

  fireEvent.doubleClick(screen.getByText("First query"));
  const input = screen.getByDisplayValue("First query");
  fireEvent.change(input, { target: { value: " Renamed query " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onRename).toHaveBeenCalledWith("first", "Renamed query");

  fireEvent.doubleClick(screen.getAllByText("Second query").at(-1)!);
  const secondInput = screen.getAllByDisplayValue("Second query").at(-1)!;
  fireEvent.change(secondInput, { target: { value: "Discarded" } });
  fireEvent.keyDown(secondInput, { key: "Escape" });
  expect(onRename).toHaveBeenCalledOnce();

});
