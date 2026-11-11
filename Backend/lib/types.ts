/** Database row shapes (snake_case, as SQLite returns them). The API maps them to JSON in serializers. */

export type Role = "rider" | "driver";
export type UserStatus = "active" | "suspended";
export type VehicleType = "bike" | "auto" | "car";
export type VerificationStatus = "pending" | "approved" | "rejected";
export type RideStatus = "requested" | "accepted" | "arrived" | "in_progress" | "completed" | "cancelled";
export type PaymentMethod = "cash" | "card" | "upi";
export type RidePaymentStatus = "unpaid" | "pending" | "paid" | "failed" | "refunded";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";
export type CancelledBy = "rider" | "driver" | "admin";

export interface Point {
    lat: number;
    lng: number;
}

export interface NamedPoint extends Point {
    name: string;
}

export interface UserRow {
    id: number;
    email: string;
    name: string | null;
    picture: string | null;
    role: Role | null;
    phone: string | null;
    phone_verified: number;
    onboarding_complete: number;
    status: UserStatus;
    created_at: string;
    updated_at: string;
    last_login_at: string | null;
}

export interface UserListRow extends UserRow {
    verification_status: VerificationStatus | null;
    ride_count: number;
}

export interface DriverRow {
    user_id: number;
    license_number: string;
    vehicle_type: VehicleType;
    vehicle_make: string;
    vehicle_model: string;
    vehicle_plate: string;
    vehicle_color: string | null;
    license_doc: string | null;
    rc_doc: string | null;
    verification_status: VerificationStatus;
    rejection_reason: string | null;
    reviewed_by: number | null;
    reviewed_at: string | null;
    submitted_at: string;
    is_online: number;
    lat: number | null;
    lng: number | null;
    location_updated_at: string | null;
    // Joined from users.
    name: string | null;
    email: string;
    phone: string | null;
    picture: string | null;
    user_status: UserStatus;
    reviewer_name: string | null;
}

export interface RideRow {
    id: number;
    rider_id: number;
    driver_id: number | null;
    pickup_name: string;
    pickup_lat: number;
    pickup_lng: number;
    drop_name: string;
    drop_lat: number;
    drop_lng: number;
    vehicle_type: VehicleType;
    distance_km: number;
    duration_min: number;
    fare: number;
    otp: string;
    status: RideStatus;
    cancelled_by: CancelledBy | null;
    cancel_reason: string | null;
    route_geometry: string | null;
    version: number;
    payment_method: PaymentMethod;
    payment_status: RidePaymentStatus;
    requested_at: string;
    accepted_at: string | null;
    arrived_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
    // Joined.
    rider_name: string | null;
    rider_phone: string | null;
    driver_name: string | null;
    driver_phone: string | null;
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_plate: string | null;
    vehicle_color: string | null;
    driver_lat: number | null;
    driver_lng: number | null;
    // Only set on open-request lists.
    pickup_distance_km?: number;
}

export interface PaymentRow {
    id: number;
    ride_id: number;
    rider_id: number;
    driver_id: number | null;
    amount: number;
    currency: string;
    method: PaymentMethod;
    status: PaymentStatus;
    provider: string;
    provider_ref: string | null;
    failure_reason: string | null;
    created_at: string;
    updated_at: string;
    paid_at: string | null;
    refunded_at: string | null;
    // Joined.
    rider_name?: string | null;
    driver_name?: string | null;
    pickup_name?: string;
    drop_name?: string;
}

export interface ActivityRow {
    id: number;
    user_id: number;
    type: string;
    entity_type: string | null;
    entity_id: number | null;
    metadata: string | null;
    ip: string | null;
    user_agent: string | null;
    created_at: string;
}

/** Cursor pagination: pass the previous page's nextCursor to get the next (older) page. */
export interface Page<T> {
    items: T[];
    nextCursor: number | null;
}

export interface PageQuery {
    cursor?: number | null;
    limit?: number;
}
