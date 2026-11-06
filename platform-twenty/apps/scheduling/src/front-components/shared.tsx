import 'twenty-ui/style.css';
import 'twenty-ui/theme-dark.css';
import 'twenty-ui/theme-light.css';

import styled from '@emotion/styled';
import { type ReactNode } from 'react';
import { RestApiClient, RestApiClientError } from 'twenty-client-sdk/rest';
import { Callout } from 'twenty-ui/components/feedback';
import { Section } from 'twenty-ui/components/layout';
import { Button, type ButtonProps } from 'twenty-ui/primitives/input';
import { Tag } from 'twenty-ui/primitives/data-display';
import { Skeleton } from 'twenty-ui/primitives/feedback';
import { Card } from 'twenty-ui/primitives/surfaces';
import { Heading, Text } from 'twenty-ui/primitives/typography';
import { themeCssVariables } from 'twenty-ui/theme';

import {
  APPOINTMENT_STATUSES,
  CALENDAR_STATUSES,
  CONNECTION_STATUSES,
  OVERRIDE_KINDS,
  SYNC_STATUSES,
  TYPE_STATUSES,
} from 'src/constants/enums';

const appRoutes = new RestApiClient();

// Acts as the signed-in user, so Twenty permissions apply; the SDK client renews the short-lived page token.
export const callAdmin = async <TData,>(body: Record<string, unknown>): Promise<TData> => {
  try {
    return await appRoutes.post<TData>('/s/scheduling/admin', body);
  } catch (error) {
    const message = error instanceof RestApiClientError ? (error.body as { error?: string } | undefined)?.error : undefined;
    throw new Error(message ?? (error as Error).message);
  }
};

export const Page = styled.div`
  box-sizing: border-box;
  color: ${() => themeCssVariables.font.color.primary};
  display: flex;
  flex-direction: column;
  font-family: ${() => themeCssVariables.font.family};
  font-size: ${() => themeCssVariables.font.size.md};
  gap: ${() => themeCssVariables.spacing[6]};
  padding: ${() => themeCssVariables.spacing[6]} ${() => themeCssVariables.spacing[8]};
  width: 100%;
`;

export const NarrowPage = styled(Page)`
  max-width: 760px;
`;

export const Grid = styled.div`
  display: grid;
  gap: ${() => themeCssVariables.spacing[4]};
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
`;

export const Row = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${() => themeCssVariables.spacing[2]};
`;

export const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${() => themeCssVariables.spacing[2]};
`;

export const Divided = styled.div`
  border-top: 1px solid ${() => themeCssVariables.border.color.light};
  padding-top: ${() => themeCssVariables.spacing[3]};
`;

export const PageHeader = ({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) => (
  <Section.Root fullWidth>
    <Section.Header level={1} size="lg" title={title} description={description} actions={actions} />
  </Section.Root>
);

const PanelHeading = styled.div`
  align-items: center;
  display: flex;
  gap: ${() => themeCssVariables.spacing[2]};
  justify-content: space-between;
  margin-bottom: ${() => themeCssVariables.spacing[3]};
  min-height: ${() => themeCssVariables.spacing[6]};
`;

export const Panel = ({ title, action, children, tone }: { title: string; action?: ReactNode; children: ReactNode; tone?: 'danger' }) => (
  <Card.Root fullWidth style={{ display: 'flex', flexDirection: 'column', ...(tone === 'danger' ? { borderColor: themeCssVariables.border.color.danger } : {}) }}>
    <Card.Content style={{ flex: 1 }}>
      <PanelHeading>
        <Heading level={2} size="md">
          {title}
        </Heading>
        {action}
      </PanelHeading>
      <Stack>{children}</Stack>
    </Card.Content>
  </Card.Root>
);

export const Hint = ({ children }: { children: ReactNode }) => (
  <Text size="sm" color="tertiary">
    {children}
  </Text>
);

export const PrimaryButton = (props: ButtonProps) => <Button size="sm" variant="solid" color="accent" {...props} />;
export const SecondaryButton = (props: ButtonProps) => <Button size="sm" variant="outline" color="neutral" {...props} />;
export const QuietButton = (props: ButtonProps) => <Button size="sm" variant="ghost" color="neutral" {...props} />;

// One colour and label per status, shared with the record views so chips look the same everywhere in the CRM.
const STATUS_SETS = {
  appointment: APPOINTMENT_STATUSES,
  calendar: CALENDAR_STATUSES,
  connection: CONNECTION_STATUSES,
  sync: SYNC_STATUSES,
  type: TYPE_STATUSES,
  override: OVERRIDE_KINDS,
} as const;

type StatusColor = Parameters<typeof Tag>[0]['color'];

export const StatusTag = ({ kind, value }: { kind: keyof typeof STATUS_SETS; value: string }) => {
  const entry = (STATUS_SETS[kind] as Record<string, { label: string; color: string }>)[value];
  return (
    <Tag variant="soft" color={(entry?.color ?? 'gray') as StatusColor}>
      {entry?.label ?? label(value)}
    </Tag>
  );
};

export const ColorTag = ({ color, children }: { color: StatusColor; children: ReactNode }) => (
  <Tag variant="soft" color={color}>
    {children}
  </Tag>
);

const controlStyles = () => `
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  height: 32px;
  padding: 0 ${themeCssVariables.spacing[2]};

  &:focus-visible {
    border-color: ${themeCssVariables.color.blue};
    outline: none;
  }
`;

// Native controls keep keyboard, date and time pickers working inside the sandboxed renderer.
export const Select = styled.select`
  ${controlStyles}
`;

export const Input = styled.input`
  ${controlStyles}
`;

export const CheckboxLabel = styled.label`
  align-items: center;
  cursor: pointer;
  display: flex;
  gap: ${() => themeCssVariables.spacing[2]};
  padding: ${() => themeCssVariables.spacing[1]} 0;

  input {
    accent-color: ${() => themeCssVariables.color.blue};
    margin: 0;
  }
`;

export const FieldLabel = styled.label`
  display: flex;
  flex-direction: column;
  gap: ${() => themeCssVariables.spacing[1]};
`;

export const FieldTitle = styled.span`
  color: ${() => themeCssVariables.font.color.secondary};
  font-size: ${() => themeCssVariables.font.size.sm};
  font-weight: ${() => themeCssVariables.font.weight.medium};
`;

export const Code = styled.pre`
  background: ${() => themeCssVariables.background.tertiary};
  border-radius: ${() => themeCssVariables.border.radius.sm};
  color: ${() => themeCssVariables.font.color.secondary};
  flex: 1;
  font-size: ${() => themeCssVariables.font.size.xs};
  margin: 0;
  padding: ${() => themeCssVariables.spacing[2]};
  white-space: pre-wrap;
  word-break: break-all;
`;

export const LoadingState = () => (
  <Stack>
    <Skeleton layout="block" height={24} width={240} />
    <Skeleton layout="block" height={96} />
    <Skeleton layout="block" height={96} />
  </Stack>
);

export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <Callout status="error" title="Could not load this page" description={message} action={onRetry ? <SecondaryButton onClick={onRetry}>Try again</SecondaryButton> : undefined} />
);

export const when = (iso: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) =>
  new Intl.DateTimeFormat('en-GB', options).format(new Date(iso));

export const label = (value: string) => value.replace(/_/g, ' ').toLowerCase().replace(/^./, (first) => first.toUpperCase());
