import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Menu,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
} from "@fluentui/react-components";
import { AddRegular, ArrowDownRegular, ArrowUpRegular, DeleteRegular } from "@fluentui/react-icons";
import type { ConnectionEntry } from "../lib/backend";
import {
  DEFAULT_ENVIRONMENTS,
  ENVIRONMENT_COLORS,
  isBuiltInEnvironmentId,
  newEnvironmentId,
  saveEnvironments,
  useEnvironments,
  type BuiltInEnvironmentId,
  type EnvironmentColor,
  type EnvironmentDefinition,
} from "../lib/environments";
import { useLanguage, type TranslationKey } from "../i18n";

type Translate = (key: TranslationKey) => string;

const BUILT_IN_LABEL_KEYS: Record<BuiltInEnvironmentId, TranslationKey> = {
  development: "environmentDevelopment",
  staging: "environmentStaging",
  production: "environmentProduction",
};

const COLOR_LABEL_KEYS: Record<EnvironmentColor, TranslationKey> = {
  green: "colorGreen",
  yellow: "colorYellow",
  orange: "colorOrange",
  red: "colorRed",
  berry: "colorPink",
  purple: "colorPurple",
  blue: "colorBlue",
  teal: "colorTeal",
  gray: "colorGray",
};

function defaultName(id: string, t: Translate): string {
  return isBuiltInEnvironmentId(id) ? t(BUILT_IN_LABEL_KEYS[id]) : "";
}

export function environmentName(environment: EnvironmentDefinition, t: Translate): string {
  return environment.name ?? defaultName(environment.id, t);
}

/** The connection's environment, or null when unset or no longer defined. */
export function findConnectionEnvironment(connection: ConnectionEntry, environments: readonly EnvironmentDefinition[]): EnvironmentDefinition | null {
  const id = connection.options?.environment;
  return typeof id === "string" ? environments.find((environment) => environment.id === id) ?? null : null;
}

export function EnvironmentDot({ color }: { color: EnvironmentColor }) {
  return <span aria-hidden className="omni-environment-dot" data-env-color={color} />;
}

export function EnvironmentBadge({ connection }: { connection: ConnectionEntry }) {
  const { t } = useLanguage();
  const environment = findConnectionEnvironment(connection, useEnvironments());
  return environment ? <span className="omni-environment-badge" data-env-color={environment.color}>{environmentName(environment, t)}</span> : null;
}

interface Draft {
  id: string;
  name: string;
  color: EnvironmentColor;
}

function toDrafts(environments: readonly EnvironmentDefinition[], t: Translate): Draft[] {
  return environments.map((environment) => ({ id: environment.id, name: environmentName(environment, t), color: environment.color }));
}

export interface EnvironmentsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Used to warn how many connections lose their environment when one is removed. */
  connections?: readonly ConnectionEntry[];
}

