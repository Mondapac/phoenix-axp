import { renderToStaticMarkup } from 'react-dom/server';
import { TENANTS } from '../test-tenants';
import { Alert } from './alert';
import { Badge } from './badge';
import { Ltr } from './bidi';
import { Button } from './button';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Checkbox, Select, Switch } from './choice';
import { Avatar, EmptyState } from './display';
import { Field, TextInput } from './field';
import { Breadcrumb, Pagination, pageWindow } from './navigation';
import { AppShell, PageHeader } from './shell';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { UiProvider } from './ui-provider';

// Server rendering, as the panels render first. Interaction is Base UI's own (tested upstream);
// these specs check our markup: landmarks, names, states, logical classes and locale digits.
const html = (node: React.ReactNode, locale = 'en-CA') =>
  renderToStaticMarkup(<UiProvider locale={locale}>{node}</UiProvider>);

const PHYSICAL =
  /(^|\s)(-?(ml|mr|pl|pr|left|right)-|text-(left|right)|border-(l|r)\b|rounded-(l|r)\b)/;
const classesOf = (markup: string) =>
  [...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/));

describe('components', () => {
  it('renders a button as type="button" with its variant, and an icon button with its name', () => {
    const markup = html(
      <>
        <Button>Save</Button>
        <Button variant="danger" size="icon" aria-label="Delete">
          x
        </Button>
      </>,
    );
    expect(markup).toContain('type="button"');
    expect(markup).toContain('bg-accent');
    expect(markup).toContain('aria-label="Delete"');
    expect(markup).toContain('bg-critical');
  });

  it('associates a field label with its input and shows the error only when invalid', () => {
    const valid = html(
      <Field label="Name" error="Required" description="As on the ID card">
        <TextInput name="name" />
      </Field>,
    );
    const label = /<label[^>]*for="([^"]+)"/.exec(valid)?.[1];
    expect(label).toBeDefined();
    expect(valid).toContain(`id="${label}"`);
    expect(valid).not.toContain('Required');
    const invalid = html(
      <Field label="Name" error="Required" invalid>
        <TextInput name="name" />
      </Field>,
    );
    expect(invalid).toContain('Required');
    expect(invalid).toContain('aria-invalid="true"');
  });

  it('announces a critical alert at once and others politely', () => {
    expect(html(<Alert tone="critical" title="Failed" />)).toContain('role="alert"');
    expect(html(<Alert tone="success" title="Saved" />)).toContain('role="status"');
  });

  it('isolates left-to-right data', () => {
    expect(html(<Ltr>user@example.org</Ltr>)).toContain('dir="ltr"');
  });

  it('renders checkbox, switch and select with their names', () => {
    const markup = html(
      <>
        <Checkbox label="Active" defaultChecked />
        <Switch label="Notify" />
        <Select
          aria-label="Status"
          options={[{ value: 'a', label: 'Active' }]}
          placeholder="Pick"
        />
      </>,
    );
    expect(markup).toContain('role="checkbox"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-label="Status"');
  });

  it('marks the current crumb and builds no text of its own', () => {
    const markup = html(
      <Breadcrumb label="Path" items={[{ label: 'Home', href: '/' }, { label: 'Users' }]} />,
    );
    expect(markup).toContain('aria-label="Path"');
    expect(markup).toMatch(/aria-current="page"[^>]*>Users/);
    expect(markup).toContain('href="/"');
  });

  it('end-aligns numeric columns and keeps column widths with a colgroup', () => {
    const markup = html(
      <Table columns={['60%', '40%']}>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead numeric>Count</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>A</TableCell>
            <TableCell numeric>3</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(markup).toContain('<col style="width:60%"/>');
    expect(markup).toContain('scope="col"');
    expect(markup.match(/text-end/g)).toHaveLength(2);
  });

  it('shows a page window with gaps', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 10)).toEqual([1, 2, 3, null, 10]);
    expect(pageWindow(6, 12)).toEqual([1, null, 4, 5, 6, 7, 8, null, 12]);
  });
});

describe.each(TENANTS)('components for tenant $code', (tenant) => {
  const locale = tenant.defaultLocale;
  const nav = [
    {
      label: 'Section',
      items: [
        { href: '/a', label: 'Dashboard', icon: <svg />, active: true },
        { href: '/b', label: 'Users', badge: '3', children: [{ href: '/b/1', label: 'Roles' }] },
      ],
    },
  ];
  const labels = {
    nav: 'Main',
    openMenu: 'Open',
    closeMenu: 'Close',
    collapseMenu: 'Collapse',
    expandMenu: 'Expand',
  };

  it('renders the shell with the side menu landmark, the current page and only given text', () => {
    const markup = html(
      <AppShell brand="Brand" brandMark="B" nav={nav} labels={labels} headerEnd={<Badge>1</Badge>}>
        <PageHeader
          title="Title"
          breadcrumb={<Breadcrumb label="Path" items={[{ label: 'Title' }]} />}
        />
      </AppShell>,
      locale,
    );
    expect(markup).toContain('aria-label="Main"');
    expect(markup).toMatch(/aria-current="page"[^>]*>.*Dashboard/);
    expect(markup).toContain('aria-label="Open"');
    expect(markup).toContain('aria-label="Collapse"');
    expect(markup).toContain('<h1');
    // No text the caller did not give: strip tags and compare with the given strings.
    const text = markup
      .replace(/<[^>]+>/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    expect(new Set(text)).toEqual(
      new Set(['Brand', 'Section', 'Dashboard', 'Users', '3', '1', 'Title']),
    );
  });

  it('uses logical classes only, in every component', () => {
    const markup = html(
      <>
        <AppShell brand="B" brandMark="B" nav={nav} labels={labels}>
          <Card>
            <CardHeader>
              <CardTitle>T</CardTitle>
            </CardHeader>
            <CardContent>
              <EmptyState title="Empty" />
              <Avatar name="Ali" initials="A" />
              <Alert title="x" />
              <Pagination
                page={2}
                pageCount={9}
                href={(p) => `?p=${p}`}
                locale={locale}
                labels={{ nav: 'n', previous: 'p', next: 'x', page: (p) => p }}
              />
            </CardContent>
          </Card>
        </AppShell>
      </>,
      locale,
    );
    expect(classesOf(markup).filter((c) => PHYSICAL.test(` ${c}`))).toEqual([]);
  });

  it('shows page numbers in the locale digits', () => {
    const markup = html(
      <Pagination
        page={12}
        pageCount={20}
        href={(p) => `?page=${p}`}
        locale={locale}
        labels={{ nav: 'Pages', previous: 'Prev', next: 'Next', page: (p) => `Page ${p}` }}
      />,
      locale,
    );
    const twelve = new Intl.NumberFormat(locale).format(12);
    expect(markup).toContain(`aria-current="page"`);
    expect(markup).toContain(`>${twelve}</a>`);
    expect(markup).toContain('href="?page=12"');
    expect(markup).toContain('aria-label="Prev"');
  });
});

describe('Card', () => {
  it('is a section', () => {
    expect(html(<Card>x</Card>)).toMatch(/^<section/);
  });
});
