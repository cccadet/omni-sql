<!-- svelte-ignore state_referenced_locally -->
<script lang="ts">
  import {
    type FormatterSettings,
    DEFAULT_FORMATTER_SETTINGS,
    isValidKeybinding,
    formatKeybindingForDisplay,
    formatSql,
  } from "./format-sql.ts";
  import type { DialectId } from "@omni-sql/ts-types";
  import Settings from "@lucide/svelte/icons/settings";
  import X from "@lucide/svelte/icons/x";

  interface Props {
    open: boolean;
    dialect: DialectId;
    settings: FormatterSettings;
    onClose: () => void;
    onSave: (settings: FormatterSettings) => void;
  }
  let { open, dialect, settings, onClose, onSave }: Props = $props();

  let draft = $state<FormatterSettings>(structuredClone($state.snapshot(settings)));
  let keybindingError = $derived(
    isValidKeybinding(draft.keybinding) ? null : "Atalho inválido. Use pelo menos um modificador (Ctrl, Alt, Shift, Cmd).",
  );

  const PREVIEW_SQL = `SELECT id, name, email FROM users WHERE active = 1 AND created_at >= '2024-01-01' ORDER BY created_at DESC LIMIT 100;`;

  let preview = $derived.by(() => {
    try {
      return formatSql(PREVIEW_SQL, dialect, draft);
    } catch (e) {
      return `Erro no preview: ${(e as Error).message}`;
    }
  });

  function resetDefaults() {
    draft = DEFAULT_FORMATTER_SETTINGS;
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (keybindingError) return;
    onSave(draft);
  }

  const keywordCaseOptions = [
    { value: "preserve", label: "Preservar" },
    { value: "upper", label: "MAIÚSCULAS" },
    { value: "lower", label: "minúsculas" },
  ];

  const indentStyleOptions = [
    { value: "standard", label: "Padrão" },
    { value: "tabularLeft", label: "Tabular à esquerda" },
    { value: "tabularRight", label: "Tabular à direita" },
  ];

  const logicalOperatorOptions = [
    { value: "before", label: "Antes" },
    { value: "after", label: "Depois" },
  ];

  function bindSelect<K extends keyof FormatterSettings>(key: K) {
    return (e: Event) => {
      draft = { ...draft, [key]: (e.currentTarget as HTMLSelectElement).value } as FormatterSettings;
    };
  }

  function bindNumber<K extends keyof FormatterSettings>(key: K) {
    return (e: Event) => {
      const value = Number((e.currentTarget as HTMLInputElement).value);
      draft = { ...draft, [key]: value } as FormatterSettings;
    };
  }

  function bindBoolean<K extends keyof FormatterSettings>(key: K) {
    return (e: Event) => {
      draft = { ...draft, [key]: (e.currentTarget as HTMLInputElement).checked } as FormatterSettings;
    };
  }
</script>

