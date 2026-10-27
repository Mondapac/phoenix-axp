import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  transpilePackages: ['@phoenix/ui'],
  poweredByHeader: false,
  // No next/image optimisation: it needs sharp, whose libvips is LGPL (ADR-0009).
  images: { unoptimized: true },
  // `next dev` writes an AGENTS.md into the app folder; the repository keeps its agent rules elsewhere.
  agentRules: false,
};

export default withNextIntl(config);
