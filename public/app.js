'use strict';

(function () {
  const $ = (sel) => document.querySelector(sel);
  const state = { tree: [], search: '', collapsed: loadCollapsed(), me: null };
  const canEdit = () => !!state.me && (state.me.role === 'editor' || state.me.role === 'admin');

  // ---------- helpers ----------
  function loadCollapsed() {
    try { return new Set(JSON.parse(localStorage.getItem('collapsed') || '[]')); } catch { return new Set(); }
  }
  function saveCollapsed() {
    try { localStorage.setItem('collapsed', JSON.stringify([...state.collapsed])); } catch { /* storage unavailable */ }
  }

  async function api(method, url, body) {
    const signedInAs = state.me;
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    // Only a request made while signed in means the session has ended.
    if (res.status === 401 && signedInAs && signedInAs === state.me) {
      showLogin();
      throw new Error('Your session has ended. Please sign in again.');
    }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status}).`);
      err.field = data.field;
      throw err;
    }
    return data;
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // Text with the current search term highlighted. dir="auto" lets Arabic
  // and English each render in their own direction.
  function text(tag, cls, value) {
    const node = el(tag, { class: cls, dir: 'auto' });
    const term = state.search.trim().toLocaleLowerCase();
    const str = String(value ?? '');
    if (!term) { node.textContent = str; return node; }
    const lower = str.toLocaleLowerCase();
    let i = 0;
    while (i < str.length) {
      const j = lower.indexOf(term, i);
      if (j < 0) { node.append(str.slice(i)); break; }
      if (j > i) node.append(str.slice(i, j));
      node.append(el('mark', null, str.slice(j, j + term.length)));
      i = j + term.length;
    }
    return node;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

  function toast(message, kind) {
    const t = el('div', { class: `toast ${kind || ''}`, dir: 'auto' }, message);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), kind === 'warn' ? 7000 : 3000);
  }

  function dupList(dups) {
    return el('ul', null, dups.map((d) => el('li', { dir: 'auto' }, `${d.name} (${d.email}) in ${d.entity} › ${d.department}`)));
  }

  // ---------- rendering ----------
  function render() {
    const root = $('#tree');
    root.replaceChildren();
    root.setAttribute('aria-busy', 'false');
    const searching = !!state.search.trim();

    let depts = 0; let fps = 0;
    for (const e of state.tree) { depts += e.departments.length; for (const d of e.departments) fps += d.focal_points.length; }
    $('#summary').textContent = searching
      ? `Showing ${plural(state.tree.length, 'entity', 'entities')}, ${plural(depts, 'department', 'departments')}, ${plural(fps, 'focal point', 'focal points')} matching “${state.search.trim()}”`
      : `${plural(state.tree.length, 'entity', 'entities')} · ${plural(depts, 'department', 'departments')} · ${plural(fps, 'focal point', 'focal points')}`;

    if (!state.tree.length) {
      const hint = canEdit() ? 'No entities yet. Use “+ Entity” to add the first one.' : 'The directory is empty.';
      root.append(el('div', { class: 'empty' }, searching ? 'No matches found.' : hint));
      return;
    }
    for (const e of state.tree) root.append(renderEntity(e, searching));
  }

  function renderEntity(e, searching) {
    const id = `e${e.id}`;
    const collapsed = !searching && state.collapsed.has(id);
    const fpCount = e.departments.reduce((n, d) => n + d.focal_points.length, 0);
    const card = el('section', { class: `entity${collapsed ? ' collapsed' : ''}`, 'data-entity-id': e.id });
    const head = el('div', { class: 'row-head' },
      el('button', { class: 'toggle', type: 'button', 'aria-expanded': String(!collapsed), onclick: () => toggle(id) },
        el('span', { class: 'chev', 'aria-hidden': 'true' }, '▾'),
        text('span', 'entity-name', e.name),
        el('span', { class: 'count' }, `${plural(e.departments.length, 'dept', 'depts')} · ${plural(fpCount, 'focal point', 'focal points')}`)),
      el('div', { class: 'row-actions' },
        canEdit() && el('button', { class: 'btn small', type: 'button', onclick: () => addDepartment(e) }, '+ Department'),
        el('button', { class: 'btn small ghost', type: 'button', title: 'Export this entity to Excel', onclick: () => exportXlsx(e.id) }, 'Export'),
        canEdit() && el('button', { class: 'btn small ghost', type: 'button', onclick: () => editEntity(e) }, 'Edit'),
        canEdit() && el('button', { class: 'btn small ghost del', type: 'button', onclick: () => deleteEntity(e) }, 'Delete')));
    const body = el('div', { class: 'entity-body' });
    if (!e.departments.length) body.append(el('div', { class: 'entity-empty' }, 'No departments yet.'));
    for (const d of e.departments) body.append(renderDepartment(e, d, searching));
    card.append(head, body);
    return card;
  }

  function renderDepartment(e, d, searching) {
    const id = `d${d.id}`;
    const collapsed = !searching && state.collapsed.has(id);
    const box = el('div', { class: `department${collapsed ? ' collapsed' : ''}`, 'data-department-id': d.id });
    const head = el('div', { class: 'row-head' },
      el('button', { class: 'toggle', type: 'button', 'aria-expanded': String(!collapsed), onclick: () => toggle(id) },
        el('span', { class: 'chev', 'aria-hidden': 'true' }, '▾'),
        text('span', 'dept-name', d.name),
        el('span', { class: 'count' }, plural(d.focal_points.length, 'focal point', 'focal points'))),
      canEdit() && el('div', { class: 'row-actions' },
        el('button', { class: 'btn small', type: 'button', onclick: () => addFocalPoint(e, d) }, '+ Focal point'),
        el('button', { class: 'btn small ghost', type: 'button', onclick: () => editDepartment(d) }, 'Edit'),
        el('button', { class: 'btn small ghost del', type: 'button', onclick: () => deleteDepartment(e, d) }, 'Delete')));
    const body = el('div', { class: 'dept-body' });
    if (!d.focal_points.length) body.append(el('div', { class: 'dept-empty' }, 'No focal points yet.'));
    else body.append(el('div', { class: 'fps' }, d.focal_points.map((f) => renderFocalPoint(e, d, f))));
    box.append(head, body);
    return box;
  }

  function renderFocalPoint(e, d, f) {
    const email = el('div', { class: 'fp-email' });
    const link = el('a', { href: `mailto:${f.email}` });
    link.append(text('span', '', f.email));
    email.append(link);
    if (f.email_duplicates > 0) {
      email.append(el('span', { class: 'dup', title: 'This email is also used by another focal point.' },
        `also used ${f.email_duplicates === 1 ? 'once' : `${f.email_duplicates}×`} elsewhere`));
    }
    return el('article', { class: 'fp', 'data-focal-point-id': f.id },
      el('div', { class: 'fp-head' },
        text('div', 'fp-name', f.name),
        canEdit() && el('button', { class: 'btn small ghost', type: 'button', onclick: () => editFocalPoint(e, d, f) }, 'Edit'),
        canEdit() && el('button', { class: 'btn small ghost del', type: 'button', onclick: () => deleteFocalPoint(f) }, 'Delete')),
      text('div', 'fp-title', f.title),
      email,
      f.remarks ? text('div', 'fp-remarks', f.remarks) : null,
      el('div', { class: 'fp-meta' }, `Created ${fmtDate(f.created_at)} · Updated ${fmtDate(f.updated_at)}`));
  }

  function toggle(id) {
    if (state.search.trim()) return;
    if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
    saveCollapsed();
    render();
  }

  async function load() {
    try {
      const q = state.search.trim();
      state.tree = await api('GET', `/api/tree${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      render();
    } catch (err) {
      $('#tree').replaceChildren(el('div', { class: 'empty' }, `Could not load the directory: ${err.message}`));
    }
  }

  // ---------- form dialog ----------
  // Each open form gets a number, so a slow save from a previous form can't close
  // or re-enable the one that replaced it.
  let formGeneration = 0;

  function openForm({ title, fields, values = {}, submitLabel = 'Save', onEmailInput, onSubmit }) {
    const generation = ++formGeneration;
    const dialog = $('#form-dialog');
    const form = $('#form');
    $('#form-title').textContent = title;
    $('#form-submit').textContent = submitLabel;
    const warning = $('#form-warning');
    const error = $('#form-error');
    warning.hidden = true; error.hidden = true;
    const container = $('#form-fields');
    container.replaceChildren();
    const inputs = {};
    for (const f of fields) {
      const inputId = `f-${f.name}`;
      let input;
      if (f.options) {
        input = el('select', { id: inputId, name: f.name }, f.options.map(([value, label]) => el('option', { value }, label)));
      } else if (f.multiline) {
        input = el('textarea', { id: inputId, name: f.name, dir: 'auto', rows: 4, maxlength: f.max });
      } else {
        input = el('input', {
          id: inputId, name: f.name, type: f.type || 'text', dir: f.type === 'password' ? undefined : 'auto', maxlength: f.max,
          autocomplete: f.autocomplete || 'off', inputmode: f.type === 'email' ? 'email' : undefined,
        });
      }
      input.value = values[f.name] ?? '';
      if (f.required) input.required = true;
      inputs[f.name] = input;
      container.append(el('div', { class: 'field' },
        el('label', { for: inputId }, f.label, f.required ? '' : el('span', { class: 'opt' }, ' (optional)')),
        input,
        f.hint ? el('div', { class: 'field-hint' }, f.hint) : null));
    }

    let emailTimer;
    async function checkEmail() {
      if (!onEmailInput) return;
      const dups = await onEmailInput(inputs.email.value.trim()).catch(() => []);
      if (dups.length) {
        warning.replaceChildren('Heads up: this email is already used by:', dupList(dups), 'You can still save.');
        warning.hidden = false;
      } else warning.hidden = true;
    }
    if (inputs.email && onEmailInput) {
      inputs.email.addEventListener('input', () => { clearTimeout(emailTimer); emailTimer = setTimeout(checkEmail, 350); });
      if (inputs.email.value) checkEmail();
    }

    form.onsubmit = async (ev) => {
      ev.preventDefault();
      error.hidden = true;
      container.querySelectorAll('.field').forEach((n) => n.classList.remove('invalid'));
      const data = {};
      for (const [k, input] of Object.entries(inputs)) data[k] = input.value;
      const missing = fields.find((f) => f.required && !data[f.name].trim());
      if (missing) return showError(`${missing.label} is required.`, missing.name);
      const short = fields.find((f) => f.minLength && data[f.name] && data[f.name].length < f.minLength);
      if (short) return showError(`${short.label} must be at least ${short.minLength} characters.`, short.name);
      if (inputs.email && !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(data.email.trim())) {
        return showError('Email format is not valid (example: name@example.com).', 'email');
      }
      $('#form-submit').disabled = true;
      try {
        await onSubmit(data);
        if (generation === formGeneration) dialog.close();
      } catch (err) {
        if (generation === formGeneration) showError(err.message, err.field);
      } finally {
        if (generation === formGeneration) $('#form-submit').disabled = false;
      }
    };
    function showError(msg, field) {
      error.textContent = msg; error.hidden = false;
      if (field && inputs[field]) { inputs[field].closest('.field').classList.add('invalid'); inputs[field].focus(); }
    }
    $('#form-submit').disabled = false;
    if (!dialog.open) dialog.showModal();
    const first = fields[0] && inputs[fields[0].name];
    if (first) first.focus();
  }

  // ---------- confirm dialog ----------
  function confirmDelete({ title, message, confirmLabel = 'Delete' }) {
    return new Promise((resolve) => {
      const dialog = $('#confirm-dialog');
      $('#confirm-title').textContent = title;
      $('#confirm-message').replaceChildren(...[].concat(message));
      const ok = $('#confirm-ok');
      ok.textContent = confirmLabel;
      const done = (v) => { dialog.close(); resolve(v); };
      ok.onclick = () => done(true);
      dialog.querySelector('[data-close]').onclick = () => done(false);
      dialog.oncancel = () => resolve(false);
      dialog.showModal();
    });
  }

  document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  // ---------- actions ----------
  const NAME_FIELD = [{ name: 'name', label: 'Name', required: true, max: 200 }];
  const FP_FIELDS = [
    { name: 'name', label: 'Name', required: true, max: 200 },
    { name: 'title', label: 'Title', required: true, max: 200 },
    { name: 'email', label: 'Email', type: 'email', required: true, max: 254 },
    { name: 'remarks', label: 'Remarks', multiline: true, max: 5000, hint: 'Any comment. Multiple lines are fine.' },
  ];
  const emailCheck = (excludeId) => async (email) => {
    if (!email) return [];
    const r = await api('GET', `/api/email-check?email=${encodeURIComponent(email)}&excludeId=${excludeId || 0}`);
    return r.duplicates;
  };
  function afterFocalPointSave(result, verb) {
    if (result.duplicateEmails && result.duplicateEmails.length) {
      toast(`Focal point ${verb}. Note: ${result.focalPoint.email} is also used by ${result.duplicateEmails.map((d) => d.name).join(', ')}.`, 'warn');
    } else toast(`Focal point ${verb}.`);
  }

  function addEntity() {
    openForm({
      title: 'Add entity', fields: NAME_FIELD, submitLabel: 'Add',
      onSubmit: async (data) => { await api('POST', '/api/entities', data); toast('Entity added.'); await load(); },
    });
  }
  function editEntity(e) {
    openForm({
      title: 'Edit entity', fields: NAME_FIELD, values: e,
      onSubmit: async (data) => { await api('PUT', `/api/entities/${e.id}`, data); toast('Entity updated.'); await load(); },
    });
  }
  async function deleteEntity(e) {
    const impact = await api('GET', `/api/entities/${e.id}/impact`);
    const msg = [el('p', { dir: 'auto' }, 'Delete entity ', el('strong', null, impact.entity.name), '?')];
    if (impact.focalPoints.length) {
      msg.push(el('div', { class: 'warning impact' },
        `Warning: this entity still contains ${plural(impact.departments.length, 'department', 'departments')} and ${plural(impact.focalPoints.length, 'focal point', 'focal points')}. All of them will be removed:`,
        el('ul', null, impact.departments.map((d) => el('li', { dir: 'auto' }, `${d.name} (${plural(d.focal_point_count, 'focal point', 'focal points')})`,
          el('ul', null, impact.focalPoints.filter((f) => f.department === d.name).map((f) => el('li', { dir: 'auto' }, `${f.name} – ${f.email}`))))))));
    } else if (impact.departments.length) {
      msg.push(el('div', { class: 'warning impact' }, `It has ${plural(impact.departments.length, 'empty department', 'empty departments')} that will also be removed:`,
        el('ul', null, impact.departments.map((d) => el('li', { dir: 'auto' }, d.name)))));
    }
    msg.push(el('p', null, 'This cannot be undone.'));
    if (!(await confirmDelete({ title: 'Delete entity', message: msg }))) return;
    await api('DELETE', `/api/entities/${e.id}`);
    toast('Entity deleted.');
    await load();
  }

  function addDepartment(e) {
    openForm({
      title: `Add department to ${e.name}`, fields: NAME_FIELD, submitLabel: 'Add',
      onSubmit: async (data) => { await api('POST', `/api/entities/${e.id}/departments`, data); state.collapsed.delete(`e${e.id}`); saveCollapsed(); toast('Department added.'); await load(); },
    });
  }
  function editDepartment(d) {
    openForm({
      title: 'Edit department', fields: NAME_FIELD, values: d,
      onSubmit: async (data) => { await api('PUT', `/api/departments/${d.id}`, data); toast('Department updated.'); await load(); },
    });
  }
  async function deleteDepartment(e, d) {
    const impact = await api('GET', `/api/departments/${d.id}/impact`);
    const msg = [el('p', { dir: 'auto' }, 'Delete department ', el('strong', null, impact.department.name), ` from ${e.name}?`)];
    if (impact.focalPoints.length) {
      msg.push(el('div', { class: 'warning impact' },
        `Warning: this department still contains ${plural(impact.focalPoints.length, 'focal point', 'focal points')}. They will be removed:`,
        el('ul', null, impact.focalPoints.map((f) => el('li', { dir: 'auto' }, `${f.name} – ${f.email}`)))));
    }
    msg.push(el('p', null, 'This cannot be undone.'));
    if (!(await confirmDelete({ title: 'Delete department', message: msg }))) return;
    await api('DELETE', `/api/departments/${d.id}`);
    toast('Department deleted.');
    await load();
  }

  function addFocalPoint(e, d) {
    openForm({
      title: `Add focal point to ${d.name}`, fields: FP_FIELDS, submitLabel: 'Add', onEmailInput: emailCheck(0),
      onSubmit: async (data) => {
        const r = await api('POST', `/api/departments/${d.id}/focal-points`, data);
        state.collapsed.delete(`e${e.id}`); state.collapsed.delete(`d${d.id}`); saveCollapsed();
        afterFocalPointSave(r, 'added');
        await load();
      },
    });
  }
  function editFocalPoint(e, d, f) {
    openForm({
      title: 'Edit focal point', fields: FP_FIELDS, values: f, onEmailInput: emailCheck(f.id),
      onSubmit: async (data) => { const r = await api('PUT', `/api/focal-points/${f.id}`, data); afterFocalPointSave(r, 'updated'); await load(); },
    });
  }
  async function deleteFocalPoint(f) {
    const msg = [el('p', { dir: 'auto' }, 'Delete focal point ', el('strong', null, f.name), ` (${f.email})?`), el('p', null, 'This cannot be undone.')];
    if (!(await confirmDelete({ title: 'Delete focal point', message: msg }))) return;
    await api('DELETE', `/api/focal-points/${f.id}`);
    toast('Focal point deleted.');
    await load();
  }

  function exportXlsx(entityId) {
    const a = el('a', { href: `/api/export.xlsx${entityId ? `?entityId=${entityId}` : ''}`, download: '' });
    document.body.append(a); a.click(); a.remove();
  }

  function setAll(collapsed) {
    state.collapsed.clear();
    if (collapsed) for (const e of state.tree) { state.collapsed.add(`e${e.id}`); for (const d of e.departments) state.collapsed.add(`d${d.id}`); }
    saveCollapsed(); render();
    $('.menu').open = false;
  }

  // ---------- sign in / out ----------
  const ROLE_LABEL = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };

  function showLogin({ clearPassword = true } = {}) {
    state.me = null;
    state.tree = [];
    $('#tree').replaceChildren();
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    if (clearPassword) $('#login-password').value = '';
    if (!$('#login-username').value && document.activeElement === document.body) $('#login-username').focus();
  }

  function showApp() {
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    $('#login-error').hidden = true;
    const me = state.me;
    $('#whoami').textContent = `Signed in as ${me.display_name || me.username} (${ROLE_LABEL[me.role]})`;
    $('#add-entity').hidden = !canEdit();
    $('#manage-users').hidden = me.role !== 'admin';
    load();
  }

  async function boot() {
    try {
      const config = await api('GET', '/api/config');
      $('#test-banner').hidden = !config.testMode;
      $('#setup-note').hidden = !config.setupRequired;
    } catch { /* shown below if the API is down */ }
    try {
      state.me = (await api('GET', '/api/me')).user;
      showApp();
    } catch {
      // Someone may have signed in while this check was in flight; otherwise show
      // the sign-in form, keeping anything already typed into it.
      if (!state.me) showLogin({ clearPassword: false });
    }
  }

  async function signIn(ev) {
    ev.preventDefault();
    const err = $('#login-error');
    err.hidden = true;
    $('#login-submit').disabled = true;
    try {
      const r = await api('POST', '/api/login', { username: $('#login-username').value, password: $('#login-password').value });
      state.me = r.user;
      $('#login-password').value = '';
      showApp();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      $('#login-submit').disabled = false;
    }
  }

  async function signOut() {
    $('.menu').open = false;
    await api('POST', '/api/logout').catch(() => {});
    showLogin();
  }

  function changePassword() {
    openForm({
      title: 'Change password',
      fields: [
        { name: 'current_password', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' },
        { name: 'new_password', label: 'New password', type: 'password', required: true, minLength: 10, autocomplete: 'new-password', hint: 'At least 10 characters.' },
      ],
      onSubmit: async (data) => { await api('POST', '/api/me/password', data); toast('Password changed.'); },
    });
  }

  // ---------- user management (admins) ----------
  const ROLE_OPTIONS = [['viewer', 'Viewer'], ['editor', 'Editor'], ['admin', 'Admin']];

  async function openUsers() {
    const dialog = $('#users-dialog');
    if (!dialog.open) dialog.showModal();
    const users = await api('GET', '/api/users');
    $('#users-list').replaceChildren(...users.map((u) => {
      const self = u.id === state.me.id;
      return el('div', { class: `user-row${u.active ? '' : ' inactive'}` },
        el('div', { class: 'user-info' },
          el('div', { class: 'user-name', dir: 'auto' }, u.display_name || u.username, self ? el('span', { class: 'count' }, ' (you)') : null),
          el('div', { class: 'user-meta' }, `${u.username} · ${ROLE_LABEL[u.role]}${u.active ? '' : ' · deactivated'}`),
          el('div', { class: 'user-meta' }, u.last_login_at ? `Last sign-in ${fmtDate(u.last_login_at)}` : 'Never signed in')),
        el('div', { class: 'row-actions' },
          el('button', { class: 'btn small ghost', type: 'button', onclick: () => editUser(u) }, 'Edit'),
          !self && el('button', { class: 'btn small ghost', type: 'button', onclick: () => toggleUser(u) }, u.active ? 'Deactivate' : 'Activate'),
          !self && el('button', { class: 'btn small ghost del', type: 'button', onclick: () => deleteUser(u) }, 'Delete')));
    }));
  }

  function addUser() {
    openForm({
      title: 'Add user', submitLabel: 'Add',
      fields: [
        { name: 'username', label: 'Username', required: true, max: 64, hint: 'Letters, numbers, dot, dash, underscore or @.' },
        { name: 'display_name', label: 'Display name', max: 200 },
        { name: 'role', label: 'Role', options: ROLE_OPTIONS },
        { name: 'password', label: 'Password', type: 'password', required: true, minLength: 10, autocomplete: 'new-password', hint: 'At least 10 characters. Share it with the person privately.' },
      ],
      values: { role: 'viewer' },
      onSubmit: async (data) => { await api('POST', '/api/users', data); toast('User added.'); await openUsers(); },
    });
  }

  function editUser(u) {
    openForm({
      title: `Edit ${u.username}`,
      fields: [
        { name: 'display_name', label: 'Display name', max: 200 },
        { name: 'role', label: 'Role', options: ROLE_OPTIONS },
        { name: 'password', label: 'New password', type: 'password', minLength: 10, autocomplete: 'new-password', hint: 'Leave empty to keep the current password. Setting one signs the user out.' },
      ],
      values: { display_name: u.display_name, role: u.role },
      onSubmit: async (data) => {
        if (!data.password) delete data.password;
        await api('PUT', `/api/users/${u.id}`, data);
        toast('User updated.');
        if (u.id === state.me.id) state.me = (await api('GET', '/api/me')).user;
        await openUsers();
      },
    });
  }

  async function toggleUser(u) {
    await api('PUT', `/api/users/${u.id}`, { active: !u.active });
    toast(u.active ? 'User deactivated and signed out.' : 'User activated.');
    await openUsers();
  }

  async function deleteUser(u) {
    const ok = await confirmDelete({
      title: 'Delete user',
      message: [el('p', { dir: 'auto' }, 'Delete user ', el('strong', null, u.username), '? They will no longer be able to sign in.'), el('p', null, 'Directory records are not affected.')],
    });
    if (!ok) return;
    await api('DELETE', `/api/users/${u.id}`);
    toast('User deleted.');
    await openUsers();
  }

  $('#add-user').addEventListener('click', addUser);

  // ---------- wiring ----------
  window.addEventListener('unhandledrejection', (ev) => toast(ev.reason?.message || 'Something went wrong.', 'warn'));
  $('#add-entity').addEventListener('click', addEntity);
  $('#export-all').addEventListener('click', () => exportXlsx());
  $('#export-all-menu').addEventListener('click', () => { $('.menu').open = false; exportXlsx(); });
  $('#expand-all').addEventListener('click', () => setAll(false));
  $('#collapse-all').addEventListener('click', () => setAll(true));
  document.addEventListener('click', (ev) => { const m = $('.menu'); if (m.open && !m.contains(ev.target)) m.open = false; });
  let searchTimer;
  $('#search').addEventListener('input', (ev) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = ev.target.value; load(); }, 200);
  });

  $('#manage-users').addEventListener('click', () => { $('.menu').open = false; openUsers(); });
  $('#change-password').addEventListener('click', () => { $('.menu').open = false; changePassword(); });
  $('#sign-out').addEventListener('click', signOut);
  $('#login-form').addEventListener('submit', signIn);

  boot();
})();
