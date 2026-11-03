export type AvailableSlot = {
  start: string;
  end: string;
  serviceId?: string;
};

export type Booking = {
  id: string;
  personId: string;
  start: string;
  end: string;
  status: 'confirmed' | 'cancelled';
};

export type CalendarClient = {
  getAvailability: (tenantId: string, query: { from: string; to: string; serviceId?: string }) => Promise<AvailableSlot[]>;
  createBooking: (tenantId: string, request: { personId: string; slot: AvailableSlot; notes?: string }) => Promise<Booking>;
  rescheduleBooking: (tenantId: string, bookingId: string, slot: AvailableSlot) => Promise<Booking>;
  cancelBooking: (tenantId: string, bookingId: string) => Promise<Booking>;
  getBooking: (tenantId: string, bookingId: string) => Promise<Booking | undefined>;
};
