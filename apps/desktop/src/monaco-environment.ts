import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

loader.config({ monaco });

self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};
