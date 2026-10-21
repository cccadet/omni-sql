import { getCurrentWindow } from "@tauri-apps/api/window";
import { DismissRegular, MaximizeRegular, SubtractRegular } from "@fluentui/react-icons";
import { useLanguage } from "../i18n";

/**
 * On Windows the shell hides the native title bar and menu (see `lib.rs` setup), so the
 * app header carries the window buttons. Elsewhere the native chrome stays and this renders nothing.
 */
export function usesCustomTitleBar(): boolean {
  return "__TAURI_INTERNALS__" in window && /Windows/u.test(navigator.userAgent);
}

export function WindowControls() {
  const { t } = useLanguage();
  if (!usesCustomTitleBar()) return null;
  const appWindow = getCurrentWindow();
  return (
    <div className="omni-window-controls">
      <button type="button" aria-label={t("minimizeWindow")} title={t("minimizeWindow")} onClick={() => void appWindow.minimize()}><SubtractRegular fontSize={16} /></button>
      <button type="button" aria-label={t("maximizeWindow")} title={t("maximizeWindow")} onClick={() => void appWindow.toggleMaximize()}><MaximizeRegular fontSize={14} /></button>
      <button type="button" className="is-close" aria-label={t("closeWindow")} title={t("closeWindow")} onClick={() => void appWindow.close()}><DismissRegular fontSize={16} /></button>
    </div>
  );
}
