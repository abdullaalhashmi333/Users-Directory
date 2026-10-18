'use strict';

const ExcelJS = require('exceljs');

const COLUMNS = [
  { header: 'Entity', key: 'entity', width: 32 },
  { header: 'Department', key: 'department', width: 30 },
  { header: 'Focal Point Name', key: 'name', width: 26 },
  { header: 'Title', key: 'title', width: 28 },
  { header: 'Email', key: 'email', width: 36 },
  { header: 'Remarks', key: 'remarks', width: 48 },
  { header: 'Created', key: 'created_at', width: 20 },
  { header: 'Last Updated', key: 'updated_at', width: 20 },
];

function fmt(iso) {
  return iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : '';
}

// One row per focal point; departments or entities without focal points still
// get a row so nothing in the directory is missing from the export.
function rowsFromTree(tree) {
  const rows = [];
  for (const e of tree) {
    if (!e.departments.length) {
      rows.push({ entity: e.name, created_at: fmt(e.created_at), updated_at: fmt(e.updated_at) });
      continue;
    }
    for (const d of e.departments) {
      if (!d.focal_points.length) {
        rows.push({ entity: e.name, department: d.name, created_at: fmt(d.created_at), updated_at: fmt(d.updated_at) });
        continue;
      }
      for (const f of d.focal_points) {
        rows.push({
          entity: e.name,
          department: d.name,
          name: f.name,
          title: f.title,
          email: f.email,
          remarks: f.remarks,
          created_at: fmt(f.created_at),
          updated_at: fmt(f.updated_at),
        });
      }
    }
  }
  return rows;
}

async function buildWorkbook(tree) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Users Directory';
  wb.created = new Date();
  const ws = wb.addWorksheet('Directory', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS;
  ws.addRows(rowsFromTree(tree));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  ws.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } };
  ws.eachRow((row) => {
    row.alignment = { vertical: 'top', wrapText: true };
  });
  return wb.xlsx.writeBuffer();
}

module.exports = { buildWorkbook, rowsFromTree, COLUMNS };
