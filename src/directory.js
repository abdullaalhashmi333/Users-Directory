'use strict';

const { key } = require('./db');

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const LIMITS = { name: 200, title: 200, email: 254, remarks: 5000 };

class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function now() {
  return new Date().toISOString();
}

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).normalize('NFC').trim();
}

function required(value, label, max) {
  const v = clean(value).replace(/\s+/g, ' ');
  if (!v) throw new AppError(400, `${label} is required.`, { field: label.toLowerCase() });
  if (v.length > max) throw new AppError(400, `${label} must be at most ${max} characters.`, { field: label.toLowerCase() });
  return v;
}

function isValidEmail(email) {
  return EMAIL_RE.test(email);
}

function createDirectory(db) {
  const q = (sql) => db.prepare(sql);

  function getEntity(id) {
    const row = q('SELECT id, name, created_at, updated_at FROM entities WHERE id = ?').get(Number(id));
    if (!row) throw new AppError(404, 'Entity not found.');
    return row;
  }

  function getDepartment(id) {
    const row = q('SELECT id, entity_id, name, created_at, updated_at FROM departments WHERE id = ?').get(Number(id));
    if (!row) throw new AppError(404, 'Department not found.');
    return row;
  }

  function getFocalPoint(id) {
    const row = q(`SELECT id, department_id, name, title, email, remarks, created_at, updated_at
                   FROM focal_points WHERE id = ?`).get(Number(id));
    if (!row) throw new AppError(404, 'Focal point not found.');
    return row;
  }

  function assertEntityNameFree(name, exceptId = 0) {
    const clash = q('SELECT id FROM entities WHERE name_key = ? AND id <> ?').get(key(name), Number(exceptId));
    if (clash) throw new AppError(409, `An entity named "${name}" already exists.`, { field: 'name' });
  }

  function assertDepartmentNameFree(entityId, name, exceptId = 0) {
    const clash = q('SELECT id FROM departments WHERE entity_id = ? AND name_key = ? AND id <> ?')
      .get(Number(entityId), key(name), Number(exceptId));
    if (clash) throw new AppError(409, `This entity already has a department named "${name}".`, { field: 'name' });
  }

  function focalPointInput(body) {
    const name = required(body.name, 'Name', LIMITS.name);
    const title = required(body.title, 'Title', LIMITS.title);
    const email = required(body.email, 'Email', LIMITS.email);
    if (!isValidEmail(email)) throw new AppError(400, 'Email format is not valid (example: name@example.com).', { field: 'email' });
    const remarks = clean(body.remarks).replace(/\r\n/g, '\n');
    if (remarks.length > LIMITS.remarks) throw new AppError(400, `Remarks must be at most ${LIMITS.remarks} characters.`, { field: 'remarks' });
    return { name, title, email, remarks };
  }

  // Other focal points that use the same email (case-insensitive). Used to warn, never to block.
  function emailDuplicates(email, exceptId = 0) {
    const k = key(email || '');
    if (!k) return [];
    return q(`SELECT f.id, f.name, f.email, d.id AS department_id, d.name AS department, e.id AS entity_id, e.name AS entity
              FROM focal_points f
              JOIN departments d ON d.id = f.department_id
              JOIN entities e ON e.id = d.entity_id
              WHERE f.email_key = ? AND f.id <> ?
              ORDER BY e.name_key, d.name_key, f.name`).all(k, Number(exceptId));
  }

  return {
    // ---- Entities ----
    createEntity(body) {
      const name = required(body.name, 'Name', LIMITS.name);
      assertEntityNameFree(name);
      const t = now();
      const r = q('INSERT INTO entities (name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name, key(name), t, t);
      return getEntity(r.lastInsertRowid);
    },
    updateEntity(id, body) {
      getEntity(id);
      const name = required(body.name, 'Name', LIMITS.name);
      assertEntityNameFree(name, id);
      q('UPDATE entities SET name = ?, name_key = ?, updated_at = ? WHERE id = ?').run(name, key(name), now(), Number(id));
      return getEntity(id);
    },
    deleteEntity(id) {
      const impact = this.entityImpact(id);
      q('DELETE FROM entities WHERE id = ?').run(Number(id));
      return impact;
    },
    entityImpact(id) {
      const entity = getEntity(id);
      const departments = q(`SELECT d.id, d.name, COUNT(f.id) AS focal_point_count
                             FROM departments d LEFT JOIN focal_points f ON f.department_id = d.id
                             WHERE d.entity_id = ? GROUP BY d.id ORDER BY d.name_key`).all(entity.id);
      const focalPoints = q(`SELECT f.id, f.name, f.email, d.name AS department
                             FROM focal_points f JOIN departments d ON d.id = f.department_id
                             WHERE d.entity_id = ? ORDER BY d.name_key, f.name`).all(entity.id);
      return { entity, departments, focalPoints };
    },

    // ---- Departments ----
    createDepartment(entityId, body) {
      getEntity(entityId);
      const name = required(body.name, 'Name', LIMITS.name);
      assertDepartmentNameFree(entityId, name);
      const t = now();
      const r = q('INSERT INTO departments (entity_id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(Number(entityId), name, key(name), t, t);
      return getDepartment(r.lastInsertRowid);
    },
    updateDepartment(id, body) {
      const dept = getDepartment(id);
      const name = required(body.name, 'Name', LIMITS.name);
      assertDepartmentNameFree(dept.entity_id, name, id);
      q('UPDATE departments SET name = ?, name_key = ?, updated_at = ? WHERE id = ?').run(name, key(name), now(), Number(id));
      return getDepartment(id);
    },
    deleteDepartment(id) {
      const impact = this.departmentImpact(id);
      q('DELETE FROM departments WHERE id = ?').run(Number(id));
      return impact;
    },
    departmentImpact(id) {
      const department = getDepartment(id);
      const focalPoints = q('SELECT id, name, email FROM focal_points WHERE department_id = ? ORDER BY name').all(department.id);
      return { department, focalPoints };
    },

    // ---- Focal points ----
    createFocalPoint(departmentId, body) {
      getDepartment(departmentId);
      const fp = focalPointInput(body);
      const t = now();
      const r = q(`INSERT INTO focal_points (department_id, name, title, email, email_key, remarks, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(Number(departmentId), fp.name, fp.title, fp.email, key(fp.email), fp.remarks, t, t);
      const focalPoint = getFocalPoint(r.lastInsertRowid);
      return { focalPoint, duplicateEmails: emailDuplicates(fp.email, focalPoint.id) };
    },
    updateFocalPoint(id, body) {
      const existing = getFocalPoint(id);
      const fp = focalPointInput(body);
      // Optionally move to another department.
      const departmentId = body.department_id ? getDepartment(body.department_id).id : existing.department_id;
      q(`UPDATE focal_points SET department_id = ?, name = ?, title = ?, email = ?, email_key = ?, remarks = ?, updated_at = ?
         WHERE id = ?`).run(departmentId, fp.name, fp.title, fp.email, key(fp.email), fp.remarks, now(), Number(id));
      return { focalPoint: getFocalPoint(id), duplicateEmails: emailDuplicates(fp.email, id) };
    },
    deleteFocalPoint(id) {
      const fp = getFocalPoint(id);
      q('DELETE FROM focal_points WHERE id = ?').run(Number(id));
      return fp;
    },
    getFocalPoint,
    emailDuplicates,

    // ---- Tree and search ----
    // Returns entities -> departments -> focal points. With a search term, an entity
    // or department whose name matches keeps all its children; otherwise only
    // matching focal points (and their parents) are kept.
    tree({ search = '', entityId } = {}) {
      const entities = entityId
        ? [getEntity(entityId)]
        : q('SELECT id, name, created_at, updated_at FROM entities ORDER BY name_key').all();
      const depts = q('SELECT id, entity_id, name, created_at, updated_at FROM departments ORDER BY name_key').all();
      const fps = q(`SELECT id, department_id, name, title, email, remarks, created_at, updated_at
                     FROM focal_points ORDER BY name`).all();

      const emailCounts = new Map();
      for (const f of fps) {
        f.email_key = key(f.email);
        emailCounts.set(f.email_key, (emailCounts.get(f.email_key) || 0) + 1);
      }
      const fpsByDept = new Map();
      for (const f of fps) {
        f.email_duplicates = emailCounts.get(f.email_key) - 1;
        delete f.email_key;
        if (!fpsByDept.has(f.department_id)) fpsByDept.set(f.department_id, []);
        fpsByDept.get(f.department_id).push(f);
      }
      const deptsByEntity = new Map();
      for (const d of depts) {
        if (!deptsByEntity.has(d.entity_id)) deptsByEntity.set(d.entity_id, []);
        deptsByEntity.get(d.entity_id).push({ ...d, focal_points: fpsByDept.get(d.id) || [] });
      }

      const term = key(search);
      const matches = (...fields) => fields.some((f) => key(f || '').includes(term));
      const result = [];
      for (const e of entities) {
        const departments = deptsByEntity.get(e.id) || [];
        if (!term || matches(e.name)) {
          result.push({ ...e, departments });
          continue;
        }
        const kept = [];
        for (const d of departments) {
          if (matches(d.name)) {
            kept.push(d);
            continue;
          }
          const fpsKept = d.focal_points.filter((f) => matches(f.name, f.title, f.email, f.remarks));
          if (fpsKept.length) kept.push({ ...d, focal_points: fpsKept });
        }
        if (kept.length) result.push({ ...e, departments: kept });
      }
      return result;
    },

    stats() {
      return {
        entities: q('SELECT COUNT(*) AS n FROM entities').get().n,
        departments: q('SELECT COUNT(*) AS n FROM departments').get().n,
        focalPoints: q('SELECT COUNT(*) AS n FROM focal_points').get().n,
      };
    },

    clearAll() {
      db.exec('DELETE FROM focal_points; DELETE FROM departments; DELETE FROM entities;');
    },

    transaction(fn) {
      db.exec('BEGIN');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

module.exports = { createDirectory, AppError, isValidEmail };
