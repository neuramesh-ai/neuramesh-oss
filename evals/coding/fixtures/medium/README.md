# TaskGarden

Build a polished, responsive task tracker using browser JavaScript and CSS, without dependencies. The preview server serves `/` from `public/index.html`, plus `/public/*` and `/src/*`. Use absolute module URLs such as `/src/tasks.mjs`. Keep all application code inside public/ and src/.

Domain API in src/tasks.mjs (pure functions; never mutate the input):
- `addTask(tasks, title, id)` returns a new array with `{id,title,completed:false}` appended. Trim title; reject empty titles and duplicate IDs with an error.
- `toggleTask(tasks,id)` toggles exactly that item; unknown IDs leave the list unchanged.
- `visibleTasks(tasks,filter)` supports `all`, `active`, `completed`, preserving order.

UI contract:
- Heading TaskGarden; input labelled "Task title"; button "Add task".
- Filter buttons "All", "Active", "Completed"; every task has a checkbox labelled "Complete TITLE".
- Show validation feedback with role=alert; render user text safely.
- Persist tasks in localStorage key `taskgarden.tasks`; recover gracefully from malformed stored data. Reload retains tasks.
- Responsive layout with an empty state and a visible remaining-task count.

Add meaningful Node tests and run `npm test`. Document usage. The eval runner owns the preview server; do not start a server, install dependencies, commit or push. Change only public/, src/, test/ and README.md.
