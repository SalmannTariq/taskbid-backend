CREATE TABLE bids (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  hours_offered NUMERIC(6, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bids_hours_positive CHECK (hours_offered > 0),
  CONSTRAINT bids_one_per_user_per_task UNIQUE (task_id, user_id)
);

CREATE INDEX bids_task_id_idx ON bids (task_id);
CREATE INDEX bids_user_id_idx ON bids (user_id);

CREATE UNIQUE INDEX bids_one_accepted_per_task
  ON bids (task_id)
  WHERE status = 'accepted';
