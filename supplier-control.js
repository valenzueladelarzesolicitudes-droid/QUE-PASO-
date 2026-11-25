(() => {
  const get = id => document.getElementById(id);
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
    'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const statuses = {
    pending: 'Pendiente de recibir factura',
    received: 'Factura recibida',
    entered: 'Ingresado'
  };
  const dateFormat = new Intl.DateTimeFormat('es-CL', {dateStyle: 'medium'});
  const clean = value => String(value ?? '').trim();
  const normalized = value => clean(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const optionalText = value => clean(value) || null;
  const form = get('supplier-form');
  const dialog = get('supplier-editor');
  const importForm = get('supplier-import-form');
  const importDialog = get('supplier-import-dialog');
  const filters = {
    search: get('supplier-search'),
    year: get('supplier-year'),
    month: get('supplier-month'),
    status: get('supplier-status')
  };
  let userId;
  let store;
  let active = false;
  let available = null;
  let busy = false;
  let rows = [];
  let editingId;
  let preview = [];
  let readingFile = false;
  let unsubscribe;
  let viewVersion = 0;
  let requestVersion = 0;
  let xlsxLoader;

  function signal(id, text) {
    const node = get(id);
    node.textContent = text;
    node.hidden = !text;
  }

  function option(value, text) {
    const node = element('option', text);
    node.value = value;
    return node;
  }

  for (const [index, name] of months.entries()) {
    form.elements.month.add(option(index + 1, name));
    filters.month.add(option(index + 1, name));
  }
  filters.month.prepend(option('', 'Todos'));
  filters.month.value = '';
  form.elements.status.add(option('', 'Sin estado'));
  filters.status.add(option('', 'Todos'));
  filters.status.add(option('none', 'Sin estado'));
  for (const [value, text] of Object.entries(statuses)) {
    form.elements.status.add(option(value, text));
    filters.status.add(option(value, text));
  }

  function recordCard(row) {
    const card = element('article', undefined, 'supplier-record');
    const heading = element('div', undefined, 'supplier-row-heading');
    const edit = element('button', 'Editar');
    edit.type = 'button';
    edit.setAttribute('aria-label', 'Editar ' + row.supplier + (row.order_number ? ', OC ' + row.order_number : ''));
    edit.onclick = () => openEditor(row);
    const status = element('span', statuses[row.status] ?? 'Sin estado', 'supplier-status-chip');
    if (row.status) status.classList.add(row.status);
    heading.append(element('h3', row.supplier), status, edit);
    const fields = element('dl');
    const date = row.received_on ? dateFormat.format(new Date(row.received_on + 'T12:00:00')) : '—';
    for (const [title, value] of [
      ['Período', months[row.month - 1] + ' ' + row.year],
      ['N.º de OC', row.order_number], ['N.º de factura', row.invoice_number], ['Recepción', date]
    ]) {
      const pair = element('div');
      pair.append(element('dt', title), element('dd', value || '—'));
      fields.append(pair);
    }
    card.append(heading, fields);
    if (row.notes) card.append(element('p', row.notes, 'supplier-notes'));
    return card;
  }

  function render() {
    get('supplier-locked').hidden = Boolean(userId);
    get('supplier-login').disabled = get('account').disabled;
    get('supplier-actions').hidden = !available;
    get('supplier-content').hidden = !available;
    for (const id of ['supplier-add', 'supplier-import', 'supplier-delete', 'supplier-save']) {
      get(id).disabled = busy;
    }
    get('supplier-preview').disabled = busy || readingFile;
    get('supplier-import-submit').disabled = busy || readingFile || !preview.length;
    if (!available) return;

    const previousYear = filters.year.value;
    const years = Array.from(new Set(rows.map(row => row.year))).sort((a, b) => b - a);
    filters.year.replaceChildren(option('', 'Todos'), ...years.map(year => option(year, year)));
    filters.year.value = years.includes(Number(previousYear)) ? previousYear : '';
    get('supplier-names').replaceChildren(...Array.from(new Set(rows.map(row => row.supplier))).sort()
      .map(name => option(name, name)));

    const search = normalized(filters.search.value);
    const base = rows.filter(row =>
      (!filters.year.value || row.year === Number(filters.year.value)) &&
      (!filters.month.value || row.month === Number(filters.month.value)) &&
      (!search || [row.supplier, row.order_number, row.invoice_number].some(value => normalized(value).includes(search))));
    const stats = get('supplier-stats');
    const focused = stats.contains(document.activeElement) ? document.activeElement.dataset.status : undefined;
    stats.replaceChildren();
    for (const [value, label] of [['', 'Total registros'], ...Object.entries(statuses)]) {
      const count = value ? base.filter(row => row.status === value).length : base.length;
      const button = element('button');
      button.type = 'button';
      button.dataset.status = value;
      button.setAttribute('aria-pressed', String(filters.status.value === value));
      button.append(element('strong', count), element('span', label));
      button.onclick = () => {
        filters.status.value = filters.status.value === value ? '' : value;
        render();
      };
      stats.append(button);
      if (focused === value) button.focus();
    }

    const selected = filters.status.value;
    const visible = base.filter(row => !selected || (row.status || 'none') === selected)
      .sort((a, b) => b.year - a.year || b.month - a.month || a.supplier.localeCompare(b.supplier, 'es'));
    get('supplier-count').textContent = visible.length === 1 ? '1 registro' : visible.length + ' registros';
    const list = get('supplier-records');
    if (visible.length) list.replaceChildren(...visible.map(recordCard));
    else list.replaceChildren(element('p', rows.length
      ? 'No hay registros con estos filtros.' : 'Todavía no hay órdenes de compra registradas.', 'empty-state'));
  }

  async function refresh() {
    if (!active || !store || !userId) return;
    const version = ++requestVersion;
    try {
      const data = await store.read();
      if (version !== requestVersion) return;
      rows = data;
      if (!available) signal('supplier-message', '');
      available = true;
      render();
    } catch (error) {
      if (version !== requestVersion) return;
      if (!available) available = false;
      const missingTable = ['PGRST205', '42P01'].includes(error?.code);
      signal('supplier-message', missingTable
        ? 'Falta activar la base de datos del apartado en Supabase.'
        : 'No se pudieron cargar los registros de proveedores. Se volverá a intentar.');
      render();
    }
  }

  function stop() {
    ++viewVersion;
    ++requestVersion;
    unsubscribe?.();
    unsubscribe = undefined;
  }

  async function start() {
    if (!active || !userId || !store) return;
    const version = viewVersion;
    if (available === null) signal('supplier-message', 'Cargando registros…');
    refresh();
    try {
      const close = await store.subscribe(refresh, status => {
        if (viewVersion === version && status === 'SUBSCRIBED') refresh();
      });
      if (viewVersion === version) unsubscribe = close;
      else close();
    } catch {
      // The periodic refresh still works if the realtime channel is unavailable.
    }
  }

  function switchView(showSuppliers) {
    if (active === showSuppliers) return;
    active = showSuppliers;
    get('calendar-view').hidden = active;
    get('suppliers-view').hidden = !active;
    get('add').hidden = active;
    get('calendar-nav').setAttribute('aria-pressed', String(!active));
    get('suppliers-nav').setAttribute('aria-pressed', String(active));
    if (active) { render(); start(); }
    else stop();
  }

  window.supplierControl = {
    setSession(id, connection) {
      stop();
      userId = id;
      store = id ? connection : undefined;
      available = null;
      rows = [];
      get('supplier-records').replaceChildren();
      get('supplier-names').replaceChildren();
      filters.search.value = '';
      filters.year.value = '';
      filters.month.value = '';
      filters.status.value = '';
      editingId = undefined;
      preview = [];
      busy = false;
      if (dialog.open) dialog.close();
      if (importDialog.open) importDialog.close();
      signal('supplier-message', '');
      render();
      start();
    }
  };

  function openEditor(row) {
    if (!available || busy) return;
    editingId = row?.id;
    form.reset();
    const now = new Date();
    const defaults = {month: now.getMonth() + 1, year: now.getFullYear(), status: 'pending'};
    for (const field of ['supplier', 'month', 'year', 'order_number', 'invoice_number', 'status', 'received_on', 'notes']) {
      form.elements[field].value = (row ? row[field] : defaults[field]) ?? '';
    }
    get('supplier-editor-title').textContent = row ? 'Editar registro' : 'Nuevo registro';
    get('supplier-delete').hidden = !row;
    signal('supplier-editor-error', '');
    dialog.showModal();
  }

  function recordFromForm() {
    const data = new FormData(form);
    return {
      supplier: clean(data.get('supplier')),
      month: Number(data.get('month')),
      year: Number(data.get('year')),
      order_number: optionalText(data.get('order_number')),
      invoice_number: optionalText(data.get('invoice_number')),
      status: optionalText(data.get('status')),
      received_on: optionalText(data.get('received_on')),
      notes: optionalText(data.get('notes'))
    };
  }

  async function write(operation, errorTarget, modal, onDone) {
    if (!available || busy || !store || !userId) return;
    const owner = userId;
    busy = true;
    signal(errorTarget, '');
    render();
    try {
      const result = await operation();
      if (owner !== userId) return;
      signal('supplier-message', onDone(result));
      if (modal.open) modal.close();
      await refresh();
    } catch {
      if (owner === userId) signal(errorTarget, 'Supabase no pudo guardar el cambio. Vuelve a intentarlo.');
    } finally {
      if (owner === userId) {
        busy = false;
        render();
      }
    }
  }

  function spreadsheet() {
    if (!xlsxLoader) {
      xlsxLoader = new Promise((resolve, reject) => {
        const script = element('script');
        script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
        script.integrity = 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT';
        script.crossOrigin = 'anonymous';
        script.onload = () => resolve(window.XLSX);
        script.onerror = () => reject(new Error('No se pudo cargar el lector de Excel. Intenta de nuevo.'));
        document.head.append(script);
      }).catch(error => {
        xlsxLoader = undefined;
        throw error;
      });
    }
    return xlsxLoader;
  }

  function formatDate(parts) {
    const [year, month, day] = parts.map(Number);
    const date = new Date(Date.UTC(2000, 0, 1));
    date.setUTCFullYear(year, month - 1, day);
    if (year < 1 || year > 9999 || year !== date.getUTCFullYear() ||
        month !== date.getUTCMonth() + 1 || day !== date.getUTCDate()) {
      throw new Error('Fecha inválida');
    }
    return [year, month, day].map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');
  }

  function parseReceiptDate(value, reader, date1904) {
    if (!clean(value)) return null;
    if (typeof value === 'number') {
      const parts = reader.SSF.parse_date_code(value, {date1904});
      if (!parts) throw new Error('Fecha inválida');
      return formatDate([parts.y, parts.m, parts.d]);
    }
    const text = clean(value);
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) return formatDate(iso.slice(1));
    const local = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (local) return formatDate([local[3], local[2], local[1]]);
    throw new Error('Fecha inválida');
  }

  async function fingerprint(row) {
    const key = [normalized(row.supplier), row.year, row.month, normalized(row.order_number)];
    if (!row.order_number) key.push(row.invoice_number, row.status, row.received_on, row.notes);
    const bytes = new TextEncoder().encode(JSON.stringify(key));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function readWorkbook(file) {
    if (!/\.xlsx$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
      throw new Error('Elige un archivo .xlsx de hasta 2 MB.');
    }
    const reader = await spreadsheet();
    let workbook;
    try {
      workbook = reader.read(await file.arrayBuffer(), {type: 'array', cellDates: false});
    } catch {
      throw new Error('No se pudo abrir el archivo de Excel.');
    }
    const name = workbook.SheetNames.find(sheet => normalized(sheet) === 'control proveedores');
    if (!name) throw new Error('El archivo debe incluir la hoja «Control proveedores».');
    const sheet = workbook.Sheets[name];
    const values = reader.utils.sheet_to_json(sheet, {header: 1, range: 0, raw: true, defval: '', blankrows: true});
    const formatted = reader.utils.sheet_to_json(sheet, {header: 1, range: 0, raw: false, defval: '', blankrows: true});
    const header = values.findIndex(row => normalized(row[0]) === 'proveedor' &&
      normalized(row[1]) === 'mes' && normalized(row[2]) === 'ano' && normalized(row[5]) === 'estado');
    if (header < 0) throw new Error('No se encontró la cabecera de la planilla de control.');
    const stage = new Map();
    const invalid = [];
    let incomplete = 0;
    for (let index = header + 1; index < values.length; index++) {
      const raw = values[index].slice(0, 8);
      if (!raw.some(value => clean(value))) continue;
      const display = formatted[index];
      try {
        const rawMonth = normalized(raw[1]);
        const month = Number(rawMonth) || months.findIndex(name => normalized(name) === rawMonth) + 1;
        const statusText = normalized(raw[5]);
        const status = Object.keys(statuses).find(key => normalized(statuses[key]) === statusText) ?? null;
        const row = {
          supplier: clean(raw[0]),
          month,
          year: Number(raw[2]),
          order_number: optionalText(display[3]),
          invoice_number: optionalText(display[4]),
          status,
          received_on: parseReceiptDate(raw[6], reader, workbook.Workbook?.WBProps?.date1904),
          notes: optionalText(raw[7])
        };
        if (!row.supplier || row.supplier.length > 180 || !Number.isInteger(month) || month < 1 || month > 12 ||
          !Number.isInteger(row.year) || row.year < 1900 || row.year > 9999 || (statusText && !status) ||
          row.order_number?.length > 100 || row.invoice_number?.length > 100 || row.notes?.length > 2000) {
          throw new Error('Registro inválido');
        }
        row.source_key = await fingerprint(row);
        if (stage.has(row.source_key)) continue;
        if (!row.order_number || !row.status) incomplete++;
        stage.set(row.source_key, row);
      } catch {
        invalid.push(index + 1);
      }
    }
    if (invalid.length) throw new Error('Revisa los datos de las filas ' + invalid.slice(0, 12).join(', ') + ' antes de importar.');
    if (!stage.size) throw new Error('La planilla no tiene registros para importar.');
    if (stage.size > 500) throw new Error('Importa hasta 500 registros por archivo.');
    return {records: Array.from(stage.values()), incomplete};
  }

  get('calendar-nav').onclick = () => switchView(false);
  get('suppliers-nav').onclick = () => switchView(true);
  get('supplier-login').onclick = () => get('account').click();
  Object.values(filters).forEach(control => control.addEventListener('input', render));
  get('supplier-add').onclick = () => openEditor();
  get('supplier-cancel').onclick = () => dialog.close();
  get('supplier-delete').onclick = () => {
    if (busy || !editingId || !confirm('¿Eliminar este registro de proveedores?')) return;
    write(() => store.remove(editingId), 'supplier-editor-error', dialog, () => 'Registro eliminado.');
  };
  form.onsubmit = event => {
    event.preventDefault();
    const values = recordFromForm();
    if (!values.supplier) { signal('supplier-editor-error', 'Escribe el nombre del proveedor.'); return; }
    write(() => store.save(values, editingId), 'supplier-editor-error', dialog, () => 'Registro guardado.');
  };

  function resetImport() {
    preview = [];
    signal('supplier-import-preview', '');
    signal('supplier-import-error', '');
    render();
  }

  get('supplier-import').onclick = () => {
    if (!available || busy) return;
    importForm.reset();
    resetImport();
    importDialog.showModal();
  };
  get('supplier-import-cancel').onclick = () => importDialog.close();
  importForm.elements.workbook.onchange = resetImport;
  get('supplier-preview').onclick = async () => {
    const field = importForm.elements.workbook;
    if (!field.reportValidity() || readingFile || busy) return;
    const file = field.files[0];
    const version = viewVersion;
    resetImport();
    readingFile = true;
    render();
    try {
      const {records, incomplete} = await readWorkbook(file);
      if (viewVersion !== version || !importDialog.open || field.files[0] !== file) return;
      preview = records;
      const count = records.length === 1 ? '1 registro listo.' : records.length + ' registros listos.';
      const drafts = incomplete ? ' Sin número de OC o sin estado: ' + incomplete + '.' : '';
      signal('supplier-import-preview', count + drafts + ' Se guardarán en el apartado compartido.');
    } catch (error) {
      if (viewVersion === version && importDialog.open && field.files[0] === file) {
        signal('supplier-import-error', error.message);
      }
    } finally {
      readingFile = false;
      render();
    }
  };
  importForm.onsubmit = event => {
    event.preventDefault();
    if (!preview.length || readingFile) return;
    const count = preview.length;
    write(() => store.import(preview), 'supplier-import-error', importDialog, added =>
      added.length + ' registros importados. ' + (count - added.length) + ' ya estaban en el apartado.');
  };
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
