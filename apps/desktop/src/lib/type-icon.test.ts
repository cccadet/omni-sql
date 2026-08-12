import { expect, it } from "vitest";
import {
  ArrowSortRegular,
  BoxRegular,
  CodeRegular,
  DataBarVerticalRegular,
  DatabaseRegular,
  EyeRegular,
  FingerprintRegular,
  FlashRegular,
  LinkRegular,
  ListRegular,
  NumberSymbolRegular,
  PlayCircleRegular,
  QuestionRegular,
  TableRegular,
  TextCaseTitleRegular,
  ToggleLeftRegular,
  ClockRegular,
} from "@fluentui/react-icons";
import { objectKindIcon, typeIcon } from "./type-icon";

it("maps SQL data type families to stable icons", () => {
  expect(typeIcon("bigint")).toBe(NumberSymbolRegular);
  expect(typeIcon("numeric")).toBe(DataBarVerticalRegular);
  expect(typeIcon("boolean")).toBe(ToggleLeftRegular);
  expect(typeIcon("timestamp with time zone")).toBe(ClockRegular);
  expect(typeIcon("varchar")).toBe(TextCaseTitleRegular);
  expect(typeIcon("uuid")).toBe(FingerprintRegular);
  expect(typeIcon("jsonb")).toBe(CodeRegular);
  expect(typeIcon("bytea")).toBe(NumberSymbolRegular);
  expect(typeIcon("geography")).toBe(QuestionRegular);
});

it("maps every explorer object kind to its semantic icon", () => {
  expect(objectKindIcon("schema")).toBe(DatabaseRegular);
  expect(objectKindIcon("table")).toBe(TableRegular);
  expect(objectKindIcon("view")).toBe(EyeRegular);
  expect(objectKindIcon("function")).toBe(NumberSymbolRegular);
  expect(objectKindIcon("procedure")).toBe(PlayCircleRegular);
  expect(objectKindIcon("trigger")).toBe(FlashRegular);
  expect(objectKindIcon("sequence")).toBe(ArrowSortRegular);
  expect(objectKindIcon("package")).toBe(BoxRegular);
  expect(objectKindIcon("synonym")).toBe(LinkRegular);
  expect(objectKindIcon("index")).toBe(ListRegular);
  expect(objectKindIcon("column")).toBe(NumberSymbolRegular);
});
