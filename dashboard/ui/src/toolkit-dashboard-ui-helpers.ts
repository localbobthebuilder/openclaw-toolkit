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
  style = ''
) {
  return html`
    <div class="applied-toolset-card" style=${style}>
      <div class="applied-toolset-header">
        <strong>${title}</strong>
        ${badge ?? nothing}
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