export function EnvironmentsDialog({ open, onClose, connections = [] }: EnvironmentsDialogProps) {
  const { t } = useLanguage();
  const environments = useEnvironments();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDrafts(toDrafts(environments, t));
    setError(null);
    // Reset only when the dialog opens; live edits must not be overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const usage = (id: string) => connections.filter((connection) => connection.options?.environment === id).length;
  const update = (index: number, patch: Partial<Draft>) => setDrafts((current) => current.map((draft, at) => at === index ? { ...draft, ...patch } : draft));
  const move = (index: number, step: -1 | 1) => setDrafts((current) => {
    const target = index + step;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  });
  const remove = (index: number) => {
    const draft = drafts[index];
    if (!draft) return;
    const count = usage(draft.id);
    const name = draft.name.trim() || defaultName(draft.id, t);
    if (count > 0 && !window.confirm(t("removeEnvironmentConfirm").replace("{name}", name).replace("{count}", String(count)))) return;
    setDrafts((current) => current.filter((_, at) => at !== index));
  };
  const add = () => {
    const used = new Set(drafts.map((draft) => draft.color));
    const color = ENVIRONMENT_COLORS.find((candidate) => !used.has(candidate)) ?? "gray";
    setDrafts((current) => [...current, { id: newEnvironmentId(), name: "", color }]);
  };
  const save = () => {
    if (drafts.some((draft) => !draft.name.trim() && !isBuiltInEnvironmentId(draft.id))) {
      setError(t("environmentNameRequired"));
      return;
    }
    saveEnvironments(drafts.map(({ id, name, color }) => {
      const trimmed = name.trim();
      // A built-in left with its translated name keeps following the UI language.
      return !trimmed || trimmed === defaultName(id, t) ? { id, color } : { id, name: trimmed, color };
    }));
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface className="omni-standard-dialog omni-environments-dialog">
        <DialogBody className="omni-dialog-body">
          <DialogTitle>{t("manageEnvironments")}</DialogTitle>
          <DialogContent className="omni-environments-content">
            <Text size={200}>{t("environmentsHint")}</Text>
            {error && <div className="omni-mcp-error" role="alert">{error}</div>}
            <ul className="omni-environments-list" aria-label={t("manageEnvironments")}>
              {drafts.map((draft, index) => {
                const name = draft.name.trim() || defaultName(draft.id, t) || t("newEnvironment");
                const count = usage(draft.id);
                return (
                  <li key={draft.id} className="omni-environments-row">
                    <Menu checkedValues={{ color: [draft.color] }} onCheckedValueChange={(_, data) => {
                      const color = data.checkedItems[0];
                      if (color && (ENVIRONMENT_COLORS as readonly string[]).includes(color)) update(index, { color: color as EnvironmentColor });
                    }}>
                      <MenuTrigger disableButtonEnhancement>
                        <Button appearance="subtle" size="small" className="omni-environment-color-button" icon={<EnvironmentDot color={draft.color} />} aria-label={t("environmentColorFor").replace("{name}", name)} title={t(COLOR_LABEL_KEYS[draft.color])} />
                      </MenuTrigger>
                      <MenuPopover>
                        <MenuList>
                          {ENVIRONMENT_COLORS.map((color) => (
                            <MenuItemRadio key={color} name="color" value={color} icon={<EnvironmentDot color={color} />}>{t(COLOR_LABEL_KEYS[color])}</MenuItemRadio>
                          ))}
                        </MenuList>
                      </MenuPopover>
                    </Menu>
                    <Input
                      size="small"
                      className="omni-environments-name"
                      value={draft.name}
                      placeholder={defaultName(draft.id, t) || t("environmentName")}
                      aria-label={t("environmentName")}
                      maxLength={60}
                      autoFocus={!draft.name && !isBuiltInEnvironmentId(draft.id)}
                      onChange={(_, data) => { update(index, { name: data.value }); setError(null); }}
                    />
                    {count > 0 && <span className="omni-switcher-count" title={t("environmentConnectionCount").replace("{count}", String(count))}>{count}</span>}
                    <Button appearance="subtle" size="small" icon={<ArrowUpRegular />} disabled={index === 0} aria-label={t("moveEnvironmentUp").replace("{name}", name)} onClick={() => move(index, -1)} />
                    <Button appearance="subtle" size="small" icon={<ArrowDownRegular />} disabled={index === drafts.length - 1} aria-label={t("moveEnvironmentDown").replace("{name}", name)} onClick={() => move(index, 1)} />
                    <Button appearance="subtle" size="small" icon={<DeleteRegular />} aria-label={t("removeEnvironmentNamed").replace("{name}", name)} onClick={() => remove(index)} />
                  </li>
                );
              })}
            </ul>
            <div className="omni-environments-tools">
              <Button size="small" icon={<AddRegular />} onClick={add}>{t("newEnvironment")}</Button>
              <Button size="small" appearance="subtle" onClick={() => { setDrafts(toDrafts(DEFAULT_ENVIRONMENTS, t)); setError(null); }}>{t("restoreDefaultEnvironments")}</Button>
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t("cancel")}</Button>
            <Button appearance="primary" onClick={save}>{t("common.save")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
