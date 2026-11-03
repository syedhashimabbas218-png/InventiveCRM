import { randomUUID } from 'node:crypto';
import type { AvailableSlot, Booking, CalendarClient } from '../interfaces/calendar.ts';

export class InMemoryCalendar implements CalendarClient {
  private readonly slots = new Map<string, AvailableSlot[]>();
  private readonly bookings = new Map<string, Booking & { tenantId: string }>();

  setSlots(tenantId: string, slots: AvailableSlot[]): void {
    this.slots.set(tenantId, slots);
  }

  async getAvailability(tenantId: string, query: { from: string; to: string }): Promise<AvailableSlot[]> {
    const taken = new Set(
      [...this.bookings.values()]
        .filter((booking) => booking.tenantId === tenantId && booking.status === 'confirmed')
        .map((booking) => booking.start),
    );
    return (this.slots.get(tenantId) ?? []).filter(
      (slot) => slot.start >= query.from && slot.start < query.to && !taken.has(slot.start),
    );
  }

  async createBooking(tenantId: string, request: { personId: string; slot: AvailableSlot }): Promise<Booking> {
    const available = await this.getAvailability(tenantId, { from: request.slot.start, to: request.slot.end });
    if (!available.some((slot) => slot.start === request.slot.start)) {
      throw new Error('slot no longer available');
    }
    const booking = {
      id: `bkg_${randomUUID()}`,
      tenantId,
      personId: request.personId,
      start: request.slot.start,
      end: request.slot.end,
      status: 'confirmed' as const,
    };
    this.bookings.set(booking.id, booking);
    return booking;
  }

  async rescheduleBooking(tenantId: string, bookingId: string, slot: AvailableSlot): Promise<Booking> {
    const booking = await this.getBooking(tenantId, bookingId);
    if (!booking || booking.status !== 'confirmed') throw new Error('booking not found');
    const updated = { ...booking, tenantId, start: slot.start, end: slot.end };
    this.bookings.set(bookingId, updated);
    return updated;
  }

  async cancelBooking(tenantId: string, bookingId: string): Promise<Booking> {
    const booking = await this.getBooking(tenantId, bookingId);
    if (!booking) throw new Error('booking not found');
    const updated = { ...booking, tenantId, status: 'cancelled' as const };
    this.bookings.set(bookingId, updated);
    return updated;
  }

  async getBooking(tenantId: string, bookingId: string): Promise<Booking | undefined> {
    const booking = this.bookings.get(bookingId);
    return booking?.tenantId === tenantId ? booking : undefined;
  }
}
