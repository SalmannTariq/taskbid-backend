# TaskBid API

People post tasks, others bid hours, and the lowest bid that still fits the bidder's capacity wins. Status then moves one step at a time from draft to done. Postgres holds the rules that must stay true no matter who writes the row. Express checks that the request is well formed, runs the write, and turns database errors into HTTP responses.

## Run

```bash
npm install
npm run migrate
npm run dev
```

`migrate` applies each file in `migrations/` once and records the name in `schema_migrations`. `dev` runs `index.ts` with `tsx` and restarts on save.

The process reads `DB_URL`, `PORT` (default 3000), and `CORS_WHITELIST` (comma-separated browser origins).

## Routes

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/health` | Confirms the process and Postgres are up |
| GET | `/users` | Lists id, name, email |
| GET | `/users/:id/workload` | Current hours, max capacity, remaining hours |
| GET | `/tasks` | Lists tasks with creator, assignee, bid count, lowest bid |
| POST | `/tasks` | Creates a draft |
| PATCH | `/tasks/:id/status` | Moves status one allowed step |
| POST | `/tasks/:id/assign` | Assigns the cheapest bidder who still has capacity |
| POST | `/tasks/:id/bids` | Places one bid |
| GET | `/tasks/:id/bids` | Lists that task's bids, cheapest first |
| GET | `/dashboard/stats` | Counts, average bids, top completers, tasks that got no bids |

A task status can only move `draft → open → bidding_closed → assigned → in_progress → review → done`. `POST /tasks/:id/assign` is the only request that sets `assigned`. When a deadline passes, a timer does that same close-and-assign itself.

## Express, TypeScript, and `pg`

A small JSON API can sit on Nest, Fastify, or a framework that generates the routes. It can also talk to Postgres through Prisma, TypeORM, or Drizzle.

This server is Express 5 plus TypeScript, and every query is a SQL string on `node-postgres`. The interesting behavior is not a controller method. It is `SELECT ... FOR UPDATE`, a trigger, a view, and `set_config`. An ORM would hide those, or force them out into raw queries anyway. Express is enough because there is one router file per resource and no module system to configure.

TypeScript runs through `tsx`, so dev and start do not compile to a `dist` folder. The types in `contract/` describe the rows a query returns. They are not a second model of the tables.

## Migrations are SQL files

Schema changes can live in an ORM migration, a query builder, or numbered `.sql` files.

Each change here is a file under `migrations/`, applied in filename order inside its own transaction. The runner skips a file whose name is already in `schema_migrations`. The schema includes triggers and a view, which are easier to read as the SQL Postgres will actually run than as a generated diff.

## Row shape is a `CHECK`. A rule about other rows is a trigger

A column rule can be a `CHECK`, an application `if`, or both. A rule that reads another table can be a trigger, a database function the handler calls, or code that runs before the `INSERT`.

Blank names, email shape, complexity 1–5, positive hours, and the status list are `CHECK` constraints. They look at one row and need no extra query.

Five rules look at other rows. The status trigger is in `migrations/002_create_tasks.sql`. The bid trigger and the one-bid unique index are in `migrations/003_create_bids.sql`:

- A user cannot bid on their own task.
- A bid larger than the user's remaining capacity is rejected.
- A bid cannot be inserted unless the task is `open` and the deadline is still in the future.
- A task status can only move one step forward.
- One user can place only one bid on a task (`UNIQUE (task_id, user_id)`).

The database is the last place every write goes through. The API, the deadline timer, or a future script all hit the same trigger. Putting the rule only in `placeBid` would leave a direct `INSERT` able to break it. The capacity check locks the user row inside the trigger, so two bids submitted at the same moment cannot both pass when only one of them fits.

`placeBid` still checks that the ids and hours are well formed, then inserts. Postgres raises the business-rule errors. `sendDbError` turns those exception strings into 400 or 409. Unique violations are SQLSTATE `23505`, missing foreign keys are `23503`, and failed checks are `23514`.

Deleting a task cascades to its bids. Deleting a user is `RESTRICT` wherever that user is a creator, bidder, assignee, or audit actor, so history is not removed by a user delete.

## Workload is a view

Remaining capacity can be a column updated on every assign, a counter in Redis, or a sum computed when it is read.

`user_workloads` is a view. `current_workload` is the sum of `hours_offered` on bids whose user is `tasks.assigned_to` and whose task is `assigned`, `in_progress`, or `review`. Setting `assigned_to` is what changes the sum. A stored number can drift from the tasks it is supposed to describe. The view cannot.

`GET /users/:id/workload` reads that view and subtracts. The bid trigger and the assign query use the same sum, so the number a user sees and the number a write enforces are the same calculation.

## Assigning a bidder is one transaction

Picking a winner can be "read the bids, then update" with no lock, an optimistic version column, or `SERIALIZABLE` isolation. Two of those still lose when two tasks want the same person's last free hours, unless both transactions lock that person before they read capacity.

`POST /tasks/:id/assign` and the deadline closer share one walk:

1. Lock the task row (`SELECT ... FOR UPDATE`). A second assign of the same task waits here.
2. Lock that task's bids, ordered by lowest hours, then earliest bid.
3. Lock every bidder's user row, in user id order, before reading capacity.
4. Walk the bids from lowest to highest. For each bidder, add this bid's hours to the hours already on their assigned work. If that total is above `max_capacity_hours`, skip them.
5. Write status `assigned` and `assigned_to` for the first bidder who still fits.
6. If the task has no bids, return 409 `task has no bids`. If nobody still fits, return 409 `no bidder has enough remaining capacity` and change no rows.

`withTransaction` begins, commits, and on any throw rolls back, then releases the pooled client. Status and assignee cannot be saved separately.

Two assigns on different tasks can want the same person's last free hours. Both lock that user row before they read remaining capacity, and they keep the lock until commit. The second call waits. After the first commit, its capacity query sees the new assignment. Locking users in id order keeps two transactions from locking the same people in opposite orders, which is how those two calls would deadlock.

The deadline job uses the same walk. It does not call the HTTP handler. It updates the row itself, so the trigger still checks the status step.

## Who may move a status stays in the handler

The allowed arrows can live only in the trigger, only in the handler, or in both. "Only the creator" and "only the assignee" need to know who called. A trigger does not see the HTTP body unless the handler passes that id in.

The trigger rejects any jump that is not the next step, including a jump from a script that forgot the check. The handler owns the person:

- From `draft`, `open`, or `review`, `changedBy` must be the creator.
- From `assigned` or `in_progress`, `changedBy` must be the assignee.
- `bidding_closed` is not a `PATCH` target. Assignment is `POST /tasks/:id/assign`, and only the creator can call it.
- The handler also refuses `status: "assigned"` on `PATCH`, because that path would set a status without choosing `assigned_to`.

The handler locks the task row before it checks the current status, so two patches cannot both pass the check and then overwrite each other.

## The audit row is written by a trigger

The status history can be an `INSERT` in each controller, or a trigger that runs on every status update.

`log_status_change` runs after a task status change and inserts into `audit_log`. The deadline closer and `PATCH` both update `tasks.status`, so both get a row without a second insert in TypeScript.

The trigger needs to know who did it. There is no user column on the `UPDATE`. The handler calls `setActor`, which runs `set_config('app.user_id', ..., true)`. The third argument makes the setting local to this transaction. The connection goes back to the pool after commit, and the next request on that connection does not inherit the previous actor. If the setting is missing, the trigger raises and the status change rolls back.

On deadline close, the actor stored is the task creator, because that close is the system acting for the task they posted.

## Deadlines are closed in this process

Expired bidding can be closed by `pg_cron`, a separate worker, or a timer in the API process. It can also be closed only when someone next reads the task.

`closeExpiredBidding` runs at startup and every 5 seconds. `GET /tasks` calls it too, so a list does not keep showing `open` after the deadline just because the timer has not fired. A `closing` flag drops a second run that starts while the first is still in the loop. The timer is `unref`'d so it does not keep the process alive by itself.

Each due task is its own transaction. One failure does not roll back the tasks already closed. Inside the transaction the status becomes `bidding_closed`, then `assigned` if some bidder still fits. If nobody fits, it stays `bidding_closed` and the creator can call `POST /tasks/:id/assign` later, when capacity has freed.

The bid trigger is the real guard. Even if the timer is late and the row still says `open`, an insert after `deadline <= NOW()` is rejected. The timer's job is to move the status and pick a winner, not to be the only thing stopping a late bid.

## Clients hear `changed` and refetch

A board can poll, use server-sent events, or open a websocket. The socket can push the new task, or it can push "this id changed."

Socket.IO is attached to the same HTTP server as Express, so REST and the socket share the port and the CORS whitelist. After a create, a bid, a status change, an assign, or a deadline close, `publishChange` emits `changed` with `{ taskId }` to every connected client. The payload is the id, not the row. The client already has `GET /tasks` and `GET /tasks/:id/bids`, and those responses are the ones that join users and bid totals. Pushing a partial row from the write would be a second shape to keep in step.

There are no rooms. Every screen shows the same board, so every client needs every task id.

## One dashboard query

Dashboard numbers can be four requests, or one SQL statement that returns JSON.

`GET /dashboard/stats` is one query. `jsonb_object_agg` and `jsonb_agg` build tasks-by-status, average bid by complexity, the top three users with `done` tasks, and zero-bid tasks whose deadline has passed. `generate_series(1, 5)` keeps complexities with no rows in the result, so the client always gets levels 1 through 5. `COALESCE` turns an empty aggregate into `{}` or `[]`. The handler only renames those fields to camelCase.

## Request JSON is camelCase. Tables are snake_case

The handler can return `pg` rows as-is, or map them.

Responses are mapped in the controller (`createdBy`, `hoursOffered`, `bidCount`). Postgres `BIGINT` and `NUMERIC` arrive as strings, so ids and hours go through `toNumber` before they are sent. Input is checked in the handler for shape only: present title, complexity 1–5, a real date, a positive id, hours greater than 0. Anything that depends on another row waits for the trigger.

## What is left in the request body

Login can be a session cookie, a JWT, or an id the client sends.

`users.password` exists, and bcrypt, jsonwebtoken, and cookie-parser are installed, but no route signs a token or reads a cookie yet. `createdBy`, `changedBy`, and `userId` come from the JSON body. That id is what `setActor` stores and what the creator/assignee checks compare. The triggers still reject an illegal bid or an illegal status jump. They do not prove the caller is that user. A later login can replace the body id with the id from a verified token without moving the rules out of Postgres.

## Trade-off that shows up everywhere

The controller does not show the full rule. You read `migrations/002_create_tasks.sql` and `migrations/003_create_bids.sql` next to the TypeScript. Audit rows are `migrations/004_create_audit_log.sql`. The workload sum is `migrations/005_create_user_workloads.sql`. Changing a rule means a new migration, which is slower than editing a function, and the API message has to stay in step with the `RAISE EXCEPTION` text. Triggers are also harder to see in a stack trace than a normal `if`. What you get back is one definition of the rule that still holds when the application code is bypassed.
