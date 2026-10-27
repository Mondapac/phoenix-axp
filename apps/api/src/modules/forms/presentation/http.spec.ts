import { HttpException } from '@nestjs/common';
import { err, ok } from '@phoenix/shared-kernel';
import { answer } from './http';

function bodyOf(run: () => unknown): { status: number; body: unknown } {
  try {
    run();
  } catch (error) {
    if (error instanceof HttpException)
      return { status: error.getStatus(), body: error.getResponse() };
    throw error;
  }
  throw new Error('no answer');
}

describe('the HTTP answers of the forms controllers', () => {
  it('passes a value through', () => {
    expect(answer(ok(3))).toBe(3);
  });

  it('answers an invalid schema with 422, its field, problem and place', () => {
    const failure = {
      code: 'forms.schema.invalid',
      field: 'uiSchema',
      problem: 'scope-unresolved',
      pointer: '/elements/0/scope',
    } as const;
    expect(bodyOf(() => answer(err(failure)))).toEqual({
      status: 422,
      body: { statusCode: 422, ...failure },
    });
  });

  it('answers the other failures with their status and code only', () => {
    expect(bodyOf(() => answer(err({ code: 'forms.form.already-published' })))).toEqual({
      status: 409,
      body: { statusCode: 409, code: 'forms.form.already-published' },
    });
    expect(bodyOf(() => answer(err({ code: 'forms.value.invalid', field: 'key' })))).toEqual({
      status: 400,
      body: { statusCode: 400, code: 'forms.value.invalid', field: 'key' },
    });
    expect(() => answer(err({ code: 'forms.unknown' }))).toThrow('No HTTP status');
  });
});
