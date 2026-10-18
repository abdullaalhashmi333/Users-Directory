# Users Directory — User Manual

The Users Directory lists **entities**, the **departments** inside each entity, and the
**focal points** (contact people) in each department.

```
Entity → Departments → Focal Points
```

> **Test mode.** The system currently holds made-up sample data only. A yellow banner at the
> top says so. Do not enter real personal data until the system has been switched to
> production rules.

## The main screen

Everything is on one screen: each entity is a card, its departments are inside it, and each
department shows its focal points. The line under the header shows totals.

- Tap the **▾** arrow (or the name) on an entity or department to collapse or expand it.
  The app remembers what you collapsed on that device.
- **⋯ → Expand all / Collapse all** opens or closes everything at once.
- Each focal point shows name, title, email (tap to write an email), remarks, and when the
  record was created and last updated.
- A small yellow **"also used … elsewhere"** tag means the same email belongs to another
  focal point too.

## Adding and editing

| To do this | Use |
|---|---|
| Add an entity | **+ Entity** in the header |
| Add a department | **+ Department** on the entity card |
| Add a focal point | **+ Focal point** on the department |
| Change a record | **Edit** next to it |

Rules the form checks:

- **Entity name**: required, and no two entities can share a name (capital letters and extra
  spaces are ignored when comparing).
- **Department name**: required, and unique within its entity. Two different entities may
  both have, say, a "Finance" department.
- **Focal point**: Name, Title and Email are required; Remarks is optional and can have
  several lines. The email must look like `name@example.com`.
- If the email is already used by another focal point, the form shows a yellow warning
  listing who uses it. You can still save; it is a warning, not a block.

Arabic and English both work in every field, including mixed text. Each field and line
follows the direction of the text you type.

## Deleting

Every **Delete** asks for confirmation first.

- Deleting a **department** that still has focal points shows a warning listing every focal
  point that will be removed.
- Deleting an **entity** shows every department and focal point inside it that will be
  removed.
- Press **Cancel** to keep everything. Deletes cannot be undone.

## Searching

Type in the search box at the top. The search covers entity names, department names,
focal point names, titles, emails and remarks, in Arabic or English, and ignores capital
letters. Matches are highlighted.

- If an entity or department name matches, it is shown with everything inside it.
- If only a person matches, you see just that person under their entity and department.
- Clear the box to see the full directory again.

## Exporting to Excel

- **Export Excel** in the header downloads the whole directory (on a small phone it is in
  the **⋯** menu).
- **Export** on an entity card downloads only that entity.

The file has one row per focal point with columns Entity, Department, Focal Point Name,
Title, Email, Remarks, Created and Last Updated. Departments without focal points still
appear as a row. The header row is frozen and has filters.

## Resetting the sample data (test mode only)

**⋯ → Reset to sample data** deletes everything and reloads the made-up sample data. It asks
for confirmation first. This option disappears once the system is in production mode.
