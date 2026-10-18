'use strict';

// Made-up sample data for test mode only. All people are fictional and all
// emails use the reserved example.com / example.org domains.
const SAMPLE = [
  {
    name: 'Northwind Health Authority',
    departments: [
      {
        name: 'Digital Services',
        focal_points: [
          { name: 'Layla Haddad', title: 'Head of Digital Services', email: 'layla.haddad@northwind.example.com', remarks: 'Main contact for portal integrations.\nPrefers email over phone.' },
          { name: 'Omar Fadel', title: 'Systems Analyst', email: 'omar.fadel@northwind.example.com', remarks: '' },
        ],
      },
      {
        name: 'Finance',
        focal_points: [
          { name: 'Sara Mansour', title: 'Budget Officer', email: 'sara.mansour@northwind.example.com', remarks: 'Handles quarterly reporting.' },
        ],
      },
      { name: 'Procurement', focal_points: [] },
    ],
  },
  {
    name: 'هيئة المثال للنقل',
    departments: [
      {
        name: 'إدارة العمليات',
        focal_points: [
          { name: 'خالد الراشد', title: 'مدير العمليات', email: 'khaled.alrashed@transport.example.org', remarks: 'نقطة الاتصال الرئيسية للمشاريع المشتركة.\nمتاح من الأحد إلى الخميس.' },
          { name: 'مريم السالم', title: 'منسقة مشاريع', email: 'maryam.alsalem@transport.example.org', remarks: '' },
        ],
      },
      {
        name: 'الموارد البشرية',
        focal_points: [
          { name: 'Ahmed Noor', title: 'HR Business Partner', email: 'ahmed.noor@transport.example.org', remarks: 'يتحدث العربية والإنجليزية / Speaks Arabic and English.' },
        ],
      },
    ],
  },
  {
    name: 'Contoso Education Council',
    departments: [
      {
        name: 'Curriculum Development',
        focal_points: [
          { name: 'Daniel Reyes', title: 'Curriculum Lead', email: 'daniel.reyes@contoso.example.com', remarks: '' },
          { name: 'Noura Khalil', title: 'Assessment Specialist', email: 'noura.khalil@contoso.example.com', remarks: 'Also covers exam scheduling.' },
          { name: 'Priya Raman', title: 'Research Coordinator', email: 'priya.raman@contoso.example.com', remarks: '' },
        ],
      },
      {
        name: 'Partnerships',
        focal_points: [
          // Same email as in Digital Services above, to demonstrate the duplicate-email warning.
          { name: 'Layla Haddad', title: 'Partnerships Liaison (secondment)', email: 'layla.haddad@northwind.example.com', remarks: 'Seconded from Northwind Health Authority.' },
        ],
      },
    ],
  },
  {
    name: 'مجلس الابتكار التجريبي',
    departments: [
      {
        name: 'Innovation Lab / مختبر الابتكار',
        focal_points: [
          { name: 'يوسف عبدالله', title: 'Lab Manager / مدير المختبر', email: 'yousef.abdullah@innovation.example.org', remarks: 'Bilingual sample record.\nسجل تجريبي بلغتين.' },
        ],
      },
    ],
  },
];

function insertSample(directory) {
  for (const e of SAMPLE) {
    const entity = directory.createEntity({ name: e.name });
    for (const d of e.departments) {
      const dept = directory.createDepartment(entity.id, { name: d.name });
      for (const fp of d.focal_points) directory.createFocalPoint(dept.id, fp);
    }
  }
  return directory.stats();
}

function seedSampleData(directory) {
  return directory.transaction(() => insertSample(directory));
}

// Replaces everything with the sample data (test mode only).
function resetSampleData(directory) {
  return directory.transaction(() => {
    directory.clearAll();
    return insertSample(directory);
  });
}

module.exports = { SAMPLE, seedSampleData, resetSampleData };
