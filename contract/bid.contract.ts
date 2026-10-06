export type BidOffer = {
  id: string;
  user_id: string;
  hours_offered: string;
};

export type BidRow = {
  id: string;
  task_id: string;
  user_id: string;
  hours_offered: string;
  created_at: Date;
  user_name?: string;
};

export type CapacityFitRow = {
  fits: boolean;
};

export type TaskStatusRow = {
  status: string;
};
