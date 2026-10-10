import type { SceneAttachment, SceneTemplate, TextWrite } from '../bridge/protocol';
import type { SceneChildBinding, SceneHandler, SceneInstance, SceneRegionBinding, SceneListBinding, SceneRowKey, TextBinding } from './application';
import type { SceneProps } from './values';

export interface Child { binding?: SceneChildBinding; node: number; owner: Owner; props: SceneProps }
export interface Region {
  binding: SceneRegionBinding;
  branch: number;
  child?: Child;
  candidate?: { branch: number; child: Child };
}
export interface Row extends Child { key: SceneRowKey }
export interface ListRegion {
  binding: SceneListBinding;
  rows: Row[];
  candidates: Map<SceneRowKey, Row>;
}
export interface Family {
  members: Owner[];
  installs: Promise<void>[];
  ready: Promise<void>;
  root?: Owner;
  error?: unknown;
  failed: boolean;
  work: Promise<void>;
}
export interface Owner {
  instance: SceneInstance;
  family: Family;
  parent?: Owner;
  lexicalParent?: Owner;
  lexicalChildren: Set<Owner>;
  attachment?: SceneAttachment;
  template: SceneTemplate;
  bindings: readonly TextBinding[];
  handlers: readonly SceneHandler[];
  receive?: (props: SceneProps) => void;
  readProps(props: SceneProps): SceneProps;
  children: Child[];
  regions: Region[];
  lists: ListRegion[];
  initial: TextWrite[];
  acknowledged: Map<number, string>;
  pending: Set<string> | null;
  dirty: boolean;
  disposed: boolean;
  mounted: boolean;
  disposal?: Promise<void>;
  stagedReady?: { promise: Promise<void>; resolve(): void; reject(error: Error): void };
}
export interface RegionChange { region: Region; branch: number; child?: Child }
export interface ListChange { list: ListRegion; rows: Row[]; changed: boolean }
export interface PreparedOwner { owner: Owner; sources: Set<string> | null; writes: TextWrite[]; props: [Child, SceneProps][]; regions: RegionChange[]; lists: ListChange[] }
