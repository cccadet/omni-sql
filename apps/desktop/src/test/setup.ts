import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
  resources: "usable",
});

function defineGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
  });
}

defineGlobal("window", dom.window);
defineGlobal("document", dom.window.document);
defineGlobal("navigator", dom.window.navigator);
defineGlobal("HTMLElement", dom.window.HTMLElement);
defineGlobal("Element", dom.window.Element);
defineGlobal("Node", dom.window.Node);
defineGlobal("Event", dom.window.Event);
defineGlobal("MouseEvent", dom.window.MouseEvent);
defineGlobal("KeyboardEvent", dom.window.KeyboardEvent);
defineGlobal("location", dom.window.location);

export {};
