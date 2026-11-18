import 'twenty-ui/style.css';
import 'twenty-ui/theme-dark.css';
import 'twenty-ui/theme-light.css';

import styled from '@emotion/styled';
import { type ReactNode } from 'react';
import { Button, type ButtonProps } from 'twenty-ui/primitives/input';
import { Text } from 'twenty-ui/primitives/typography';
import { themeCssVariables } from 'twenty-ui/theme';

export const Page = styled.div`
  box-sizing: border-box;
  color: ${() => themeCssVariables.font.color.primary};
  display: flex;
  flex: 1;
  flex-direction: column;
  font-family: ${() => themeCssVariables.font.family};
  font-size: ${() => themeCssVariables.font.size.md};
  gap: ${() => themeCssVariables.spacing[6]};
  padding: ${() => themeCssVariables.spacing[6]} ${() => themeCssVariables.spacing[8]};
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

export const Hint = ({ children }: { children: ReactNode }) => (
  <Text size="sm" color="tertiary">
    {children}
  </Text>
);

export const PrimaryButton = (props: ButtonProps) => <Button size="sm" variant="solid" color="accent" {...props} />;
export const SecondaryButton = (props: ButtonProps) => <Button size="sm" variant="outline" color="neutral" {...props} />;
export const QuietButton = (props: ButtonProps) => <Button size="sm" variant="ghost" color="neutral" {...props} />;

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

// Native controls keep keyboard input working inside the sandboxed renderer.
export const Select = styled.select`
  ${controlStyles}
`;

export const Input = styled.input`
  ${controlStyles}
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
