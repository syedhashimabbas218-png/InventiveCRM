import { type CSSProperties, type ReactNode } from 'react';
import { useColorScheme } from 'twenty-sdk/front-component';

// Calls the app's authenticated route with the signed-in user's token, so Twenty permissions apply.
export const callAdmin = async <TData,>(body: Record<string, unknown>): Promise<TData> => {
  const response = await fetch(`${process.env.TWENTY_API_URL}/s/scheduling/admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TWENTY_APP_ACCESS_TOKEN ?? ''}` },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as TData & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
};

export const useTheme = () => {
  const dark = useColorScheme() === 'dark';
  return {
    dark,
    text: dark ? '#ebebeb' : '#333333',
    muted: dark ? '#a0a0a0' : '#666666',
    line: dark ? '#333333' : '#ebebeb',
    card: dark ? '#1b1b1b' : '#ffffff',
    soft: dark ? '#222222' : '#f5f5f5',
    accent: '#1961ED',
    danger: '#e5484d',
    ok: '#18794e',
    warn: '#d97706',
  };
};

export type Theme = ReturnType<typeof useTheme>;

export const Card = ({ theme, title, action, children, style }: { theme: Theme; title: string; action?: ReactNode; children: ReactNode; style?: CSSProperties }) => (
  <section style={{ background: theme.card, border: `1px solid ${theme.line}`, borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: theme.text }}>{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

export const Button = ({ theme, onClick, children, primary, disabled }: { theme: Theme; onClick: () => void; children: ReactNode; primary?: boolean; disabled?: boolean }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      font: 'inherit',
      fontSize: 13,
      padding: '5px 10px',
      borderRadius: 6,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      border: `1px solid ${primary ? theme.accent : theme.line}`,
      background: primary ? theme.accent : theme.card,
      color: primary ? '#fff' : theme.text,
    }}
  >
    {children}
  </button>
);

export const Pill = ({ color, children }: { color: string; children: ReactNode }) => (
  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: `${color}22`, color, whiteSpace: 'nowrap' }}>{children}</span>
);

export const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: '#18794e',
  PENDING: '#666666',
  RESCHEDULED: '#7c3aed',
  CANCELLED: '#e5484d',
  COMPLETED: '#1961ED',
  NO_SHOW: '#d97706',
  CONNECTED: '#18794e',
  NEEDS_RECONNECT: '#e5484d',
  ERROR: '#d97706',
  DISCONNECTED: '#666666',
  SYNCED: '#18794e',
  FAILED: '#e5484d',
  NOT_CONNECTED: '#666666',
  CHANGED_EXTERNALLY: '#d97706',
  ACTIVE: '#18794e',
  DRAFT: '#666666',
  DISABLED: '#e5484d',
};

export const when = (iso: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) =>
  new Intl.DateTimeFormat('en-GB', options).format(new Date(iso));

export const label = (value: string) => value.replace(/_/g, ' ').toLowerCase().replace(/^./, (first) => first.toUpperCase());
