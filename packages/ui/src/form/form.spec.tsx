import { renderToStaticMarkup } from 'react-dom/server';
import { UiProvider } from '../components/ui-provider';
import { TENANTS } from '../test-tenants';
import { propertiesUnder, propertyOfError, stepOfErrors } from './form-layout';
import { choiceLabel, descriptionOf, errorText, labelOf, textFor } from './form-text';
import { rowSpans, SchemaForm, type SchemaFormTexts } from './schema-form';
import { todayIn, toEditableText } from '../locale/calendar';

const ERRORS = {
  required: 'required',
  minLength: 'min {limit}',
  maxLength: 'max {limit}',
  minimum: 'from {limit}',
  maximum: 'to {limit}',
  pattern: 'pattern',
  email: 'email',
  date: 'date',
  number: 'number',
  choice: 'choice',
  invalid: 'invalid',
};
const TEXTS: SchemaFormTexts = {
  errors: ERRORS,
  date: { open: 'open calendar', previousMonth: 'prev', nextMonth: 'next' },
  required: 'required',
  choose: 'choose',
  next: 'Next',
  back: 'Back',
  stepOf: 'Step {current} of {total}',
};

const SCHEMA = {
  type: 'object',
  properties: {
    fullName: { type: 'string', title: 'Name', maxLength: 50 },
    birth: { type: 'string', format: 'date', title: 'Birth' },
    city: { type: 'string', title: 'City', enum: ['a', 'b'] },
    age: { type: 'integer', title: 'Age' },
    agree: { type: 'boolean', title: 'Agree' },
    script: { type: 'string', title: '<script>alert(1)</script>' },
  },
  required: ['fullName'],
};

