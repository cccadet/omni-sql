import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

loader.config({ monaco });

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};
