export type PendingBid = {
  id: string;
  user_id: string;
  hours_offered: string;
};

export type BidRow = {
  id: string;
  task_id: string;
  user_id: string;
  hours_offered: string;
  status: string;
  created_at: Date;
};

export type CapacityFitRow = {
  fits: boolean;
};

export type BidIdRow = {
  id: string;
};

export type TaskStatusRow = {
  status: string;
};
