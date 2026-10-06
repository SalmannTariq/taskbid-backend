export type AuthUser = {
    id: number;
    email: string;
    role?: string;
}

export type User = {
    id: number;
    name: string;
    email: string;
    hourly_rate: number;
    max_capacity_hours: number;
    created_at: Date;
}

