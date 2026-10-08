CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password TEXT NOT NULL,

  hourly_rate NUMERIC(10, 2) NOT NULL,
  max_capacity_hours NUMERIC(6, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT users_email_not_blank CHECK (length(trim(email)) > 0),
  CONSTRAINT users_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT users_hourly_rate_positive CHECK (hourly_rate > 0),
  CONSTRAINT users_max_capacity_positive CHECK (max_capacity_hours > 0)
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
