'use client';
// The Puck editor on a published page tree, for the RTL editing check of PoC 4. In the product
// the editor lives in apps/studio and edits a draft; here Publish only logs what it would send.
import { Puck, type Data } from '@puckeditor/core';
// no-external.css: puck.css @imports the Inter font from rsms.me, a foreign host (offline installs).
import '@puckeditor/core/no-external.css';
import { useMemo } from 'react';
import type { BlockContext } from '@phoenix/ui/blocks';
import { editorConfig, type EditorLabels } from './config.tsx';

export function Editor({
  data,
  ctx,
  dictionary,
  labels,
  title,
  ltrFields,
}: {
  data: Data;
  ctx: BlockContext;
  dictionary: Record<string, string>;
  labels: EditorLabels;
  title: string;
  /** Off (?ltr=0) shows Puck's plain text field for URLs, to compare. */
  ltrFields: boolean;
}) {
  const config = useMemo(() => editorConfig(ctx, labels, ltrFields), [ctx, labels, ltrFields]);
  return (
    <Puck
      config={config}
      data={data}
      dictionary={dictionary}
      headerTitle={title}
      onPublish={(next) =>
        console.info('[spike] publish would send', JSON.stringify(next).length, 'bytes')
      }
    />
  );
}
