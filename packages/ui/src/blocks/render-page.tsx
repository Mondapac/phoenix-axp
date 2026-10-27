import type { ReactNode } from 'react';
import { blockRegistry, isBlockType, type Region } from './registry.tsx';
import type { BlockContext, PageData } from './types.ts';

/**
 * Renders a published page tree through the registry. A node whose type is not registered
 * renders nothing (fail closed) and is reported, so a page saved by a newer editor never shows
 * raw data. Header nodes go before <main>, footer nodes after it; everything else is main.
 */
export function renderPage(
  data: PageData,
  ctx: BlockContext,
  onUnknown: (type: string) => void = () => {},
): Record<Region, ReactNode[]> {
  const regions: Record<Region, ReactNode[]> = { header: [], main: [], footer: [] };
  data.content.forEach((node, index) => {
    if (!isBlockType(node.type)) {
      onUnknown(node.type);
      return;
    }
    const { component: Block, read, region } = blockRegistry[node.type];
    const key = typeof node.props.id === 'string' ? node.props.id : `node-${index}`;
    regions[region].push(<Block key={key} {...read(node.props ?? {})} ctx={ctx} />);
  });
  return regions;
}

export function PageView({
  data,
  ctx,
  onUnknown,
}: {
  data: PageData;
  ctx: BlockContext;
  onUnknown?: (type: string) => void;
}) {
  const regions = renderPage(data, ctx, onUnknown);
  return (
    <>
      {regions.header}
      <main id="main" tabIndex={-1} className="outline-none">
        {regions.main}
      </main>
      {regions.footer}
    </>
  );
}
