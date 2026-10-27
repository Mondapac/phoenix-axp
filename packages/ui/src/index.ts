// @phoenix/ui: in-house panel components on Base UI (ADR-0016), tokens and locale helpers.
// Import the stylesheet once in a panel's root layout: `import '@phoenix/ui/styles.css'`.
export { cn } from './lib/cn';

export { COLOR_TOKENS, SIZE_TOKENS, colorVariable, tokensStylesheet } from './tokens/panel-tokens';
export type { ColorToken, Theme } from './tokens/panel-tokens';
export { contrastFailures, contrastRatio, CONTRAST_PAIRS } from './tokens/contrast';

export {
  directionOf,
  formatNumber,
  htmlAttributes,
  numberingSystemOf,
  toLocaleDigits,
} from './locale/locale';
export type { Direction } from './locale/locale';
export * from './locale/calendar';

export { UiProvider } from './components/ui-provider';
export { DirectionalIcon, Ltr } from './components/bidi';
export { Button, buttonClasses } from './components/button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/button';
export { Badge } from './components/badge';
export type { BadgeProps, Tone } from './components/badge';
export { Alert } from './components/alert';
export type { AlertProps } from './components/alert';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CardToolbar,
} from './components/card';
export { Field, TextArea, TextInput } from './components/field';
export type { FieldProps, TextAreaProps, TextInputProps } from './components/field';
export { Checkbox, Select, Switch } from './components/choice';
export type { CheckboxProps, SelectOption, SelectProps, SwitchProps } from './components/choice';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Menu,
  MenuContent,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SheetContent,
  Tooltip,
} from './components/overlay';
export type { DialogContentProps } from './components/overlay';
export {
  Avatar,
  EmptyState,
  Separator,
  Skeleton,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from './components/display';
export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/table';
export { Breadcrumb, Pagination, pageWindow } from './components/navigation';
export type { Crumb } from './components/navigation';
export { AppShell, PageContainer, PageHeader } from './components/shell';
export type { AppShellProps, NavItem, NavSection, ShellLabels } from './components/shell';
