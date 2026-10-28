import type { Id } from '@phoenix/shared-kernel';
import type { ObjectField } from '../domain/fields';
import type { StoredValue } from '../domain/record-values';
import { resplitValues } from './records';

const id = (n: number) =>
  `01890a5d-ac96-774b-bcce-b3020000${String(n).padStart(4, '0')}` as Id<'Field'>;
const field = (n: number, sensitive: boolean): ObjectField => ({
  id: id(n),
  key: `f${n}`,
  label: `f${n}`,
  type: 'text',
  required: false,
  sensitive,
  maxLength: 100,
});
const values = (...entries: [number, StoredValue][]) =>
  new Map(entries.map(([n, value]) => [id(n), value]));

describe('splitting record values again under a published revision', () => {
  it('seals a field marked sensitive since, opens a lowered one, and keeps dropped ones', () => {
    // f1 is now sensitive, f2 was lowered, f3 stays plain; f4 (sealed) and f5 (plain) were dropped.
    const fields = [field(1, true), field(2, false), field(3, false)];
    const split = resplitValues(
      fields,
      values([1, 'a'], [3, 'c'], [5, 'e']),
      values([2, 'b'], [4, 'd']),
    );
    expect(split.sensitive).toEqual(values([1, 'a'], [4, 'd']));
    expect(split.plain).toEqual(values([3, 'c'], [5, 'e'], [2, 'b']));
  });
});
