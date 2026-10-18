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

// Route ids arrive as strings; anything that is not a positive integer is simply "not found".
function id(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function isUniqueViolation(err) {
  return err && err.code === '23505';
}

// `db` is a pg Pool or a client inside a transaction; both expose query().
function createDirectory(db) {
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const all = async (sql, params) => (await db.query(sql, params)).rows;

  async function getEntity(entityId) {
    const row = await one('SELECT id, name, created_at, updated_at FROM entities WHERE id = $1', [id(entityId)]);
    if (!row) throw new AppError(404, 'Entity not found.');
    return row;
  }

  async function getDepartment(deptId) {
    const row = await one('SELECT id, entity_id, name, created_at, updated_at FROM departments WHERE id = $1', [id(deptId)]);
    if (!row) throw new AppError(404, 'Department not found.');
    return row;
  }

  async function getFocalPoint(fpId) {
    const row = await one(`SELECT id, department_id, name, title, email, remarks, created_at, updated_at
                           FROM focal_points WHERE id = $1`, [id(fpId)]);
    if (!row) throw new AppError(404, 'Focal point not found.');
    return row;
  }

  function entityNameTaken(name) {
    return new AppError(409, `An entity named "${name}" already exists.`, { field: 'name' });
  }

  function departmentNameTaken(name) {
    return new AppError(409, `This entity already has a department named "${name}".`, { field: 'name' });
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
  async function emailDuplicates(email, exceptId = 0) {
    const k = key(email || '');
    if (!k) return [];
    return all(`SELECT f.id, f.name, f.email, d.id AS department_id, d.name AS department, e.id AS entity_id, e.name AS entity
                FROM focal_points f
                JOIN departments d ON d.id = f.department_id
                JOIN entities e ON e.id = d.entity_id
                WHERE f.email_key = $1 AND f.id <> $2
                ORDER BY e.name_key, d.name_key, f.name`, [k, id(exceptId)]);
  }

  async function entityImpact(entityId) {
    const entity = await getEntity(entityId);
    const departments = await all(`SELECT d.id, d.name, COUNT(f.id)::int AS focal_point_count
                                   FROM departments d LEFT JOIN focal_points f ON f.department_id = d.id
                                   WHERE d.entity_id = $1 GROUP BY d.id ORDER BY d.name_key`, [entity.id]);
    const focalPoints = await all(`SELECT f.id, f.name, f.email, d.name AS department
                                   FROM focal_points f JOIN departments d ON d.id = f.department_id
                                   WHERE d.entity_id = $1 ORDER BY d.name_key, f.name`, [entity.id]);
    return { entity, departments, focalPoints };
  }

  async function departmentImpact(deptId) {
    const department = await getDepartment(deptId);
    const focalPoints = await all('SELECT id, name, email FROM focal_points WHERE department_id = $1 ORDER BY name', [department.id]);
    return { department, focalPoints };
  }

  return {
    // ---- Entities ----
    async createEntity(body) {
      const name = required(body.name, 'Name', LIMITS.name);
      try {
        return await one(`INSERT INTO entities (name, name_key) VALUES ($1, $2)
                          RETURNING id, name, created_at, updated_at`, [name, key(name)]);
      } catch (err) {
        if (isUniqueViolation(err)) throw entityNameTaken(name);
        throw err;
      }
    },
    async updateEntity(entityId, body) {
      await getEntity(entityId);
      const name = required(body.name, 'Name', LIMITS.name);
      try {
        return await one(`UPDATE entities SET name = $1, name_key = $2, updated_at = now() WHERE id = $3
                          RETURNING id, name, created_at, updated_at`, [name, key(name), id(entityId)]);
      } catch (err) {
        if (isUniqueViolation(err)) throw entityNameTaken(name);
        throw err;
      }
    },
    async deleteEntity(entityId) {
      const impact = await entityImpact(entityId);
      await db.query('DELETE FROM entities WHERE id = $1', [impact.entity.id]);
      return impact;
    },
    entityImpact,

    // ---- Departments ----
    async createDepartment(entityId, body) {
      const entity = await getEntity(entityId);
      const name = required(body.name, 'Name', LIMITS.name);
      try {
        return await one(`INSERT INTO departments (entity_id, name, name_key) VALUES ($1, $2, $3)
                          RETURNING id, entity_id, name, created_at, updated_at`, [entity.id, name, key(name)]);
      } catch (err) {
        if (isUniqueViolation(err)) throw departmentNameTaken(name);
        throw err;
      }
    },
    async updateDepartment(deptId, body) {
      await getDepartment(deptId);
      const name = required(body.name, 'Name', LIMITS.name);
      try {
        return await one(`UPDATE departments SET name = $1, name_key = $2, updated_at = now() WHERE id = $3
                          RETURNING id, entity_id, name, created_at, updated_at`, [name, key(name), id(deptId)]);
      } catch (err) {
        if (isUniqueViolation(err)) throw departmentNameTaken(name);
        throw err;
      }
    },
    async deleteDepartment(deptId) {
      const impact = await departmentImpact(deptId);
      await db.query('DELETE FROM departments WHERE id = $1', [impact.department.id]);
      return impact;
    },
    departmentImpact,

    // ---- Focal points ----
    async createFocalPoint(deptId, body) {
      const dept = await getDepartment(deptId);
      const fp = focalPointInput(body);
      const focalPoint = await one(`INSERT INTO focal_points (department_id, name, title, email, email_key, remarks)
                                    VALUES ($1, $2, $3, $4, $5, $6)
                                    RETURNING id, department_id, name, title, email, remarks, created_at, updated_at`,
      [dept.id, fp.name, fp.title, fp.email, key(fp.email), fp.remarks]);
      return { focalPoint, duplicateEmails: await emailDuplicates(fp.email, focalPoint.id) };
    },
    async updateFocalPoint(fpId, body) {
      const existing = await getFocalPoint(fpId);
      const fp = focalPointInput(body);
      // Optionally move to another department.
      const departmentId = body.department_id ? (await getDepartment(body.department_id)).id : existing.department_id;
      const focalPoint = await one(`UPDATE focal_points
                                    SET department_id = $1, name = $2, title = $3, email = $4, email_key = $5, remarks = $6, updated_at = now()
                                    WHERE id = $7
                                    RETURNING id, department_id, name, title, email, remarks, created_at, updated_at`,
      [departmentId, fp.name, fp.title, fp.email, key(fp.email), fp.remarks, existing.id]);
      return { focalPoint, duplicateEmails: await emailDuplicates(fp.email, existing.id) };
    },
    async deleteFocalPoint(fpId) {
      const fp = await getFocalPoint(fpId);
      await db.query('DELETE FROM focal_points WHERE id = $1', [fp.id]);
      return fp;
    },
    getFocalPoint,
    emailDuplicates,

    // ---- Tree and search ----
    // Returns entities -> departments -> focal points. With a search term, an entity
    // or department whose name matches keeps all its children; otherwise only
    // matching focal points (and their parents) are kept.
    async tree({ search = '', entityId } = {}) {
      const entities = entityId
        ? [await getEntity(entityId)]
        : await all('SELECT id, name, created_at, updated_at FROM entities ORDER BY name_key');
      const depts = await all('SELECT id, entity_id, name, created_at, updated_at FROM departments ORDER BY name_key');
      const fps = await all(`SELECT id, department_id, name, title, email, email_key, remarks, created_at, updated_at
                             FROM focal_points ORDER BY name`);

      const emailCounts = new Map();
      for (const f of fps) emailCounts.set(f.email_key, (emailCounts.get(f.email_key) || 0) + 1);
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

    async stats() {
      return one(`SELECT (SELECT COUNT(*) FROM entities)::int AS entities,
                         (SELECT COUNT(*) FROM departments)::int AS departments,
                         (SELECT COUNT(*) FROM focal_points)::int AS "focalPoints"`);
    },
  };
}

// Runs fn(directory) inside one transaction on a dedicated client.
async function inTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(createDirectory(client), client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createDirectory, inTransaction, AppError, isValidEmail, clean, id, isUniqueViolation };
