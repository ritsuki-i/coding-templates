const STORAGE_KEY = "code-shelf-templates-v1";
const FILTERS_STORAGE_KEY = "code-shelf-filters-v1";
const EMPTY_FILTERS = { category: "", useCase: "", language: "" };

const state = {
  templates: [],
  initialTemplates: [],
  query: "",
  filters: { ...EMPTY_FILTERS },
};

const elements = {
  rows: document.querySelector("#templateRows"),
  resultCount: document.querySelector("#resultCount"),
  emptyState: document.querySelector("#emptyState"),
  message: document.querySelector("#message"),
  search: document.querySelector("#searchInput"),
  category: document.querySelector("#categoryFilter"),
  useCase: document.querySelector("#useCaseFilter"),
  language: document.querySelector("#languageFilter"),
  dialog: document.querySelector("#editorDialog"),
  form: document.querySelector("#editorForm"),
};

const normalize = (value) => String(value ?? "").toLocaleLowerCase().normalize("NFKC");
const tokenize = (query) => [...new Set(normalize(query).trim().split(/[\s\u3000]+/).filter(Boolean))];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[char]));

function validateTemplates(data) {
  if (!Array.isArray(data)) throw new Error("JSONのルートは配列にしてください。");
  return data.map((item, index) => {
    for (const field of ["title", "language", "category", "useCase", "description", "code"]) {
      if (typeof item[field] !== "string" || !item[field].trim()) {
        throw new Error(`${index + 1}件目の「${field}」が未入力です。`);
      }
    }
    return {
      ...item,
      id: String(item.id || crypto.randomUUID()),
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    };
  });
}

async function loadTemplates() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const response = await fetch("templates.json");
  if (!response.ok) throw new Error("templates.json を読み込めませんでした。");
  state.initialTemplates = validateTemplates(await response.json());
  state.templates = saved ? validateTemplates(JSON.parse(saved)) : structuredClone(state.initialTemplates);
  state.filters = loadFilterPreferences();
  refresh();
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.templates));
}

function loadFilterPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_STORAGE_KEY) ?? "{}");
    return {
      category: typeof saved.category === "string" ? saved.category : "",
      useCase: typeof saved.useCase === "string" ? saved.useCase : "",
      language: typeof saved.language === "string" ? saved.language : "",
    };
  } catch {
    return { ...EMPTY_FILTERS };
  }
}

function persistFilters() {
  localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(state.filters));
}

function sanitizeFilters() {
  for (const [key, field] of [["category", "category"], ["useCase", "useCase"], ["language", "language"]]) {
    if (state.filters[key] && !state.templates.some((item) => item[field] === state.filters[key])) {
      state.filters[key] = "";
    }
  }
  persistFilters();
}

function scoreTemplate(template, terms) {
  const description = normalize(template.description);
  const code = normalize(template.code);
  const metadata = normalize([template.title, template.category, template.useCase, template.language, ...template.tags].join(" "));
  let matchCount = 0;
  let descriptionMatches = 0;
  let metadataMatches = 0;

  for (const term of terms) {
    const inDescription = description.includes(term);
    const inCode = code.includes(term);
    if (inDescription || inCode) matchCount += 1;
    if (inDescription) descriptionMatches += 1;
    if (metadata.includes(term)) metadataMatches += 1;
  }
  return { matchCount, descriptionMatches, metadataMatches };
}

function getResults() {
  const terms = tokenize(state.query);
  return state.templates
    .filter((item) => !state.filters.category || item.category === state.filters.category)
    .filter((item) => !state.filters.useCase || item.useCase === state.filters.useCase)
    .filter((item) => !state.filters.language || item.language === state.filters.language)
    .map((item) => ({ item, score: scoreTemplate(item, terms) }))
    .filter(({ score }) => !terms.length || score.matchCount > 0 || score.metadataMatches > 0)
    .sort((a, b) =>
      b.score.matchCount - a.score.matchCount ||
      b.score.descriptionMatches - a.score.descriptionMatches ||
      b.score.metadataMatches - a.score.metadataMatches ||
      a.item.title.localeCompare(b.item.title, "ja")
    );
}

function highlight(value, terms) {
  let html = escapeHtml(value);
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    const escapedTerm = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(`(${escapedTerm})`, "giu"), "<mark>$1</mark>");
  }
  return html;
}

