

TaskBid is a small API where:

1. Someone **posts a task**.
2. Other people **bid**, saying how many hours they would take.
3. The **lowest bid wins**, as long as that person still has free time.
4. The task then moves through its steps until it is done.

The work is split between two parts:

- **Postgres (the database)** enforces the rules that must always be true, no matter who writes the data.
- **Express (the API)** checks that requests look correct, runs the database work, and turns database errors into proper HTTP responses.

## How to run it

```bash
npm install
npm run migrate
npm run dev
```

- `migrate` runs each SQL file in `migrations/` once and remembers which ones it already ran (in a table called `schema_migrations`).
- `dev` starts the server and restarts it when you save a file.

Settings the app reads:

| Setting | Meaning |
|---|---|
| `DB_URL` | Database connection address |
| `PORT` | Server port (default 3000) |
| `CORS_WHITELIST` | Websites allowed to call the API (comma-separated) |

## Routes

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Checks the server and database are alive |
| GET | `/users` | Lists users (id, name, email) |
| GET | `/users/:id/workload` | Shows a user's current hours, max hours, and hours left |
| GET | `/tasks` | Lists tasks with creator, assignee, number of bids, and lowest bid |
| POST | `/tasks` | Creates a new task (starts as a draft) |
| PATCH | `/tasks/:id/status` | Moves a task one allowed step forward |
| POST | `/tasks/:id/assign` | Gives the task to the cheapest bidder who still has time |
| POST | `/tasks/:id/bids` | Places a bid |
| GET | `/tasks/:id/bids` | Lists a task's bids, cheapest first |
| GET | `/dashboard/stats` | Counts and averages for a dashboard |

**Task steps, always in this order:**

`draft → open → bidding_closed → assigned → in_progress → review → done`

Only `POST /tasks/:id/assign` can set `assigned`. When a deadline passes, a timer does the same close-and-assign automatically.

## Tech choices

**Express + TypeScript + `pg` (raw SQL, no ORM).** The important behavior (row locks, triggers, a view, `set_config`) is database-level. An ORM would hide those or make you write raw SQL anyway. Express is enough because each resource has one router file.

**`tsx` runs the TypeScript directly**, so there is no `dist` build folder. The types in `contract/` only describe what a query returns. They are not a second copy of the table design.

**Migrations are plain numbered `.sql` files.** They run in filename order, each inside its own transaction, and a file that already ran is skipped. Since the schema includes triggers and a view, it is easier to read the real SQL than a generated diff.

## Where each rule lives

**Rules about one row → `CHECK` constraints.** These need no extra lookup:

- name is not blank
- email looks like an email
- complexity is 1 to 5
- hours are positive
- status is one of the allowed words

**Rules that look at other rows → triggers.** The status trigger is in `002_create_tasks.sql`. The bid trigger and the one-bid unique index are in `003_create_bids.sql`:

1. You can't bid on your own task.
2. A bid can't be bigger than your remaining free hours.
3. You can only bid on an `open` task before its deadline.
4. A status can only move one step forward.
5. One user can bid only once per task (`UNIQUE (task_id, user_id)`).

**Why the database and not just the API?** Every write passes through the database: the API, the deadline timer, or a future script. If the rule lived only in `placeBid`, a direct `INSERT` could break it. The capacity check also locks the user's row, so two bids arriving at the same moment can't both pass when there is room for only one.

`placeBid` still checks that the ids and hours are well formed. Postgres raises the business-rule errors, and `sendDbError` turns them into 400 or 409 responses. Useful error codes:

| Code | Meaning |
|---|---|
| `23505` | Unique rule broken |
| `23503` | Missing foreign key |
| `23514` | `CHECK` failed |

**Deleting data:**

- Deleting a task also deletes its bids (cascade).
- Deleting a user is blocked (`RESTRICT`) if they are a creator, bidder, assignee, or audit actor, so history is never lost.

## Workload is calculated, not stored

You could store "remaining hours" as a column, but it can drift out of date. Instead, `user_workloads` is a **view**, a saved query that recalculates every time.

`current_workload` = the sum of `hours_offered` on bids where:

- the task is assigned to that user, **and**
- the task status is `assigned`, `in_progress`, or `review`.

`GET /users/:id/workload` reads this view and subtracts from max capacity. The bid trigger and the assign code use the same sum, so what the user sees is exactly what the database enforces.

## Assigning a bidder (one transaction)

The risk: two tasks both want the same person's last free hours. Reading and then updating without locks lets both succeed. So everything happens in one transaction with locks.

`POST /tasks/:id/assign` and the deadline closer follow the same steps:

