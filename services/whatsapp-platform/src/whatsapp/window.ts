export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type WindowState = { open: boolean; closesAt: Date | null };

// Meta: the window opens or resets whenever the customer messages; outside it only templates may be sent.
export const customerServiceWindow = (lastCustomerMessageAt: Date | null, now: Date): WindowState => {
  if (!lastCustomerMessageAt) return { open: false, closesAt: null };
  const closesAt = new Date(lastCustomerMessageAt.getTime() + CUSTOMER_SERVICE_WINDOW_MS);
  return { open: now < closesAt, closesAt };
};
