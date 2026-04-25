import { html, nothing, type TemplateResult } from 'lit';

type MaybeTemplate = TemplateResult | typeof nothing | string | number | boolean | null | undefined;

export function renderCardSection(title: string, content: MaybeTemplate, actions?: MaybeTemplate, className = '', style = '') {
  return html`
    <div class="card ${className}" style=${style}>
      <div class="card-header">
        <h3>${title}</h3>
        ${actions ?? nothing}
      </div>
      ${content}
    </div>
  `;
}

export function renderHelpText(content: MaybeTemplate, style = '') {
  return html`<div class="help-text" style=${style}>${content}</div>`;
}

export function renderToggleSwitch(label: string, checked: boolean, onChange: (checked: boolean) => void, description?: MaybeTemplate, extraStyle = '') {
  return html`
    <label class="toggle-switch" style=${extraStyle}>
      <input type="checkbox" ?checked=${checked} @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked)}>
      ${label}
    </label>
    ${description !== undefined ? html`<div class="help-text">${description}</div>` : nothing}
  `;
}

export function renderTagList<T>(
  items: readonly T[],
  renderItem: (item: T, index: number) => MaybeTemplate,
  emptyText?: MaybeTemplate
) {
  return html`
    <div class="tag-list">
      ${items.length === 0
        ? (emptyText !== undefined ? html`<div class="help-text">${emptyText}</div>` : nothing)
        : items.map((item, index) => renderItem(item, index))}
    </div>
  `;
}

export function renderSelectableTagList<T>(
  items: readonly T[],
  renderItem: (item: T, index: number) => MaybeTemplate,
  options: Array<{ value: string; label: MaybeTemplate }>,
  onSelect: (value: string) => void,
  selectPlaceholder: MaybeTemplate,
  emptyText?: MaybeTemplate,
  selectDisabled = false,
  selectStyle = 'margin-top: 10px;'
) {
  return html`
    ${renderTagList(items, renderItem, emptyText)}
    <div style=${selectStyle}>
      <select ?disabled=${selectDisabled} @change=${(e: any) => {
        const value = e.target.value;
        if (value) {
          onSelect(value);
          e.target.value = '';
        }
      }}>
        <option value="">${selectPlaceholder}</option>
        ${options.map((option) => html`<option value=${option.value}>${option.label}</option>`)}
      </select>
    </div>
  `;
}

export function renderSummaryRow(params: {
  title: MaybeTemplate;
  subtitle: MaybeTemplate;
  actions?: MaybeTemplate;
}) {
  return html`
    <div class="item-row">
      <div class="item-info">
        <span class="item-title">${params.title}</span>
        <span class="item-sub">${params.subtitle}</span>
      </div>
      ${params.actions !== undefined ? html`<div style="display: flex; gap: 8px;">${params.actions}</div>` : nothing}
    </div>
  `;
}

export function renderActionRow(params: {
  title: MaybeTemplate;
  subtitle?: MaybeTemplate;
  content?: MaybeTemplate;
  actions?: MaybeTemplate;
  style?: string;
}) {
  return html`
    <div class="item-row" style=${params.style ?? 'align-items: flex-start; gap: 16px;'}>
      <div class="item-info">
        <span class="item-title">${params.title}</span>
        ${params.subtitle !== undefined ? html`<span class="item-sub">${params.subtitle}</span>` : nothing}
        ${params.content !== undefined ? params.content : nothing}
      </div>
      ${params.actions !== undefined ? html`<div style="display: flex; gap: 12px; align-items: flex-start; flex-shrink: 0;">${params.actions}</div>` : nothing}
    </div>
  `;
}

export function renderSelectableItem(params: {
  title: MaybeTemplate;
  subtitle?: MaybeTemplate;
  onClick: () => void;
  style?: string;
}) {
  return html`
    <div class="selectable-item" style=${params.style ?? ''} @click=${params.onClick}>
      <div class="item-title">${params.title}</div>
      ${params.subtitle !== undefined ? html`<div class="item-sub">${params.subtitle}</div>` : nothing}
    </div>
  `;
}

export function renderModalShell(params: {
  title: MaybeTemplate;
  body: MaybeTemplate;
  onClose: () => void;
  closeLabel?: MaybeTemplate;
}) {
  return html`
    <div class="modal-overlay">
      <div class="modal">
        <div class="card-header" style="padding: 20px;">
          <h3>${params.title}</h3>
          <button class="btn btn-ghost" @click=${params.onClose}>${params.closeLabel ?? 'Close'}</button>
        </div>
        <div class="modal-body">
          ${params.body}
        </div>
      </div>
    </div>
  `;
}

export function renderTwoColumnGrid(left: MaybeTemplate, right: MaybeTemplate) {
  return html`
    <div class="grid-2">
      <div>${left}</div>
      <div>${right}</div>
    </div>
  `;
}

export function renderPreviewCard(
  title: string,
  columns: Array<{ label: string; body: MaybeTemplate }>,
  footer?: MaybeTemplate,
  badge?: MaybeTemplate,
  style = '',
  actions?: MaybeTemplate
) {
  return html`
    <div class="applied-toolset-card" style=${style}>
      <div class="applied-toolset-header">
        <strong>${title}</strong>
        ${badge ?? nothing}
        ${actions ?? nothing}
      </div>
      <div class="toolset-preview-rows">
        ${columns.map((column) => html`
          <div class="toolset-preview-row">
            <div class="toolset-preview-label">${column.label}</div>
            ${column.body}
          </div>
        `)}
      </div>
      ${footer !== undefined ? footer : nothing}
    </div>
  `;
}

export function renderPreviewRows(rows: Array<{ label: string; body: MaybeTemplate }>, style = '') {
  return html`
    <div class="toolset-preview-rows" style=${style}>
      ${rows.map((row) => html`
        <div class="toolset-preview-row">
          <div class="toolset-preview-label">${row.label}</div>
          ${row.body}
        </div>
      `)}
    </div>
  `;
}

export function renderPreviewTags<T>(
  items: readonly T[],
  renderItem: (item: T, index: number) => MaybeTemplate,
  emptyText?: MaybeTemplate
) {
  return html`
    ${items.length === 0
      ? (emptyText !== undefined ? html`<div class="toolset-preview-empty">${emptyText}</div>` : nothing)
      : html`<div class="toolset-preview-tags">${items.map((item, index) => renderItem(item, index))}</div>`}
  `;
}
