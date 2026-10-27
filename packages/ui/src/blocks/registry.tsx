// The component registry (design doc 4.1 step 4): the only way a node of a page tree becomes
// markup. Each entry reads its props from untrusted data into plain strings and arrays, and says
// which page region it belongs to so the renderer can build the landmarks. The Puck editor
// config (apps/portal/src/puck) is built from this registry, not the other way round.
import type { ComponentType } from 'react';
import { CardGrid, readCardGrid } from './card-grid.tsx';
import { Hero, readHero } from './hero.tsx';
import { NewsList, readNewsList } from './news-list.tsx';
import { readSiteFooter, SiteFooter } from './site-footer.tsx';
import { readSiteHeader, SiteHeader } from './site-header.tsx';
import type { BlockContext } from './types.ts';

export type Region = 'header' | 'main' | 'footer';

export interface RegistryEntry<P extends object = object> {
  region: Region;
  read: (props: Record<string, unknown>) => P;
  component: ComponentType<P & { ctx: BlockContext }>;
}

const entry = <P extends object>(e: RegistryEntry<P>) => e as unknown as RegistryEntry;

export const blockRegistry = {
  SiteHeader: entry({ region: 'header', read: readSiteHeader, component: SiteHeader }),
  Hero: entry({ region: 'main', read: readHero, component: Hero }),
  NewsList: entry({ region: 'main', read: readNewsList, component: NewsList }),
  CardGrid: entry({ region: 'main', read: readCardGrid, component: CardGrid }),
  SiteFooter: entry({ region: 'footer', read: readSiteFooter, component: SiteFooter }),
} satisfies Record<string, RegistryEntry>;

export type BlockType = keyof typeof blockRegistry;

export const isBlockType = (type: string): type is BlockType => Object.hasOwn(blockRegistry, type);