1. **Lock the task row.** A second assign for the same task waits.
2. **Lock the task's bids**, ordered by lowest hours, then earliest bid.
3. **Lock each bidder's user row**, in user-id order, before reading capacity.
4. **Go through bids from lowest to highest.** Add the bid's hours to the person's already-assigned hours. If the total is over `max_capacity_hours`, skip that person.
5. **Save** `status = assigned` and `assigned_to` for the first bidder who fits.
6. **If it fails:**
   - no bids → 409 `task has no bids`
   - nobody fits → 409 `no bidder has enough remaining capacity`, and nothing changes

`withTransaction` starts the transaction, commits when done, rolls back on any error, and always returns the connection to the pool. So the status and the assignee can never be saved separately.

When two assigns compete for the same person, the second one waits. After the first commits, the second sees the new assignment and moves on to the next bidder. Locking users in id order stops two transactions from waiting on each other forever (a deadlock).

The deadline job follows the same steps but doesn't call the HTTP handler. It updates the row directly, so the status trigger still checks the step.

## Who can change a status

"Only the creator" and "only the assignee" depend on who is calling, and a trigger can't see the request body. So the split is:

- **Trigger:** rejects any jump that isn't the next step, even from a script.
- **Handler:** checks the person:
  - From `draft`, `open`, or `review` → `changedBy` must be the **creator**.
  - From `assigned` or `in_progress` → `changedBy` must be the **assignee**.
  - `bidding_closed` can't be a `PATCH` target. Assigning goes through `POST /tasks/:id/assign`, and only the creator can call it.
  - `PATCH` refuses `status: "assigned"`, because it would set a status without choosing an assignee.

The handler locks the task row before checking, so two patches can't both pass and overwrite each other.

## Audit history (written by a trigger)

`log_status_change` runs after every task status change and writes a row to `audit_log`. Because the deadline closer and `PATCH` both update `status`, both get a log row with no extra code.

The trigger needs to know **who** did it. The handler calls `setActor`, which runs `set_config('app.user_id', ..., true)`. The `true` makes the setting last only for this transaction, so the next request on the same pooled connection does not inherit it. If the setting is missing, the trigger raises an error and the status change is rolled back.

On a deadline close, the logged actor is the task creator, since the system is acting on their behalf.

## Deadlines are closed inside the API process

You could use `pg_cron`, a separate worker, or close on read. This project uses a timer in the API:

- `closeExpiredBidding` runs at startup and every 5 seconds.
- `GET /tasks` also calls it, so the list never shows `open` after the deadline.
- A `closing` flag skips a new run if the previous one is still working.
- The timer is `unref`'d, so it doesn't keep the process alive on its own.
- Each task closes in its **own transaction**, so one failure doesn't undo the others.
- A task becomes `bidding_closed`, then `assigned` if someone fits. If nobody fits, it stays `bidding_closed`, and the creator can call assign later when capacity frees up.

The **bid trigger is the real guard**. Even if the timer is late and the status still says `open`, a bid after the deadline is rejected.

## Real-time updates

Socket.IO is attached to the same HTTP server as Express, so REST and sockets share one port and the same CORS list.

After a create, bid, status change, assign, or deadline close, `publishChange` sends a `changed` event with `{ taskId }` to every connected client. Only the **id** is sent, not the full row. The client then refetches `GET /tasks` and `GET /tasks/:id/bids`, which already contain the joined data. This avoids keeping a second data shape in sync. There are no rooms, because every screen shows the same board.

## Dashboard

`GET /dashboard/stats` is **one SQL query** returning JSON:

- tasks by status
- average bid per complexity level
- top three users with `done` tasks
- tasks whose deadline passed with zero bids

`generate_series(1, 5)` makes sure complexity levels 1 to 5 always appear, even with no data. `COALESCE` turns empty results into `{}` or `[]`. The handler only renames fields to camelCase.

## JSON style

- **Request/response JSON** uses camelCase (`createdBy`, `hoursOffered`, `bidCount`).
- **Database tables** use snake_case.
- Postgres `BIGINT` and `NUMERIC` arrive as strings, so ids and hours go through `toNumber` before being sent.
- Handlers only check the **shape** of input (title present, complexity 1 to 5, valid date, positive id, hours above 0). Anything that depends on other rows is left to the triggers.

 
## Trade-offs

- The full rule isn't visible in the controller. Read the migrations next to the TypeScript:
  - `002_create_tasks.sql` and `003_create_bids.sql` for the rules
  - `004_create_audit_log.sql` for audit rows
  - `005_create_user_workloads.sql` for the workload sum
- Changing a rule needs a new migration, which is slower than editing a function.
- The API's error message must match the database's `RAISE EXCEPTION` text.
- Triggers are harder to spot in a stack trace than a normal `if`.

