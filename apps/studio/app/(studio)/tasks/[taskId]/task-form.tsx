'use client';

import { SchemaForm, todayIn, type SchemaFormTexts } from '@phoenix/ui';
import { useState } from 'react';

// The form revision a task's step shows (pinned by its process revision, slice 2.6), drawn with
// the forms renderer (slice 2.9) for reading: the step's answers are not recorded at completion
// yet, so nothing typed here could be kept.

const NO_DATA: Readonly<Record<string, unknown>> = {};
const ignore = () => undefined;

export function TaskForm(props: {
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  readonly uiSchema: Readonly<Record<string, unknown>>;
  readonly locale: string;
  readonly calendar: string;
  readonly timeZone: string;
  readonly texts: SchemaFormTexts;
}) {
  const [today] = useState(() => todayIn(props.timeZone));
  return (
    <SchemaForm
      readonly
      jsonSchema={props.jsonSchema}
      uiSchema={props.uiSchema}
      data={NO_DATA}
      onChange={ignore}
      locale={props.locale}
      calendar={props.calendar}
      today={today}
      texts={props.texts}
      showErrors={false}
    />
  );
}
