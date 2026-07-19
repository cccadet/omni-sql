import { test, assert } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import type { ConnectionEntry } from "../lib/backend";

test("StatusBar: shows connection and result info", () => {
  const connection: ConnectionEntry = {
    id: "c1",
    label: "Local Postgres",
    dialect: "postgres",
    endpoint: "localhost",
    user: "postgres",
  };

  render(
    <StatusBar
      connection={connection}
      result={{
        columns: [{ name: "id", dataType: "int", nullable: false }],
        rows: [[1], [2]],
        rowsMoreAvailable: false,
        elapsedMs: 12,
      }}
      cursorPosition={{ line: 3, column: 10 }}
    />,
  );

  assert.ok(screen.getByText("Local Postgres"));
  assert.ok(screen.getByText("PostgreSQL"));
  assert.ok(screen.getByText(/2 linha\(s\)/));
  assert.ok(screen.getByText(/1 coluna\(s\)/));
  assert.ok(screen.getByText(/12ms/));
  assert.ok(screen.getByText("Ln 3, Col 10"));
});

test("StatusBar: shows no connection when empty", () => {
  render(<StatusBar />);
  assert.ok(screen.getByText("Sem conexão"));
});

test("StatusBar: makes offline database health explicit", () => {
  render(<StatusBar connection={{ id: "c1", label: "Warehouse", dialect: "postgres", endpoint: "db", user: "u" }} health="offline" />);
  assert.ok(screen.getByText("Offline"));
});

test("StatusBar: makes online database health explicit", () => {
  render(<StatusBar connection={{ id: "c1", label: "Warehouse", dialect: "postgres", endpoint: "db", user: "u" }} health="online" />);
  assert.ok(screen.getByText("Online"));
});
