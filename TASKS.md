# Task List

## Backlog

1. **Start app when Windows starts**
   - Add option in settings for auto-launch at login.
   - Implement via Electron startup integration (`app.setLoginItemSettings`) and verify behavior on Windows 10/11.

2. **Persist default URL across PC restarts with robust storage**
   - Current persistence already uses `electron-store` (file-based JSON).
   - Add optional persistence layer using SQLite (or keep `electron-store` if confirmed sufficient).
   - Migrate existing stored settings safely.
