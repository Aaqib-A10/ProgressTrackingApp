# Decisions (Projects + Chat)

* **Polling instead of websockets.** Production sits behind Nginx with no websocket upgrade config. Short polling
  (5 s board, 2.5 s open chat) gives a live feel and deploys with the normal `deploy` script. Presence and typing live in
  memory because the API runs as one PM2 process. If the API is ever clustered, move them to Postgres or Redis.
* **Reuse, don't duplicate.** Users, roles, the Notification table + bell, Resend email, the raw-upload pattern and
  `uploads/` folder, Luxon timezone helpers and the dnd-kit dependency are all reused.
* **Model names prefixed `Pm` / `Chat`** so nothing collides with the Marketing and Ecommerce boards (`TaskStatus`,
  `MarketingTask`, etc.). The existing `Priority` enum is reused.
* **Ordering** uses a float rank (midpoint between neighbours) so a drag rewrites one row; the column is renumbered only
  when the gap gets too small.
* **Column categories** (To do / In progress / Done) drive completion and overdue logic, so teams can rename or add
  columns freely.
* **Super Admins see every project** and get overdue alerts for all of them by default. Turn this off or limit it to
  named people with `PM_SUPER_ADMIN_OVERDUE_ALERTS`.
* **Project admins and the creator** of a project are added as project Admins automatically. A project always keeps at
  least one admin.
* **Removing a member** also removes them from the project's tasks (assignee and watcher) and from its # channel, so they
  stop getting alerts for a project they can no longer open.
* **Chat emails** are limited to @mentions (no per-message email digests) to keep inboxes quiet. The chat badge covers
  unread messages.
* **Inventory-only users** (who normally see only the Inventory menu) also see the Projects menu, because projects are
  membership based and they may be added to one.
* **Out of scope for v1**: sprints, time tracking, recurring tasks, dependencies, guests, calendar view, web push,
  reactions, voice/video.