describe.each(TENANTS)('form texts and layout ($code)', (tenant) => {
  const locale = tenant.defaultLocale;
  const other = tenant.supportedLocales.find((l) => l !== locale) ?? 'en-CA';

  it('reads a label in the locale, then by language, then the fallbacks', () => {
    const element = {
      scope: '#/properties/a',
      label: 'plain',
      options: { labels: { [locale]: 'here', [other]: 'there' } },
    };
    expect(labelOf(element, {}, locale)).toBe('here');
    expect(labelOf(element, {}, other)).toBe('there');
    expect(textFor({ [locale.split('-')[0]!]: 'by language' }, locale)).toBe('by language');
    expect(labelOf({ scope: '#/properties/a', label: 'plain' }, { title: 't' }, locale)).toBe(
      'plain',
    );
    expect(labelOf({ scope: '#/properties/a' }, { title: 't' }, locale)).toBe('t');
    expect(labelOf({ scope: '#/properties/a' }, {}, locale)).toBe('a');
    expect(descriptionOf({ options: { descriptions: { [locale]: 'd' } } }, {}, locale)).toBe('d');
    expect(
      choiceLabel(
        { options: { choices: [{ value: 'a', labels: { [locale]: 'A!' } }] } },
        'a',
        locale,
      ),
    ).toBe('A!');
    expect(choiceLabel({}, 'b', locale)).toBe('b');
  });

  it('words an error by keyword with the limit in the locale digits', () => {
    const digits = (n: number) => new Intl.NumberFormat(locale).format(n);
    expect(errorText({ keyword: 'maxLength', params: { limit: 50 } }, ERRORS, digits)).toBe(
      `max ${digits(50)}`,
    );
    expect(errorText({ keyword: 'format', params: { format: 'email' } }, ERRORS, digits)).toBe(
      'email',
    );
    expect(errorText({ keyword: 'type', params: { type: 'integer' } }, ERRORS, digits)).toBe(
      'number',
    );
    expect(errorText({ keyword: 'whatever', params: {} }, ERRORS, digits)).toBe('invalid');
  });

  it('finds which step an error belongs to', () => {
    const step = {
      type: 'Category',
      elements: [{ type: 'Group', elements: [{ type: 'Control', scope: '#/properties/a' }] }],
    };
    expect([...propertiesUnder(step)]).toEqual(['a']);
    expect(
      propertyOfError({ instancePath: '', keyword: 'required', params: { missingProperty: 'a' } }),
    ).toBe('a');
    expect(propertyOfError({ instancePath: '/b', keyword: 'maxLength', params: {} })).toBe('b');
    expect(stepOfErrors([{ instancePath: '/b', keyword: 'maxLength', params: {} }], step)).toBe(
      false,
    );
    expect(
      stepOfErrors(
        [{ instancePath: '', keyword: 'required', params: { missingProperty: 'a' } }],
        step,
      ),
    ).toBe(true);
  });

  it('shares the free columns of a row and keeps chosen spans', () => {
    const el = (span?: number) => ({
      type: 'Control',
      ...(span === undefined ? {} : { options: { span } }),
    });
    expect(rowSpans([el(), el()])).toEqual([6, 6]);
    expect(rowSpans([el(8), el()])).toEqual([8, 4]);
    expect(rowSpans([el(3), el(99), el()])).toEqual([3, 4, 4]);
  });

  it('gives today in the tenant zone as an ISO date', () => {
    const today = todayIn(tenant.timeZone);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(toEditableText(today, tenant.calendar)).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });

  it('renders every control with its label, a required mark and no raw markup from the schema', () => {
    const markup = renderToStaticMarkup(
      <UiProvider locale={locale}>
        <SchemaForm
          jsonSchema={SCHEMA}
          uiSchema={{
            type: 'VerticalLayout',
            elements: [
              {
                type: 'Control',
                scope: '#/properties/fullName',
                options: { labels: { [locale]: 'نام کامل' } },
              },
              {
                type: 'HorizontalLayout',
                elements: [
                  { type: 'Control', scope: '#/properties/birth', options: { span: 4 } },
                  { type: 'Control', scope: '#/properties/city' },
                ],
              },
              {
                type: 'Group',
                label: 'Section',
                elements: [
                  { type: 'Control', scope: '#/properties/age' },
                  { type: 'Control', scope: '#/properties/agree' },
                ],
              },
              { type: 'Control', scope: '#/properties/script' },
              { type: 'UnknownThing', scope: '#/properties/fullName' },
            ],
          }}
          data={{ birth: '2024-03-20', age: 42 }}
          onChange={() => undefined}
          locale={locale}
          calendar={tenant.calendar}
          today="2024-03-20"
          texts={TEXTS}
          showErrors={false}
        />
      </UiProvider>,
    );
    expect(markup).toContain('نام کامل');
    expect(markup).toContain('sm:col-span-4');
    expect(markup).toContain('sm:col-span-8');
    expect(markup).toContain('<fieldset');
    expect(markup).toContain('<legend');
    expect(markup).toContain('(required)');
    // The date shows in the tenant's calendar and digits.
    const date = new Intl.NumberFormat(locale, { useGrouping: false }).format(
      Number(toEditableText('2024-03-20', tenant.calendar).slice(0, 4)),
    );
    expect(markup).toContain(date);
    // A schema title is text, never markup.
    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;script&gt;');
    // Errors stay hidden until the first submit attempt.
    expect(markup).not.toContain('text-critical">required');
  });

  it('renders a Categorization as a stepper with one step shown', () => {
    const markup = renderToStaticMarkup(
      <UiProvider locale={locale}>
        <SchemaForm
          jsonSchema={SCHEMA}
          uiSchema={{
            type: 'Categorization',
            elements: [
              {
                type: 'Category',
                label: 'One',
                elements: [{ type: 'Control', scope: '#/properties/fullName' }],
              },
              {
                type: 'Category',
                label: 'Two',
                elements: [{ type: 'Control', scope: '#/properties/age' }],
              },
            ],
          }}
          data={{}}
          onChange={() => undefined}
          locale={locale}
          calendar={tenant.calendar}
          today="2024-03-20"
          texts={TEXTS}
          showErrors
        />
      </UiProvider>,
    );
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain('Next');
    expect(markup).toContain('Name');
    expect(markup).not.toContain('Age');
    // showErrors: the missing required name is reported.
    expect(markup).toContain('required');
  });
});
