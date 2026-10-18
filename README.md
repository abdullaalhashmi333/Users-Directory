# Users Directory

A directory of entities, their departments, and the focal point(s) in each department.
Works on mobile and desktop, in Arabic and English. Data is stored in PostgreSQL; sign-in with Viewer, Editor and Admin roles.

- [User manual](docs/USER_MANUAL.md)
- [Deployment guide](docs/DEPLOYMENT.md)

```bash
npm install
DATABASE_URL=postgres://... ADMIN_USERNAME=admin ADMIN_PASSWORD=change-me-please npm start
npm test    # needs PostgreSQL, see docs/DEPLOYMENT.md
```