{#if open}
  <div class="backdrop" onclick={onClose} role="presentation">
    <div
      class="modal"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <header class="header">
        <span class="title"><Settings size={15} /> Configurações do formatador SQL</span>
        <button class="icon close" type="button" onclick={onClose} aria-label="Fechar"><X size={14} /></button>
      </header>

      <form class="body" onsubmit={handleSubmit}>
        <section class="section">
          <h3>Atalho</h3>
          <label class="field">
            <span>Tecla de atalho</span>
            <input
              type="text"
              value={draft.keybinding}
              oninput={(e) => draft = { ...draft, keybinding: e.currentTarget.value }}
              class:error={!!keybindingError}
              placeholder="Ctrl+Alt+L"
            />
            {#if keybindingError}
              <span class="hint error">{keybindingError}</span>
            {:else}
              <span class="hint">Exemplos: Ctrl+Alt+L, Cmd+Shift+F, Ctrl+Shift+I</span>
            {/if}
          </label>
          <p class="display">Exibido como: <kbd>{formatKeybindingForDisplay(draft.keybinding)}</kbd></p>
        </section>

        <section class="section">
          <h3>Capitalização</h3>
          <div class="field-row">
            <label class="field compact">
              <span>Palavras-chave</span>
              <select value={draft.keywordCase} onchange={bindSelect("keywordCase")}>
                {#each keywordCaseOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </label>
            <label class="field compact">
              <span>Identificadores</span>
              <select value={draft.identifierCase} onchange={bindSelect("identifierCase")}>
                {#each keywordCaseOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </label>
            <label class="field compact">
              <span>Tipos de dados</span>
              <select value={draft.dataTypeCase} onchange={bindSelect("dataTypeCase")}>
                {#each keywordCaseOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </label>
            <label class="field compact">
              <span>Funções</span>
              <select value={draft.functionCase} onchange={bindSelect("functionCase")}>
                {#each keywordCaseOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </label>
          </div>
        </section>

        <section class="section">
          <h3>Layout</h3>
          <div class="field-row">
            <label class="field compact">
              <span>Estilo de indentação</span>
              <select value={draft.indentStyle} onchange={bindSelect("indentStyle")}>
                {#each indentStyleOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </label>
            <label class="field compact">
              <span>Largura da expressão</span>
              <input type="number" min="20" max="200" value={draft.expressionWidth} oninput={bindNumber("expressionWidth")} />
            </label>
            <label class="field compact">
              <span>Linhas entre queries</span>
              <input type="number" min="0" max="10" value={draft.linesBetweenQueries} oninput={bindNumber("linesBetweenQueries")} />
            </label>
            <label class="field compact">
              <span>Quebra do AND/OR</span>
              <select value={draft.logicalOperatorNewline} onchange={bindSelect("logicalOperatorNewline")}>
                {#each logicalOperatorOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </label>
          </div>
          <div class="field-row">
            <label class="field compact">
              <span>Largura do tab</span>
              <input type="number" min="1" max="8" value={draft.tabWidth} oninput={bindNumber("tabWidth")} />
            </label>
            <label class="checkbox">
              <input type="checkbox" checked={draft.useTabs} onchange={bindBoolean("useTabs")} />
              Usar tabs em vez de espaços
            </label>
            <label class="checkbox">
              <input type="checkbox" checked={draft.denseOperators} onchange={bindBoolean("denseOperators")} />
              Operadores densos
            </label>
            <label class="checkbox">
              <input type="checkbox" checked={draft.newlineBeforeSemicolon} onchange={bindBoolean("newlineBeforeSemicolon")} />
              Nova linha antes do ponto-e-vírgula
            </label>
          </div>
        </section>

        <section class="section">
          <h3>Preview ({dialect})</h3>
          <pre class="preview"><code>{preview}</code></pre>
        </section>

        <div class="actions">
          <button type="button" class="secondary" onclick={resetDefaults}>Restaurar padrão</button>
          <div class="spacer"></div>
          <button type="button" class="secondary" onclick={onClose}>Cancelar</button>
          <button type="submit" class="primary" disabled={!!keybindingError}>Salvar</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    display: flex;
    flex-direction: column;
    width: min(720px, 94vw);
    max-height: min(900px, 92vh);
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #2d2d30;
    border-bottom: 1px solid #333;
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: #ddd;
  }
  .body {
    display: flex;
    flex-direction: column;
    padding: 14px;
    gap: 16px;
    overflow-y: auto;
  }
  .section h3 {
    margin: 0 0 8px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #888;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field span {
    font-size: 12px;
    color: #9d9d9d;
  }
  .field input,
  .field select {
    background: #2d2d2d;
    border: 1px solid #3c3c3c;
    border-radius: 4px;
    color: #ddd;
    padding: 6px 8px;
    font-size: 13px;
    font-family: inherit;
  }
  .field input.error {
    border-color: #a1260d;
  }
  .field input:focus,
  .field select:focus {
    outline: 1px solid #0e639c;
  }
  .field-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
  }
  .field.compact input,
  .field.compact select {
    width: 100%;
  }
  .hint {
    font-size: 11px;
    color: #888;
  }
  .hint.error {
    color: #f48771;
  }
  .display {
    margin: 6px 0 0;
    font-size: 12px;
    color: #bbb;
  }
  kbd {
    background: #333;
    border: 1px solid #555;
    border-radius: 3px;
    padding: 2px 6px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .checkbox {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #ccc;
    cursor: pointer;
  }
  .checkbox input {
    accent-color: #0e639c;
  }
  .preview {
    margin: 0;
    padding: 10px;
    background: #141414;
    border: 1px solid #333;
    border-radius: 4px;
    color: #d4d4d4;
    font-family: ui-monospace, monospace;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    max-height: 220px;
    overflow: auto;
  }
  .actions {
    display: flex;
    gap: 8px;
    padding-top: 4px;
  }
  .actions button {
    background: #2d2d2d;
    color: #ddd;
    border: 1px solid #3c3c3c;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }
  .actions button.primary {
    background: #0e639c;
    color: #fff;
    border-color: #0e639c;
  }
  .actions button.primary:hover:not(:disabled) {
    background: #1177bb;
  }
  .actions button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .actions .secondary:hover:not(:disabled) {
    background: #3c3c3c;
  }
  .spacer {
    flex: 1;
  }
  button.icon {
    background: transparent;
    border: none;
    color: #ccc;
    padding: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
  }
  button.icon.close:hover {
    color: #fff;
  }
</style>
