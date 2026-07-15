import Hash from "@lucide/svelte/icons/hash";
import CaseSensitive from "@lucide/svelte/icons/case-sensitive";
import Calendar from "@lucide/svelte/icons/calendar";
import ToggleLeft from "@lucide/svelte/icons/toggle-left";
import Braces from "@lucide/svelte/icons/braces";
import Fingerprint from "@lucide/svelte/icons/fingerprint";
import Binary from "@lucide/svelte/icons/binary";
import CircleHelp from "@lucide/svelte/icons/circle-help";

export type SvelteComponent = typeof Hash;

export function typeIcon(dataType: string): SvelteComponent {
  const t = dataType.toLowerCase();
  if (/^oid:|unknown/.test(t)) return CircleHelp;
  if (/uuid/.test(t)) return Fingerprint;
  if (/bool/.test(t)) return ToggleLeft;
  if (/json/.test(t)) return Braces;
  if (/bytea|blob|raw|binary/.test(t)) return Binary;
  if (/timestamp|^date|^time/.test(t)) return Calendar;
  if (/int|number|numeric|real|double|float|decimal/.test(t)) return Hash;
  return CaseSensitive;
}
