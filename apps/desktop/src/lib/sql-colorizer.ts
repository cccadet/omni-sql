import { useEffect, useState } from "react";

/** Returns Monaco's colorized HTML: one rendered line per input line, each followed by `<br/>`. */
type Colorizer = (sql: string) => Promise<string>;

let colorizer: Colorizer | null = null;

/** Set by the editor's Monaco setup so previews share its tokenizer and theme without importing Monaco. */
export function setSqlColorizer(next: Colorizer | null): void {
  colorizer = next;
}

/** Colorized HTML per line, or null when Monaco is not loaded or colorizing fails. */
export async function colorizeSqlLines(sql: string): Promise<string[] | null> {
  if (!colorizer) return null;
  try {
    const lines = (await colorizer(sql)).split("<br/>");
    if (lines.at(-1) === "") lines.pop();
    return lines;
  } catch {
    return null;
  }
}

/**
 * Colorized lines for `sql`, or null until ready. Monaco escapes the text it renders,
 * so the lines are safe to inject. Callers fall back to plain text when the line count
 * differs from their own split (e.g. a lone `\r`, which Monaco also treats as a break).
 */
export function useColorizedSqlLines(sql: string, expectedLines: number): readonly string[] | null {
  const [state, setState] = useState<{ sql: string; lines: string[] } | null>(null);
  useEffect(() => {
    let live = true;
    void colorizeSqlLines(sql).then((lines) => {
      if (live && lines) setState({ sql, lines });
    });
    return () => { live = false; };
  }, [sql]);
  return state?.sql === sql && state.lines.length === expectedLines ? state.lines : null;
}
