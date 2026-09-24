import type { ChapterDef } from '../core/types'

/**
 * The tour of Hark Town, island by island, morning to sunset. `length` is
 * scroll distance in viewport heights; `landing` is where nav jumps land.
 */
export const CHAPTERS: ChapterDef[] = [
  { id: 'hero', label: 'HQ', length: 2.6, landing: 0, load: () => import('./hero/index') },
  { id: 'work', label: 'Main Street', length: 3.8, landing: 0.12, load: () => import('./work/index') },
  { id: 'services', label: 'The Works', length: 4.0, landing: 0.08, load: () => import('./services/index') },
  { id: 'voices', label: 'Town Square', length: 3.0, landing: 0.06, load: () => import('./voices/index') },
  { id: 'shield', label: 'The Storm', length: 1.7, landing: 0.45, load: () => import('./shield/index') },
  { id: 'process', label: 'Building Site', length: 2.2, landing: 0.17, load: () => import('./process/index') },
  { id: 'contact', label: 'Lighthouse', length: 1.5, landing: 0.3, load: () => import('./contact/index') },
]