function renderRows() {
  const results = getResults();
  const terms = tokenize(state.query);
  elements.resultCount.textContent = results.length;
  elements.emptyState.hidden = results.length > 0;
  elements.rows.innerHTML = results.map(({ item, score }) => `
    <tr>
      <td>
        <strong class="template-title">${highlight(item.title, terms)}</strong>
        <span class="language">${escapeHtml(item.language)}</span>
        ${terms.length ? `<span class="chip">一致 ${score.matchCount}/${terms.length}</span>` : ""}
      </td>
      <td>
        <span class="chip">${escapeHtml(item.category)}</span>
        <span class="chip">${escapeHtml(item.useCase)}</span>
        ${item.tags.map((tag) => `<span class="chip">${highlight(tag, terms)}</span>`).join("")}
      </td>
      <td><p class="description">${highlight(item.description, terms)}</p></td>
      <td>
        <div class="code-wrap">
          <pre><code>${highlight(item.code, terms)}</code></pre>
          <button class="copy-button" type="button" data-copy="${escapeHtml(item.id)}">コピー</button>
        </div>
      </td>
      <td>
        <div class="row-actions">
          <button type="button" data-edit="${escapeHtml(item.id)}">編集</button>
          <button class="delete-button" type="button" data-delete="${escapeHtml(item.id)}">削除</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function setOptions(select, values, current) {
  const label = select.options[0].textContent;
  select.innerHTML = `<option value="">${label}</option>` + [...new Set(values)]
    .sort((a, b) => a.localeCompare(b, "ja"))
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("");
  select.value = current;
}

function refresh() {
  sanitizeFilters();
  setOptions(elements.category, state.templates.map((item) => item.category), state.filters.category);
  setOptions(elements.useCase, state.templates.map((item) => item.useCase), state.filters.useCase);
  setOptions(elements.language, state.templates.map((item) => item.language), state.filters.language);
  renderRows();
}

function notify(text) {
  elements.message.textContent = text;
  elements.message.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { elements.message.hidden = true; }, 2400);
}

function openEditor(template = null) {
  document.querySelector("#dialogTitle").textContent = template ? "テンプレートを編集" : "テンプレートを追加";
  elements.form.reset();
  document.querySelector("#templateId").value = template?.id ?? "";
  document.querySelector("#titleInput").value = template?.title ?? "";
  document.querySelector("#languageInput").value = template?.language ?? "";
  document.querySelector("#categoryInput").value = template?.category ?? "";
  document.querySelector("#useCaseInput").value = template?.useCase ?? "";
  document.querySelector("#descriptionInput").value = template?.description ?? "";
  document.querySelector("#tagsInput").value = template?.tags.join(", ") ?? "";
  document.querySelector("#codeInput").value = template?.code ?? "";
  elements.dialog.showModal();
}

elements.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderRows();
});

for (const [element, key] of [[elements.category, "category"], [elements.useCase, "useCase"], [elements.language, "language"]]) {
  element.addEventListener("change", (event) => {
    state.filters[key] = event.target.value;
    persistFilters();
    renderRows();
  });
}

document.querySelector("#clearFiltersButton").addEventListener("click", () => {
  state.query = "";
  state.filters = { ...EMPTY_FILTERS };
  persistFilters();
  elements.search.value = "";
  refresh();
  elements.search.focus();
});

document.querySelector("#openEditorButton").addEventListener("click", () => openEditor());
document.querySelector("#closeEditorButton").addEventListener("click", () => elements.dialog.close());
document.querySelector("#cancelEditorButton").addEventListener("click", () => elements.dialog.close());

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = document.querySelector("#templateId").value || crypto.randomUUID();
  const template = {
    id,
    title: document.querySelector("#titleInput").value.trim(),
    language: document.querySelector("#languageInput").value.trim(),
    category: document.querySelector("#categoryInput").value.trim(),
    useCase: document.querySelector("#useCaseInput").value.trim(),
    description: document.querySelector("#descriptionInput").value.trim(),
    tags: document.querySelector("#tagsInput").value.split(/[,、]/).map((tag) => tag.trim()).filter(Boolean),
    code: document.querySelector("#codeInput").value.trim(),
  };
  const index = state.templates.findIndex((item) => item.id === id);
  if (index >= 0) state.templates[index] = template;
  else state.templates.unshift(template);
  persist();
  refresh();
  elements.dialog.close();
  notify(index >= 0 ? "テンプレートを更新しました。" : "テンプレートを追加しました。");
});

elements.rows.addEventListener("click", async (event) => {
  const copyId = event.target.dataset.copy;
  const editId = event.target.dataset.edit;
  const deleteId = event.target.dataset.delete;
  const template = state.templates.find((item) => item.id === copyId || item.id === editId || item.id === deleteId);
  if (!template) return;
  if (copyId) {
    await navigator.clipboard.writeText(template.code);
    event.target.textContent = "コピー済み";
    setTimeout(() => { event.target.textContent = "コピー"; }, 1200);
  }
  if (editId) openEditor(template);
  if (deleteId && confirm(`「${template.title}」を削除しますか？`)) {
    state.templates = state.templates.filter((item) => item.id !== deleteId);
    persist();
    refresh();
    notify("テンプレートを削除しました。");
  }
});

document.querySelector("#exportButton").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.templates, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "code-shelf-templates.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

document.querySelector("#importInput").addEventListener("change", async (event) => {
  try {
    state.templates = validateTemplates(JSON.parse(await event.target.files[0].text()));
    persist();
    refresh();
    notify("JSONを読み込みました。");
  } catch (error) {
    alert(`読み込みに失敗しました: ${error.message}`);
  } finally {
    event.target.value = "";
  }
});

document.querySelector("#resetButton").addEventListener("click", () => {
  if (!confirm("追加・編集した内容を破棄して、初期データに戻しますか？")) return;
  state.templates = structuredClone(state.initialTemplates);
  persist();
  refresh();
  notify("初期データに戻しました。");
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.search.focus();
  }
});

loadTemplates().catch((error) => {
  elements.message.hidden = false;
  elements.message.textContent = `${error.message} ローカルサーバー経由で開いてください。`;
});
