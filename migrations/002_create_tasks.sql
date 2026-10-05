CREATE TABLE tasks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_by BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  estimated_complexity SMALLINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  deadline TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tasks_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT tasks_complexity_range CHECK (estimated_complexity BETWEEN 1 AND 5),
  CONSTRAINT tasks_status_check CHECK (status IN ('open', 'assigned', 'completed', 'cancelled'))
);

CREATE INDEX tasks_created_by_idx ON tasks (created_by);
CREATE INDEX tasks_status_idx ON tasks (status);
