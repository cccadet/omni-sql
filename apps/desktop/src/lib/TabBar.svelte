<script lang="ts" module>
  export function focusOnMount(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

<script lang="ts">
  interface TabInfo {
    id: string;
    title: string;
    dirty?: boolean;
    dialectIcon?: string;
  }

  interface Props {
    tabs: TabInfo[];
    activeTabId: string | null;
    onSelect?: (id: string) => void;
    onClose?: (id: string) => void;
    onAdd?: () => void;
    onRename?: (id: string, title: string) => void;
  }
  let { tabs, activeTabId, onSelect, onClose, onAdd, onRename }: Props = $props();

  let editingId = $state<string | null>(null);
  let editingValue = $state("");

  function onTabClick(id: string) {
    if (editingId !== id) onSelect?.(id);
  }

  function onCloseClick(e: Event, id: string) {
    e.preventDefault();
    e.stopPropagation();
    onClose?.(id);
  }

  function onAddClick(e: Event) {
    e.preventDefault();
    onAdd?.();
  }

  function startRename(e: Event, tab: TabInfo) {
    e.preventDefault();
    e.stopPropagation();
    editingId = tab.id;
    editingValue = tab.title;
  }

  function commitRename() {
    if (editingId) {
      const trimmed = editingValue.trim();
      if (trimmed) onRename?.(editingId, trimmed);
    }
    editingId = null;
  }

  function onRenameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      editingId = null;
    }
  }

  function onTabMousedown(e: MouseEvent, id: string) {
    if (e.button === 1) {
      e.preventDefault();
      onClose?.(id);
    }
  }

  function onTabKeydown(e: KeyboardEvent, id: string) {
    if (editingId === id) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(id);
    }
  }
</script>

<div class="tab-bar" role="tablist">
  {#each tabs as tab (tab.id)}
    <div
      class="tab"
      class:active={tab.id === activeTabId}
      role="tab"
      aria-selected={tab.id === activeTabId}
      tabindex="0"
      onclick={() => onTabClick(tab.id)}
      onmousedown={(e) => onTabMousedown(e, tab.id)}
      ondblclick={(e) => startRename(e, tab)}
      onkeydown={(e) => onTabKeydown(e, tab.id)}
    >
      {#if editingId === tab.id}
        <input
          class="tab-rename"
          bind:value={editingValue}
          onblur={commitRename}
          onkeydown={onRenameKeydown}
          onclick={(e) => e.stopPropagation()}
          use:focusOnMount
        />
      {:else}
        {#if tab.dialectIcon}
          <span class="tab-dialect" aria-hidden="true">{tab.dialectIcon}</span>
        {/if}
        <span class="tab-title" title={tab.title}>{tab.title}</span>
        {#if tab.dirty}
          <span class="tab-dirty" title="Alterações não salvas">●</span>
        {/if}
      {/if}
      <button
        class="tab-close"
        title="Fechar aba"
        aria-label="Fechar aba"
        onclick={(e) => onCloseClick(e, tab.id)}
      >×</button>
    </div>
  {/each}
  <button class="tab-add" title="Nova aba" aria-label="Nova aba" onclick={onAddClick}>+</button>
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    background: #252526;
    border-bottom: 1px solid #333;
    overflow-x: auto;
    flex-shrink: 0;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 6px 12px;
    background: #2d2d2d;
    border-right: 1px solid #1e1e1e;
    color: #a0a0a0;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    max-width: 200px;
  }
  .tab:hover { background: #333333; }
  .tab.active {
    background: #1e1e1e;
    color: #ddd;
    box-shadow: inset 0 -2px 0 #0e639c;
  }
  .tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-dialect {
    font-size: 12px;
    line-height: 1;
    flex-shrink: 0;
  }
  .tab-dirty {
    color: #e2b93d;
    font-size: 8px;
    line-height: 1;
    flex-shrink: 0;
  }
  .tab-rename {
    background: #1e1e1e;
    color: #ddd;
    border: 1px solid #0e639c;
    border-radius: 2px;
    font-size: 12px;
    padding: 1px 4px;
    width: 120px;
    font-family: inherit;
  }
  .tab-close {
    border: none;
    background: transparent;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
    border-radius: 3px;
  }
  .tab-close:hover { opacity: 1; background: #444; }
  .tab-add {
    border: none;
    background: transparent;
    color: #a0a0a0;
    cursor: pointer;
    font-size: 15px;
    padding: 0 12px;
    line-height: 1;
  }
  .tab-add:hover { color: #fff; background: #333333; }
</style>
