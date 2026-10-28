import { notFound } from 'next/navigation';

/** Any other path: the studio's not-found page inside the shell, after the session check. */
export default function Missing(): never {
  notFound();
}
