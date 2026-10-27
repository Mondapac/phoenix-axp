'use client';
// The Puck editor config, built from the block registry: the registry is the contract and Puck
// is only the editing accelerator (design doc 3). Fields are plain text and arrays only; Puck's
// `richtext` field is not used because it stores HTML, which the portal never renders.
// Field labels come from the app catalogue. Link, date and anchor fields are left-to-right
// inputs: in an RTL editor Puck's text field shows "/forms/a" as "forms/a/" (bidi), found here.
import { FieldLabel, type Config, type Field, type Fields } from '@puckeditor/core';
import { blockRegistry, type BlockContext, type BlockType } from '@phoenix/ui/blocks';

export interface EditorLabels {
  blocks: Record<string, string>;
  fields: Record<string, string>;
}

function fieldFactory(labels: EditorLabels, ltrFields: boolean) {
  const label = (name: string) => labels.fields[name] ?? name;
  const text = (name: string): Field => ({ type: 'text', label: label(name) });
  const area = (name: string): Field => ({ type: 'textarea', label: label(name) });
  // A text input that is always left-to-right (URLs, ISO dates, anchors).
  const ltr = (name: string): Field =>
    ltrFields
      ? {
          type: 'custom',
          label: label(name),
          render: ({ id, value, onChange, readOnly }) => (
            <FieldLabel label={label(name)} readOnly={readOnly}>
              <input
                id={id}
                dir="ltr"
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-start"
                value={typeof value === 'string' ? value : ''}
                readOnly={readOnly}
                onChange={(event) => onChange(event.target.value)}
              />
            </FieldLabel>
          ),
        }
      : text(name);
  const array = (name: string, arrayFields: Fields, summary: string): Field => ({
    type: 'array',
    label: label(name),
    arrayFields,
    getItemSummary: (item: Record<string, unknown>) =>
      typeof item[summary] === 'string' ? (item[summary] as string) : '',
  });
  return { text, area, ltr, array };
}

export function editorConfig(ctx: BlockContext, labels: EditorLabels, ltrFields: boolean): Config {
  const { text, area, ltr, array } = fieldFactory(labels, ltrFields);
  const links = (name: string) => array(name, { label: text('label'), href: ltr('href') }, 'label');
  const FIELDS: Record<BlockType, Fields> = {
    SiteHeader: { siteName: text('siteName'), tagline: text('tagline'), nav: links('nav') },
    Hero: {
      title: text('title'),
      subtitle: area('subtitle'),
      ctaLabel: text('ctaLabel'),
      ctaHref: ltr('ctaHref'),
    },
    NewsList: {
      title: text('title'),
      anchor: ltr('anchor'),
      items: array(
        'items',
        { title: text('title'), date: ltr('date'), summary: area('summary'), href: ltr('href') },
        'title',
      ),
    },
    CardGrid: {
      title: text('title'),
      anchor: ltr('anchor'),
      cards: array(
        'cards',
        { title: text('title'), body: area('body'), href: ltr('href') },
        'title',
      ),
    },
    SiteFooter: { text: area('text'), links: links('links') },
  };
  const components = Object.fromEntries(
    (Object.keys(blockRegistry) as BlockType[]).map((type) => {
      const { component: Block, read } = blockRegistry[type];
      return [
        type,
        {
          label: labels.blocks[type] ?? type,
          fields: FIELDS[type],
          render: ({ puck: _puck, id: _id, ...props }: Record<string, unknown>) => (
            <Block {...read(props)} ctx={ctx} />
          ),
        },
      ];
    }),
  );
  // Puck's default root has an unlabelled `title` field; the page title is labelled like the rest.
  return { root: { fields: { title: text('pageTitle') } }, components } as Config;
}
