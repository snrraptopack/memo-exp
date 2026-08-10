import type { StaticTable } from './kernels';

export interface TopologyConfig {
  name: string;
  keys: number;
  entities: number;
  fanout: number;
  wildcardDensity: number;
  writesPerCommit: number;
  derivedDepth: number;
}

export interface Topology {
  config: TopologyConfig;
  ids: string[];
  keys: string[];
  entityKeys: Map<string, string[]>;
  table: StaticTable;
  commits: string[][];
}

export const topologyConfigs: TopologyConfig[] = [
  { name: 'exact-low-fanout', keys: 128, entities: 256, fanout: 2, wildcardDensity: 0, writesPerCommit: 1, derivedDepth: 1 },
  { name: 'exact-high-fanout', keys: 128, entities: 256, fanout: 64, wildcardDensity: 0, writesPerCommit: 1, derivedDepth: 1 },
  { name: 'wildcard-heavy', keys: 128, entities: 256, fanout: 32, wildcardDensity: 0.75, writesPerCommit: 1, derivedDepth: 1 },
  { name: 'batched-writes', keys: 128, entities: 256, fanout: 16, wildcardDensity: 0.25, writesPerCommit: 4, derivedDepth: 1 },
  { name: 'derived-depth-4', keys: 128, entities: 256, fanout: 16, wildcardDensity: 0.25, writesPerCommit: 1, derivedDepth: 4 },
  { name: 'large-topology', keys: 512, entities: 1024, fanout: 32, wildcardDensity: 0.5, writesPerCommit: 2, derivedDepth: 2 },
];

export function generateTopology(config: TopologyConfig): Topology {
  const groupSize = Math.max(1, config.fanout);
  const ids = Array.from({ length: config.entities }, (_, index) =>
    `App/Group/${Math.floor(index / groupSize)}/Entity[${index % groupSize}]`,
  );
  const keys = Array.from({ length: config.keys }, (_, index) => `state:${index}`);
  const readers: Record<string, string[]> = {};
  const entityKeys = new Map(ids.map((id) => [id, [] as string[]]));
  const wildcardKeys = Math.floor(config.keys * config.wildcardDensity);

  for (let keyIndex = 0; keyIndex < config.keys; keyIndex++) {
    const key = keys[keyIndex]!;
    const selected: string[] = [];
    if (keyIndex < wildcardKeys) {
      const groups = Math.max(1, Math.floor(config.entities / groupSize));
      const group = keyIndex % groups;
      const pattern = `App/Group/${group}/Entity[*]`;
      readers[key] = [pattern];
      for (let offset = 0; offset < groupSize; offset++) {
        const id = ids[group * groupSize + offset];
        if (id !== undefined) selected.push(id);
      }
    } else {
      for (let offset = 0; offset < config.fanout; offset++) {
        selected.push(ids[(keyIndex * 37 + offset * 17) % ids.length]!);
      }
      readers[key] = [...new Set(selected)];
    }
    for (const id of new Set(selected)) entityKeys.get(id)!.push(key);
  }

  for (let depth = 0; depth < config.derivedDepth; depth++) {
    const entity = `App/$derived:${depth}`;
    const input = depth === 0 ? keys[0]! : `derived:${depth - 1}`;
    const output = `derived:${depth}`;
    readers[input] = [...(readers[input] ?? []), entity];
    keys.push(output);
    ids.push(entity);
    entityKeys.set(entity, [input]);
  }

  const commits = Array.from({ length: 2048 }, (_, index) => [
    keys[0]!,
    ...Array.from(
      { length: Math.max(0, config.writesPerCommit - 1) },
      (__, offset) => `state:${1 + ((index * 13 + offset * 29) % (config.keys - 1))}`,
    ),
  ]);
  return { config, ids, keys, entityKeys, table: { readers }, commits };
}
