/** /mongo is a local conversion command, never a database query. */
export function mongoCommandSql(text: string): string | null {
  const command = /^\s*\/mongo\b\s*/i.exec(text);
  return command ? text.slice(command[0].length) : null;
}
